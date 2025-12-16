// ============================================================================
// Request/Response Converters (Anthropic <-> OpenAI)
// ============================================================================

import type {
  AnthropicRequest,
  AnthropicMessage,
  AnthropicTextBlock,
  AnthropicContentBlock,
  AnthropicImageBlock,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
  AnthropicTool,
  AnthropicToolChoice,
  OpenAIRequest,
  OpenAIMessage,
  OpenAIContentPart,
  OpenAIToolCall,
  OpenAITool,
  OpenAIResponse,
} from "./types";
import { countTokens } from "./tokenizer";

// ============================================================================
// Utility Functions
// ============================================================================

export function generateMessageId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "msg_";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateCallId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "call_";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function contentToString(content: string | AnthropicContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ============================================================================
// Request Conversion (Anthropic → OpenAI)
// ============================================================================

function convertMessages(
  messages: AnthropicMessage[],
  system?: string | AnthropicTextBlock[]
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  // Add system message if present
  if (system) {
    const systemText =
      typeof system === "string"
        ? system
        : system
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n");
    result.push({ role: "system", content: systemText });
  }

  for (const msg of messages) {
    const { role, content } = msg;

    if (typeof content === "string") {
      result.push({ role, content });
      continue;
    }

    // Handle content blocks
    const toolUseBlocks = content.filter(
      (b): b is AnthropicToolUseBlock => b.type === "tool_use"
    );
    const toolResultBlocks = content.filter(
      (b): b is AnthropicToolResultBlock => b.type === "tool_result"
    );
    const textBlocks = content.filter(
      (b): b is AnthropicTextBlock => b.type === "text"
    );
    const imageBlocks = content.filter(
      (b): b is AnthropicImageBlock => b.type === "image"
    );

    if (toolUseBlocks.length > 0 && role === "assistant") {
      // Assistant message with tool calls
      const toolCalls: OpenAIToolCall[] = toolUseBlocks.map((b) => ({
        id: b.id || generateCallId(),
        type: "function" as const,
        function: {
          name: b.name || "",
          arguments: JSON.stringify(b.input || {}),
        },
      }));

      const textContent = textBlocks.map((b) => b.text).join("") || null;
      result.push({
        role: "assistant",
        content: textContent,
        tool_calls: toolCalls,
      });
    } else if (toolResultBlocks.length > 0) {
      // Tool result messages
      for (const b of toolResultBlocks) {
        const resultContent =
          typeof b.content === "string"
            ? b.content
            : contentToString(b.content);
        result.push({
          role: "tool",
          content: resultContent,
          tool_call_id: b.tool_use_id || "",
        });
      }
    } else if (imageBlocks.length > 0 || textBlocks.length > 0) {
      // Mixed content (text and/or images)
      const parts: OpenAIContentPart[] = [];

      for (const block of content) {
        if (block.type === "text" && block.text) {
          parts.push({ type: "text", text: block.text });
        } else if (block.type === "image" && block.source) {
          const { media_type, data } = block.source;
          parts.push({
            type: "image_url",
            image_url: {
              url: `data:${media_type || "image/png"};base64,${data || ""}`,
            },
          });
        }
      }

      // Simplify if only one text part
      const firstPart = parts[0];
      if (parts.length === 1 && firstPart && firstPart.type === "text" && firstPart.text) {
        result.push({ role, content: firstPart.text });
      } else {
        result.push({ role, content: parts });
      }
    }
  }

  return result;
}

function convertTools(tools?: AnthropicTool[]): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema || {},
    },
  }));
}

function convertToolChoice(
  choice?: AnthropicToolChoice
): string | { type: "function"; function: { name: string } } | undefined {
  if (!choice) return undefined;

  switch (choice.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "none":
      return "none";
    case "tool":
      return {
        type: "function",
        function: { name: choice.name || "" },
      };
    default:
      return "auto";
  }
}

export function convertRequest(req: AnthropicRequest, mappedModel: string): OpenAIRequest {
  const openaiReq: OpenAIRequest = {
    model: mappedModel,
    messages: convertMessages(req.messages, req.system),
    max_tokens: req.max_tokens,
    stream: req.stream || false,
  };

  if (req.stream) {
    openaiReq.stream_options = { include_usage: true };
  }

  if (req.temperature !== undefined) {
    openaiReq.temperature = req.temperature;
  }

  if (req.top_p !== undefined) {
    openaiReq.top_p = req.top_p;
  }

  if (req.stop_sequences) {
    openaiReq.stop = req.stop_sequences;
  }

  // Note: A4F doesn't support native tools API for Claude models
  // Roo Code uses XML tools in system prompt which works fine
  // We don't include tools in the request as they cause errors with A4F
  
  if (req.metadata?.user_id) {
    openaiReq.user = req.metadata.user_id;
  }

  return openaiReq;
}

// ============================================================================
// Response Conversion (OpenAI → Anthropic)
// ============================================================================

export function mapFinishReason(
  finishReason: string | null
): "end_turn" | "max_tokens" | "tool_use" {
  switch (finishReason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    default:
      return "end_turn";
  }
}

export function convertResponse(
  res: OpenAIResponse,
  model: string,
  inputTokens: number
): Record<string, unknown> {
  const choice = res.choices?.[0];
  const message = choice?.message;
  const content: Array<Record<string, unknown>> = [];

  // Accumulate output text for local token counting
  let outputText = "";

  if (message?.content) {
    content.push({ type: "text", text: message.content });
    outputText += message.content;
  }

  if (message?.tool_calls) {
    for (const tc of message.tool_calls) {
      let input: Record<string, unknown> = {};
      const argsStr = tc.function?.arguments || "{}";
      try {
        input = JSON.parse(argsStr);
      } catch {
        // Keep empty object on parse failure
      }
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function?.name,
        input,
      });
      // Include tool call arguments in token count
      outputText += argsStr;
    }
  }

  // Count output tokens locally using our Claude tokenizer
  const outputTokens = countTokens(outputText);

  return {
    id: generateMessageId(),
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: mapFinishReason(choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

// ============================================================================
// Token Estimation
// ============================================================================

export function estimateRequestTokens(openaiReq: OpenAIRequest): number {
  let total = 0;

  for (const msg of openaiReq.messages) {
    if (typeof msg.content === "string") {
      total += countTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          total += countTokens(part.text);
        }
      }
    }
  }

  // Add tool definitions if present
  if (openaiReq.tools) {
    total += countTokens(JSON.stringify(openaiReq.tools));
  }

  return total;
}