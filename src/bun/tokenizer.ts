// =============================================================================
// Tokenizer
// Accurate token counting using the Claude tokenizer
// Falls back to estimation if tokenizer fails to load
// =============================================================================

import { fromPreTrained } from '@lenml/tokenizer-claude'

// Pre-warm the tokenizer on module load
let tokenizer: ReturnType<typeof fromPreTrained> | null = null
let tokenizerError: Error | null = null

try {
  tokenizer = fromPreTrained()
  console.log('[Claude Bridge] Tokenizer initialized successfully')
} catch (error) {
  tokenizerError = error instanceof Error ? error : new Error(String(error))
  console.warn(`[Claude Bridge] Failed to initialize tokenizer: ${tokenizerError.message}`)
  console.warn('[Claude Bridge] Using estimation fallback')
}

/**
 * Count tokens using the Claude tokenizer
 * Falls back to character-based estimation if tokenizer unavailable
 */
export function countTokens(text: string): number {
  if (!text) return 0

  // Try to use the real tokenizer
  if (tokenizer) {
    try {
      const encoded = tokenizer.encode(text, { add_special_tokens: false })
      return encoded.length
    } catch {
      // Fall through to estimation
    }
  }

  // Fallback: character-based estimation
  return estimateTokens(text)
}

/**
 * Fast token estimation without external dependencies
 * Used as fallback when tokenizer is unavailable
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const len = text.length
  if (len === 0) return 0
  if (len < 5) return Math.max(1, Math.ceil(len / 3))

  let regularAscii = 0
  let digits = 0
  let symbols = 0
  let nonAscii = 0

  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0x80) nonAscii++
    else if (c >= 48 && c <= 57) digits++
    else if ((c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)) symbols++
    else regularAscii++
  }

  return Math.ceil(regularAscii / 4.5 + digits / 2 + symbols / 1.5 + nonAscii / 1.5)
}

/**
 * Estimate input tokens for a request
 */
export function estimateInputTokens(request: {
  system?: string | Array<{ text: string }>
  messages: Array<{
    content: string | Array<{
      type: string
      text?: string
      name?: string
      input?: unknown
      content?: string | unknown
      thinking?: string
    }>
  }>
  tools?: Array<{
    name?: string
    description?: string
    input_schema?: unknown
  }>
}): number {
  let total = 0

  // System prompt
  if (request.system) {
    if (typeof request.system === 'string') {
      total += countTokens(request.system)
    } else {
      for (const block of request.system) {
        total += countTokens(block.text)
      }
    }
  }

  // Messages
  for (const m of request.messages) {
    if (typeof m.content === 'string') {
      total += countTokens(m.content)
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === 'text' && block.text) {
          total += countTokens(block.text)
        } else if (block.type === 'tool_use') {
          total += countTokens(block.name || '')
          total += countTokens(JSON.stringify(block.input || {}))
        } else if (block.type === 'tool_result') {
          if (typeof block.content === 'string') {
            total += countTokens(block.content)
          } else if (block.content) {
            total += countTokens(JSON.stringify(block.content))
          }
        } else if (block.type === 'thinking' && block.thinking) {
          total += countTokens(block.thinking)
        }
      }
    }
  }

  // Tools
  if (request.tools?.length) {
    for (const tool of request.tools) {
      if (tool.name) total += countTokens(tool.name)
      if (tool.description) total += countTokens(tool.description)
      if (tool.input_schema) total += countTokens(JSON.stringify(tool.input_schema))
    }
  }

  return total
}

/**
 * Check if tokenizer is available
 */
export function isTokenizerAvailable(): boolean {
  return tokenizer !== null
}

/**
 * Get tokenizer status
 */
export function getTokenizerStatus(): { available: boolean; error: string | null } {
  return {
    available: tokenizer !== null,
    error: tokenizerError?.message || null
  }
}
