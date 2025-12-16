// ============================================================================
// Streaming Handler
// ============================================================================

import type { OpenAIRequest, OpenAIStreamChunk } from "./types";
import { generateMessageId, mapFinishReason, estimateRequestTokens } from "./converter";
import { countTokens } from "./tokenizer";

// Request timeout for streaming (5 minutes)
const STREAM_TIMEOUT_MS = 300000;

export async function streamAndConvert(
  apiKey: string,
  baseUrl: string,
  openaiReq: OpenAIRequest,
  model: string
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();
  const msgId = generateMessageId();
  const estimatedInputTokens = estimateRequestTokens(openaiReq);

  let accumulatedText = "";
  let contentIndex = 0;
  let textStarted = false;
  let stopReason: "end_turn" | "max_tokens" | "tool_use" = "end_turn";

  return new ReadableStream({
    async start(controller) {
      // Send message_start event
      const messageStart = {
        type: "message_start",
        message: {
          id: msgId,
          type: "message",
          role: "assistant",
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: estimatedInputTokens,
            output_tokens: 1,
          },
        },
      };
      controller.enqueue(
        encoder.encode(
          `event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`
        )
      );

      try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
          console.error(`[Claude Bridge] Stream timeout after ${STREAM_TIMEOUT_MS}ms`);
          abortController.abort();
        }, STREAM_TIMEOUT_MS);

        let response: Response;
        let retries = 0;
        const maxRetries = 2;
        
        while (true) {
          try {
            response = await fetch(`${baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(openaiReq),
              signal: abortController.signal,
            });
            break; // Success, exit retry loop
          } catch (fetchError) {
            retries++;
            if (retries >= maxRetries) {
              throw fetchError;
            }
            console.error(`[Claude Bridge] Stream fetch failed, retrying (${retries}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
          }
        }

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text();
          console.error(`[Claude Bridge] Stream API Error: ${response.status} - ${errorBody}`);
          
          // Map HTTP status codes to Anthropic error types
          let errorType = "api_error";
          if (response.status === 429) {
            errorType = "rate_limit_error";
          } else if (response.status === 401) {
            errorType = "authentication_error";
          } else if (response.status === 400) {
            errorType = "invalid_request_error";
          } else if (response.status === 403) {
            errorType = "permission_error";
          } else if (response.status === 404) {
            errorType = "not_found_error";
          } else if (response.status === 413) {
            errorType = "request_too_large";
          } else if (response.status === 529) {
            errorType = "overloaded_error";
          } else if (response.status >= 500) {
            errorType = "api_error";
          }
          
          // For rate limit errors, include retry information in the error message
          let errorMessage = errorBody;
          if (response.status === 429) {
            const retryAfter = response.headers.get("retry-after") || "1";
            errorMessage = `Rate limit exceeded. Retry after ${retryAfter} seconds. ${errorBody}`;
          }
          
          const errorEvent = {
            type: "error",
            error: {
              type: errorType,
              message: errorMessage,
            },
          };
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`
            )
          );
          controller.close();
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const chunk: OpenAIStreamChunk = JSON.parse(data);
              const choice = chunk.choices?.[0];
              const delta = choice?.delta;

              // Track finish reason
              if (choice?.finish_reason) {
                stopReason = mapFinishReason(choice.finish_reason);
              }

              // Handle text content
              if (delta?.content) {
                if (!textStarted) {
                  textStarted = true;
                  const blockStart = {
                    type: "content_block_start",
                    index: contentIndex,
                    content_block: {
                      type: "text",
                      text: "",
                    },
                  };
                  controller.enqueue(
                    encoder.encode(
                      `event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`
                    )
                  );
                }

                accumulatedText += delta.content;

                const blockDelta = {
                  type: "content_block_delta",
                  index: contentIndex,
                  delta: {
                    type: "text_delta",
                    text: delta.content,
                  },
                };
                controller.enqueue(
                  encoder.encode(
                    `event: content_block_delta\ndata: ${JSON.stringify(blockDelta)}\n\n`
                  )
                );
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }

        // Close any open content blocks
        if (textStarted) {
          const blockStop = {
            type: "content_block_stop",
            index: contentIndex,
          };
          controller.enqueue(
            encoder.encode(
              `event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`
            )
          );
        }

        // Count output tokens
        const outputTokens = countTokens(accumulatedText);

        // Send message_delta with final usage
        const messageDelta = {
          type: "message_delta",
          delta: {
            stop_reason: stopReason,
            stop_sequence: null,
          },
          usage: {
            output_tokens: outputTokens,
          },
        };
        controller.enqueue(
          encoder.encode(
            `event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`
          )
        );

        // Send message_stop
        const messageStop = { type: "message_stop" };
        controller.enqueue(
          encoder.encode(
            `event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`
          )
        );

        controller.close();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Claude Bridge] Stream failed: ${errorMessage}`);
        
        // Determine error type based on the error
        let errorType = "api_error";
        let userMessage = errorMessage;
        
        // Check for specific error types
        if (errorMessage.includes("abort") || errorMessage.includes("timeout")) {
          errorType = "api_error";
          userMessage = `Request timed out. ${errorMessage}`;
        } else if (errorMessage.includes("fetch") || errorMessage.includes("network") || errorMessage.includes("ECONNREFUSED")) {
          errorType = "api_error";
          userMessage = `Connection error. ${errorMessage}`;
        }
        
        const errorEvent = {
          type: "error",
          error: {
            type: errorType,
            message: userMessage,
          },
        };
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`
          )
        );
        controller.close();
      }
    },
  });
}