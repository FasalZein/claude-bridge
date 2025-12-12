// ============================================================================
// Streaming Handler
// ============================================================================

import type { OpenAIRequest, OpenAIStreamChunk } from "./types";
import { generateMessageId, mapFinishReason, estimateRequestTokens } from "./converter";
import { countTokens } from "./tokenizer";

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
  let toolStarted = false;
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
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(openaiReq),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          const errorEvent = {
            type: "error",
            error: {
              type: "api_error",
              message: errorBody,
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

              // Handle tool calls
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (tc.id) {
                    // New tool call starting
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
                      contentIndex++;
                      textStarted = false;
                    }

                    if (toolStarted) {
                      const blockStop = {
                        type: "content_block_stop",
                        index: contentIndex,
                      };
                      controller.enqueue(
                        encoder.encode(
                          `event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`
                        )
                      );
                      contentIndex++;
                    }

                    toolStarted = true;
                    const toolStart = {
                      type: "content_block_start",
                      index: contentIndex,
                      content_block: {
                        type: "tool_use",
                        id: tc.id,
                        name: tc.function?.name || "",
                        input: {},
                      },
                    };
                    controller.enqueue(
                      encoder.encode(
                        `event: content_block_start\ndata: ${JSON.stringify(toolStart)}\n\n`
                      )
                    );
                  }

                  if (tc.function?.arguments) {
                    accumulatedText += tc.function.arguments;

                    const toolDelta = {
                      type: "content_block_delta",
                      index: contentIndex,
                      delta: {
                        type: "input_json_delta",
                        partial_json: tc.function.arguments,
                      },
                    };
                    controller.enqueue(
                      encoder.encode(
                        `event: content_block_delta\ndata: ${JSON.stringify(toolDelta)}\n\n`
                      )
                    );
                  }
                }
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }

        // Close content blocks
        if (textStarted || toolStarted) {
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
        const errorEvent = {
          type: "error",
          error: {
            type: "api_error",
            message: error instanceof Error ? error.message : String(error),
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