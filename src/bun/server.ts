// =============================================================================
// Server
// Main Bun server entry point with load-balanced routing
// =============================================================================

import { config, HEADERS, ERRORS, ROUTE_HASHES } from './config'
import { loadBalancer } from './load-balancer'
import { getAvailableProvider, isBackgroundModel, getAvailableModels } from './providers'
import { estimateInputTokens, getTokenizerStatus } from './tokenizer'
import { convertRequest, convertResponse, generateMessageId } from './converter'
import { handleStream, fetchWithTimeout } from './streaming'
import type { AnthropicRequest, ProviderType, ProviderConfig } from './types'

// =============================================================================
// Request Handlers
// =============================================================================

function validateApiKey(key: string): boolean {
  if (!key || config.validApiKeys.length === 0) return false
  return config.validApiKeys.includes(key)
}

/**
 * Execute a request with automatic retry on failure
 */
async function executeWithRetry(
  body: AnthropicRequest,
  originalModel: string,
  initialProvider: ProviderType
): Promise<Response> {
  let provider = getAvailableProvider(initialProvider)
  let startTime = loadBalancer.recordRequest(provider.name)

  // First attempt
  let response = await attemptRequest(body, provider, originalModel)

  // Only retry on server errors (5xx), not client errors (4xx)
  // Client errors like "tool_use ids must be unique" will fail again on retry
  if (response.status >= 500 && response.status < 600 && loadBalancer.shouldRetry(provider.name)) {
    loadBalancer.recordResult(provider.name, false, startTime)
    const fallbackType = loadBalancer.getFallback(provider.name)
    const fallbackProvider = getAvailableProvider(fallbackType)

    if (fallbackProvider.apiKey) {
      console.log(`[Claude Bridge] Retrying with ${fallbackType} after ${provider.name} 5xx error`)
      startTime = loadBalancer.recordRequest(fallbackType)
      provider = fallbackProvider
      response = await attemptRequest(body, provider, originalModel)
    }
  }

  // Record final result
  // 4xx = client error (not provider's fault), 5xx = server error (provider issue)
  const isProviderHealthy = response.status < 500
  loadBalancer.recordResult(provider.name, isProviderHealthy, startTime)
  return response
}

/**
 * Attempt a single request (streaming or non-streaming)
 */
