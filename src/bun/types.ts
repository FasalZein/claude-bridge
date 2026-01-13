// =============================================================================
// Types
// TypeScript interfaces for Anthropic and OpenAI API formats
// =============================================================================

// =============================================================================
// Provider Types
// =============================================================================

export type ProviderType = 'a4f' | 'cli_proxy' | 'gemini'

export interface ProviderConfig {
  name: ProviderType
  baseUrl: string
  apiKey: string
  modelPrefix: string
  supportsNativeTools: boolean
  supportsThinking: boolean
}

// =============================================================================
// Anthropic Types
// =============================================================================

export interface AnthropicTextBlock {
  type: 'text'
  text: string
}

export interface AnthropicImageBlock {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    media_type?: string
    data?: string
    url?: string
  }
}

export interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | AnthropicContentBlock[]
  is_error?: boolean
}

export interface AnthropicThinkingBlock {
  type: 'thinking'
  thinking: string
  signature?: string
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

export interface AnthropicToolChoice {
  type: 'auto' | 'any' | 'none' | 'tool'
  name?: string
}

export interface AnthropicThinkingConfig {
  type: 'enabled' | 'disabled'
  budget_tokens?: number
}

export interface AnthropicRequest {
  model: string
  messages: AnthropicMessage[]
  system?: string | AnthropicTextBlock[]
  max_tokens: number
  stream?: boolean
  temperature?: number
  top_p?: number
  stop_sequences?: string[]
  tools?: AnthropicTool[]
  tool_choice?: AnthropicToolChoice
  thinking?: AnthropicThinkingConfig
  metadata?: {
    user_id?: string
  }
}

export interface AnthropicResponse {
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
    cache_creation_input_tokens?: number
  }
}

// =============================================================================
// OpenAI Types
// =============================================================================

export interface OpenAIContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
  }
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentPart[] | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface OpenAIRequest {
  model: string
  messages: OpenAIMessage[]
  max_tokens?: number
  stream: boolean
  stream_options?: {
    include_usage: boolean
  }
  temperature?: number
  top_p?: number
  stop?: string[]
  tools?: OpenAITool[]
  tool_choice?: string | { type: 'function'; function: { name: string } }
  reasoning_effort?: 'low' | 'medium' | 'high'
  user?: string
}

export interface OpenAIChoice {
  index: number
  message?: {
    role: string
    content: string | null
    reasoning_content?: string
    tool_calls?: OpenAIToolCall[]
  }
  delta?: {
    role?: string
    content?: string | null
    reasoning_content?: string
    tool_calls?: Array<{
      index: number
      id?: string
      type?: string
      function?: {
        name?: string
        arguments?: string
      }
    }>
  }
  finish_reason: string | null
}

export interface OpenAIResponse {
  id: string
  object: string
  created: number
  model: string
  choices: OpenAIChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
  }
}

export interface OpenAIStreamChunk {
  id: string
  object: string
  created: number
  model: string
  choices: OpenAIChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
  }
}
