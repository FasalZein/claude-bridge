// =============================================================================
// Configuration
// Environment variables and constants for the proxy
// =============================================================================

export const config = {
  // Server
  port: process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT) : 4242,
  requestTimeout: process.env.REQUEST_TIMEOUT ? parseInt(process.env.REQUEST_TIMEOUT) : 600000, // 10 minutes for long sessions

  // Rate limiting
  rateLimitRpm: process.env.RATE_LIMIT_RPM ? parseInt(process.env.RATE_LIMIT_RPM) : 10,
  rateLimitWindowMs: 60000, // 1 minute

  // API Keys
  a4fApiKey: process.env.A4F_API_KEY || '',
  cliProxyApiKey: process.env.CLI_PROXY_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  validApiKeys: (process.env.VALID_API_KEYS || '')
    .split(',')
    .map((k: string) => k.trim())
    .filter((k: string) => k.length > 0),

  // Provider URLs
  a4fBaseUrl: process.env.A4F_BASE_URL || 'https://api.a4f.co/v1',
  cliProxyBaseUrl: process.env.CLI_PROXY_BASE_URL || 'http://127.0.0.1:8317/v1',

  // Default models for Claude Code (like anticc)
  opusModel: process.env.OPUS_MODEL || 'claude-opus-4-5-20251101',
  sonnetModel: process.env.SONNET_MODEL || 'claude-sonnet-4-20250514',
  haikuModel: process.env.HAIKU_MODEL || 'claude-haiku-4-5-20251001',

  // Background model routing (haiku -> gemini flash via CLI Proxy)
  useGeminiForBackground: process.env.USE_GEMINI_FOR_BACKGROUND === 'true',
  backgroundModel: process.env.BACKGROUND_MODEL || 'gemini-3-flash-preview',
} as const

// =============================================================================
// Pre-computed Constants for Performance
// =============================================================================

export const ENC = new TextEncoder()

export const HEADERS = {
  json: { 'Content-Type': 'application/json' } as const,
  sse: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  } as const,
  cors: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta'
  } as const
}

// Pre-encoded error responses
export const ERRORS = {
  auth: '{"type":"error","error":{"type":"authentication_error","message":"Missing or invalid API key"}}',
  json: '{"type":"error","error":{"type":"invalid_request_error","message":"Invalid JSON"}}',
  timeout: '{"type":"error","error":{"type":"api_error","message":"Request timeout"}}',
  noProvider: '{"type":"error","error":{"type":"api_error","message":"No backend provider configured"}}'
}

// Pre-encoded SSE stop event
export const SSE_STOP = ENC.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n')

// CRC32 hash routing for fast path matching (Bun optimization)
export const ROUTE_HASHES = {
  v1Messages: Bun.hash.crc32('/v1/messages'),
  messages: Bun.hash.crc32('/messages'),
  v1MessagesCount: Bun.hash.crc32('/v1/messages/count_tokens'),
  v1Models: Bun.hash.crc32('/v1/models'),
  models: Bun.hash.crc32('/models'),
  health: Bun.hash.crc32('/health'),
  v1ChatCompletions: Bun.hash.crc32('/v1/chat/completions'),
  chatCompletions: Bun.hash.crc32('/chat/completions')
}

// Stop reason mapping (OpenAI -> Anthropic)
export const STOP_REASON_MAP: Record<string, string> = {
  stop: 'end_turn',
  end_turn: 'end_turn',
  length: 'max_tokens',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  tool_calls: 'tool_use',
  tool_use: 'tool_use'
}