async function attemptRequest(
  body: AnthropicRequest,
  provider: ProviderConfig,
  originalModel: string
): Promise<Response> {
  if (body.stream) {
    const response = await handleStream(body, provider)
    const headers = new Headers(response.headers)
    Object.entries(HEADERS.cors).forEach(([k, v]) => headers.set(k, v))
    return new Response(response.body, { status: response.status, headers })
  }

  // Determine if we should passthrough (CLI Proxy) or convert (A4F)
  const isPassthrough = provider.name === 'cli_proxy'

  try {
    let response: Response

    if (isPassthrough) {
      // CLI Proxy: Send Anthropic format directly to /v1/messages
      response = await fetchWithTimeout(`${provider.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        const errorBody = await response.text()
        console.error(`[Claude Bridge] API Error from ${provider.name}: ${response.status} - ${errorBody}`)
        return Response.json(
          { type: 'error', error: { type: 'api_error', message: errorBody } },
          { status: response.status, headers: HEADERS.cors }
        )
      }

      // Response is already in Anthropic format, just add CORS
      const anthropicResponse = await response.json()
      return Response.json(anthropicResponse, { headers: HEADERS.cors })

    } else {
      // A4F: Convert to OpenAI format
      const openaiRequest = convertRequest(body, provider)

      response = await fetchWithTimeout(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify(openaiRequest)
      })

      if (!response.ok) {
        const errorBody = await response.text()
        console.error(`[Claude Bridge] API Error from ${provider.name}: ${response.status} - ${errorBody}`)

        const errorType = response.status === 429 ? 'rate_limit_error'
          : response.status === 401 ? 'authentication_error'
          : response.status === 400 ? 'invalid_request_error'
          : 'api_error'

        return Response.json(
          { type: 'error', error: { type: errorType, message: errorBody } },
          { status: response.status, headers: HEADERS.cors }
        )
      }

      const openaiResponse = await response.json()
      const inputTokens = estimateInputTokens(body)
      const anthropicResponse = convertResponse(openaiResponse, originalModel, inputTokens)

      return Response.json(anthropicResponse, { headers: HEADERS.cors })
    }
  } catch (error) {
    console.error(`[Claude Bridge] Request to ${provider.name} failed: ${error}`)
    return Response.json(
      { type: 'error', error: { type: 'api_error', message: String(error) } },
      { status: 500, headers: HEADERS.cors }
    )
  }
}

async function handleMessages(req: Request): Promise<Response> {
  // Extract API key
  const apiKey = req.headers.get('x-api-key') || req.headers.get('Authorization')?.slice(7)

  if (!apiKey || !validateApiKey(apiKey)) {
    return new Response(ERRORS.auth, {
      status: 401,
      headers: { ...HEADERS.json, ...HEADERS.cors }
    })
  }

  // Parse request body
  let body: AnthropicRequest
  try {
    body = await req.json()
  } catch {
    return new Response(ERRORS.json, {
      status: 400,
      headers: { ...HEADERS.json, ...HEADERS.cors }
    })
  }

  // Validate required fields
  if (!body.messages?.length || !body.max_tokens) {
    return Response.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'Missing required fields: messages, max_tokens' } },
      { status: 400, headers: HEADERS.cors }
    )
  }

  // Determine provider
  let providerType: ProviderType
  const originalModel = body.model

  // Check if this is a Haiku model - ALWAYS route to CLI Proxy with Gemini Flash
  if (isBackgroundModel(body.model)) {
    providerType = 'cli_proxy'
    body.model = config.backgroundModel  // gemini-3-flash-preview
    console.log(`[Claude Bridge] ${originalModel} -> ${body.model} via CLI Proxy (haiku -> gemini flash)`)
  } else {
    // For Opus/Sonnet: Use load balancer for smart distribution
    providerType = loadBalancer.getProvider()
    const status = loadBalancer.getStatus()
    console.log(`[Claude Bridge] ${body.model} -> ${providerType} (A4F: ${status.a4f.count}/${status.a4f.limit}, CLI: ${status.cli_proxy.count})`)
  }

  // Get provider configuration
  const provider = getAvailableProvider(providerType)

  // Check if provider has API key
  if (!provider.apiKey) {
    // Try fallback provider
    const fallbackType = loadBalancer.getFallback(providerType)
    const fallbackProvider = getAvailableProvider(fallbackType)

    if (!fallbackProvider.apiKey) {
      console.error(`[Claude Bridge] No API key for any provider`)
      return new Response(ERRORS.noProvider, {
        status: 500,
        headers: { ...HEADERS.json, ...HEADERS.cors }
      })
    }

    console.log(`[Claude Bridge] Primary ${providerType} unavailable, using ${fallbackType}`)
    providerType = fallbackType
  }

  // Execute with automatic retry
  return executeWithRetry(body, originalModel, providerType)
}

async function handleCountTokens(req: Request): Promise<Response> {
  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(ERRORS.json, {
      status: 400,
      headers: { ...HEADERS.json, ...HEADERS.cors }
    })
  }

  const tokens = estimateInputTokens(body)
  return Response.json({ input_tokens: tokens }, { headers: HEADERS.cors })
}

function handleModels(): Response {
  const models = getAvailableModels()
  return Response.json({ object: 'list', data: models }, { headers: HEADERS.cors })
}

function handleHealth(): Response {
  const lbStatus = loadBalancer.getStatus()
  const tokenizerStatus = getTokenizerStatus()

  return Response.json({
    status: 'ok',
    service: 'claude-bridge',
    version: '2.1.0',
    runtime: 'bun',
    bunVersion: Bun.version,
    loadBalancer: lbStatus,
    tokenizer: tokenizerStatus,
    providers: {
      a4f: !!config.a4fApiKey,
      cli_proxy: !!config.cliProxyApiKey,
      gemini: !!config.geminiApiKey
    },
    config: {
      port: config.port,
      rateLimitRpm: config.rateLimitRpm,
      useGeminiForBackground: config.useGeminiForBackground,
      backgroundModel: config.backgroundModel
    }
  }, { headers: HEADERS.cors })
}

/**
 * Handle OpenAI-compatible /chat/completions endpoint
 * Passes through to A4F directly without conversion
 */
async function handleChatCompletions(req: Request): Promise<Response> {
  // Extract API key
  const apiKey = req.headers.get('Authorization')?.slice(7)

  if (!apiKey || !validateApiKey(apiKey)) {
    return Response.json(
      { error: { message: 'Invalid API key', type: 'invalid_request_error' } },
      { status: 401, headers: HEADERS.cors }
    )
  }

  // Use load balancer for provider selection
  const providerType = loadBalancer.getProvider()
  const provider = getAvailableProvider(providerType)

  if (!provider.apiKey) {
    return Response.json(
      { error: { message: 'No backend provider configured', type: 'server_error' } },
      { status: 500, headers: HEADERS.cors }
    )
  }

  const startTime = loadBalancer.recordRequest(providerType)

  // Pass through to upstream
  try {
    const response = await fetchWithTimeout(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: req.body
    })

    loadBalancer.recordResult(providerType, response.ok, startTime)

    // Forward the response with CORS headers
    const headers = new Headers(response.headers)
    Object.entries(HEADERS.cors).forEach(([k, v]) => headers.set(k, v))

    return new Response(response.body, {
      status: response.status,
      headers
    })
  } catch (error) {
    loadBalancer.recordResult(providerType, false, startTime)
    console.error(`[Claude Bridge] Chat completions error: ${error}`)
    return Response.json(
      { error: { message: String(error), type: 'server_error' } },
      { status: 500, headers: HEADERS.cors }
    )
  }
}

// =============================================================================
// Main Server
// =============================================================================

const server = Bun.serve({
  port: config.port,
  development: false,
  reusePort: true,

  async fetch(req) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: HEADERS.cors })
    }

    const url = new URL(req.url)
    const pathHash = Bun.hash.crc32(url.pathname)
    const isPost = req.method === 'POST'
    const isGet = req.method === 'GET'

    // Route: /v1/messages or /messages (POST)
    if (isPost && (pathHash === ROUTE_HASHES.v1Messages || pathHash === ROUTE_HASHES.messages)) {
      return handleMessages(req)
    }

    // Route: /v1/messages/count_tokens (POST)
    if (isPost && pathHash === ROUTE_HASHES.v1MessagesCount) {
      return handleCountTokens(req)
    }

    // Route: /v1/models or /models (GET)
    if (isGet && (pathHash === ROUTE_HASHES.v1Models || pathHash === ROUTE_HASHES.models)) {
      return handleModels()
    }

    // Route: /health (GET)
    if (isGet && pathHash === ROUTE_HASHES.health) {
      return handleHealth()
    }

    // Route: /v1/chat/completions or /chat/completions (POST) - OpenAI passthrough
    if (isPost && (pathHash === ROUTE_HASHES.v1ChatCompletions || pathHash === ROUTE_HASHES.chatCompletions)) {
      return handleChatCompletions(req)
    }

    // Silently accept telemetry/logging endpoints (used by Claude Code)
    if (url.pathname.startsWith('/api/event_logging') || url.pathname.startsWith('/api/telemetry')) {
      return Response.json({ success: true }, { headers: HEADERS.cors })
    }

    // 404 for unhandled routes
    return Response.json(
      { error: { message: `Not found: ${url.pathname}`, type: 'not_found' } },
      { status: 404, headers: HEADERS.cors }
    )
  }
})

// =============================================================================
// Startup Banner
// =============================================================================

const providers = [
  config.a4fApiKey ? '✓ A4F' : '✗ A4F',
  config.cliProxyApiKey ? '✓ CLI Proxy (8317)' : '✗ CLI Proxy',
].join(', ')

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║          Claude Bridge v2.1.0 - Load Balanced - Bun ${Bun.version.padEnd(10)}║
╠═══════════════════════════════════════════════════════════════════╣
║  Server:        http://localhost:${String(server.port).padEnd(30)}║
║  Providers:     ${providers.padEnd(47)}║
╠═══════════════════════════════════════════════════════════════════╣
║  Load Balancing Strategy:                                         ║
║    Opus/Sonnet: 90% A4F / 10% CLI Proxy (weighted round-robin)    ║
║    Haiku:       100% CLI Proxy -> ${config.backgroundModel.padEnd(27)}║
║    Auto-retry:  On failure, automatically retry with other        ║
║    Heartbeat:   Keeps connection alive during long thinking       ║
╠═══════════════════════════════════════════════════════════════════╣
║  Models:                                                          ║
║    Opus:        ${config.opusModel.padEnd(47)}║
║    Sonnet:      ${config.sonnetModel.padEnd(47)}║
║    Haiku:       ${(config.backgroundModel + ' (gemini flash)').padEnd(47)}║
╚═══════════════════════════════════════════════════════════════════╝
`)

export { server }
