// =============================================================================
// Converter
// Request/Response conversion between Anthropic and OpenAI formats
// =============================================================================

import { STOP_REASON_MAP } from './config'
import { mapModelName } from './providers'
import type {
  AnthropicRequest,
  AnthropicContentBlock,
  OpenAIRequest,
  OpenAIMessage,
  OpenAIResponse,
  ProviderConfig,
} from './types'

// =============================================================================
// Utility Functions
// =============================================================================

const sigBuffer = new Uint8Array(64)
const sigChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Generate a random signature for thinking blocks
 */
export function generateSignature(): string {
  crypto.getRandomValues(sigBuffer)
  let s = ''
  for (let i = 0; i < 64; i++) s += sigChars[sigBuffer[i]! & 63]
  return s
}

let msgCounter = 0

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `msg_${(++msgCounter).toString(36)}_${Date.now().toString(36)}`
}

/**
 * Generate a unique tool call ID
 */
export function generateCallId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = 'call_'
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// =============================================================================
// Request Conversion (Anthropic -> OpenAI)
// =============================================================================

/**
 * Convert Anthropic request to OpenAI format
 */
export function convertRequest(request: AnthropicRequest, provider: ProviderConfig): OpenAIRequest {
  const messages: OpenAIMessage[] = []

  // System message
  if (request.system) {
    const systemText = typeof request.system === 'string'
      ? request.system
      : request.system.map(b => b.text).join('\n\n')
    messages.push({ role: 'system', content: systemText })
  }

  // Convert messages
  for (const msg of request.messages) {
    if (typeof msg.content === 'string') {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      })
      continue
    }

    const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
    const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []
    const toolResults: Array<{ id: string; content: string }> = []

    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          parts.push({ type: 'text', text: block.text })
          break

        case 'image':
          if (block.source.type === 'base64') {
            parts.push({
              type: 'image_url',
              image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` }
            })
          } else if (block.source.type === 'url' && block.source.url) {
            parts.push({
              type: 'image_url',
              image_url: { url: block.source.url }
            })
          }
          break

        case 'tool_use':
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input)
            }
          })
          break

        case 'tool_result':
          const content = typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content)
          toolResults.push({ id: block.tool_use_id, content })
          break
      }
    }

    // Build the message(s)
    if (msg.role === 'assistant' && toolCalls.length > 0) {
      const textContent = parts
        .filter(p => p.type === 'text')
        .map(p => p.text)
        .join('\n') || null
      messages.push({
        role: 'assistant',
        content: textContent,
        tool_calls: toolCalls
      })
    } else if (msg.role === 'user' && toolResults.length > 0) {
      // Add tool results as separate messages
      for (const tr of toolResults) {
        messages.push({
          role: 'tool',
          content: tr.content,
          tool_call_id: tr.id
        })
      }
      // Add any remaining content as user message
      if (parts.length > 0) {
        messages.push({ role: 'user', content: parts as any })
      }
    } else if (parts.length > 0) {
      const role = msg.role === 'user' ? 'user' : 'assistant'
      // Simplify if only one text part
      if (parts.length === 1 && parts[0].type === 'text') {
        messages.push({ role, content: parts[0].text! })
      } else {
        messages.push({ role, content: parts as any })
      }
    }
  }

  // Map model name
  const model = mapModelName(request.model, provider)

  // Build OpenAI request
  const openaiRequest: OpenAIRequest = {
    model,
    messages,
    max_tokens: request.max_tokens,
    stream: request.stream ?? false
  }

  if (request.stream) {
    openaiRequest.stream_options = { include_usage: true }
  }

  if (request.temperature !== undefined) {
    openaiRequest.temperature = request.temperature
  }

  if (request.top_p !== undefined) {
    openaiRequest.top_p = request.top_p
  }

  if (request.stop_sequences) {
    openaiRequest.stop = request.stop_sequences
  }

  // Handle thinking/reasoning mode
  if (request.thinking?.type === 'enabled' && provider.supportsThinking) {
    const budget = request.thinking.budget_tokens || 0
    openaiRequest.reasoning_effort = budget >= 8000 ? 'high' : budget >= 4000 ? 'medium' : 'low'
  }

  // Handle tools (only if provider supports native tools)
  if (request.tools?.length && provider.supportsNativeTools) {
    const tools = request.tools
      .filter(t => 'name' in t && !('type' in t))
      .map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          ...(t.description && { description: t.description }),
          parameters: t.input_schema
        }
      }))

    if (tools.length > 0) {
      openaiRequest.tools = tools
      openaiRequest.tool_choice = 'auto'
    }
  }

  if (request.metadata?.user_id) {
    openaiRequest.user = request.metadata.user_id
  }

  return openaiRequest
}

// =============================================================================
// Response Conversion (OpenAI -> Anthropic)
// =============================================================================

/**
 * Map OpenAI finish reason to Anthropic stop reason
 */
export function mapStopReason(finishReason: string | null): 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' {
  if (!finishReason) return 'end_turn'
  return (STOP_REASON_MAP[finishReason] || 'end_turn') as 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'
}

/**
 * Convert OpenAI response to Anthropic format
 */
export function convertResponse(
  response: OpenAIResponse,
  originalModel: string,
  inputTokens: number
): {
  id: string
  type: 'message'
  role: 'assistant'
  content: AnthropicContentBlock[]
  model: string
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
  }
} {
  const choice = response.choices?.[0]
  const message = choice?.message
  const content: AnthropicContentBlock[] = []

  // Handle reasoning/thinking content
  if (message?.reasoning_content) {
    content.push({
      type: 'thinking',
      thinking: message.reasoning_content,
      signature: generateSignature()
    })
  }

  // Handle tool calls
  if (message?.tool_calls?.length) {
    // Add text content first if present
    if (message.content) {
      content.push({ type: 'text', text: message.content })
    }

    // Add tool use blocks
    for (const tc of message.tool_calls) {
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(tc.function.arguments)
      } catch {
        // Keep empty object
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input
      })
    }
  } else if (message?.content) {
    content.push({ type: 'text', text: message.content })
  }

  // Determine stop reason
  const stopReason = message?.tool_calls?.length
    ? 'tool_use'
    : mapStopReason(choice?.finish_reason ?? null)

  // Build usage
  const usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
  } = {
    input_tokens: response.usage?.prompt_tokens ?? inputTokens,
    output_tokens: response.usage?.completion_tokens ?? 0
  }

  if (response.usage?.prompt_tokens_details?.cached_tokens) {
    usage.cache_read_input_tokens = response.usage.prompt_tokens_details.cached_tokens
  }

  return {
    id: generateMessageId(),
    type: 'message',
    role: 'assistant',
    content,
    model: originalModel,
    stop_reason: stopReason,
    stop_sequence: null,
    usage
  }
}

/**
 * Build OpenAI request body as JSON string (for streaming)
 */
export function buildRequestBody(request: AnthropicRequest, provider: ProviderConfig): string {
  return JSON.stringify(convertRequest(request, provider))
}
