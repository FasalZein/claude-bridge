// =============================================================================
// Streaming Handler
// Handles SSE streaming and converts OpenAI stream to Anthropic format
// =============================================================================

import { config, ENC, SSE_STOP, STOP_REASON_MAP } from './config'
import { generateSignature, generateMessageId, buildRequestBody } from './converter'
import { estimateInputTokens, countTokens } from './tokenizer'
import { mapModelName } from './providers'
import type { AnthropicRequest, ProviderConfig, OpenAIStreamChunk } from './types'

// =============================================================================
// Fetch with Timeout
// =============================================================================

export async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), config.requestTimeout)

  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timeoutId)
    return response
  } catch (err) {
    clearTimeout(timeoutId)
    throw err
  }
}

// =============================================================================
// Streaming Handler
// =============================================================================

export async function handleStream(
  request: AnthropicRequest,
  provider: ProviderConfig
): Promise<Response> {
  const thinkingEnabled = request.thinking?.type === 'enabled'
  const inputTokens = estimateInputTokens(request)

  // Determine if we should passthrough (CLI Proxy) or convert (A4F)
  const isPassthrough = provider.name === 'cli_proxy'

  // Make the upstream request
  let response: Response
  try {
    if (isPassthrough) {
      // CLI Proxy: Send Anthropic format directly to /v1/messages
      // Map model name for CLI Proxy (e.g., claude-opus-4-5-20251101 -> gemini-claude-opus-4-5-thinking)
      const mappedModel = mapModelName(request.model, provider)
      const passthroughRequest = { ...request, model: mappedModel }

      if (mappedModel !== request.model) {
        console.log(`[Claude Bridge] CLI Proxy model: ${request.model} -> ${mappedModel}`)
      }

      response = await fetchWithTimeout(`${provider.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(passthroughRequest)
      })
    } else {
      // A4F: Convert to OpenAI format and send to /chat/completions
      response = await fetchWithTimeout(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`
        },
        body: buildRequestBody(request, provider)
      })
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return new Response(
        '{"type":"error","error":{"type":"api_error","message":"Request timeout"}}',
        { status: 504, headers: { 'Content-Type': 'application/json' } }
      )
    }
    throw err
  }

  // Handle error responses
  if (!response.ok) {
    const errorBody = await response.text()
    console.error(`[Claude Bridge] Stream Error: ${response.status} - ${errorBody}`)
    return new Response(
      JSON.stringify({
        type: 'error',
        error: {
          type: response.status === 429 ? 'rate_limit_error' : 'api_error',
          message: errorBody
        }
      }),
      { status: response.status, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // CLI Proxy passthrough: Response is already in Anthropic SSE format
  if (isPassthrough) {
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    })
  }

  // A4F: Convert OpenAI stream to Anthropic format
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const messageId = generateMessageId()
  const model = request.model

  // State tracking
  let blockIdx = -1
  let thinkingStarted = false
  let textStarted = false
  let inTok = inputTokens
  let outTok = 0
  let cacheTok = 0
  let accumulatedText = ''
  const toolCalls = new Map<number, { id: string; name: string; args: string }>()

  // Heartbeat to keep connection alive (A4F only - CLI Proxy handles its own)
  const HEARTBEAT_INTERVAL = 10000 // 10 seconds (more aggressive)
  const STALL_WARNING = 30000 // Warn if no data for 30 seconds
  const HEARTBEAT = ENC.encode(': heartbeat\n\n')

  const stream = new ReadableStream({
    async start(controller) {
      // Send message_start event
      controller.enqueue(ENC.encode(
        `event: message_start\n` +
        `data: {"type":"message_start","message":{"id":"${messageId}","type":"message","role":"assistant","content":[],"model":"${model}","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":${inputTokens},"output_tokens":0}}}\n\n`
      ))

      let buffer = ''
      let lastActivity = Date.now()
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null
      let streamClosed = false
      let stallWarned = false

      // Start heartbeat timer - keeps connection alive during long A4F thinking
      heartbeatTimer = setInterval(() => {
        if (streamClosed) {
          if (heartbeatTimer) clearInterval(heartbeatTimer)
          return
        }
        const now = Date.now()
        const timeSinceActivity = now - lastActivity

        // Send heartbeat if no recent activity
        if (timeSinceActivity > HEARTBEAT_INTERVAL - 1000) {
          try {
            controller.enqueue(HEARTBEAT)
          } catch {
            streamClosed = true
            if (heartbeatTimer) clearInterval(heartbeatTimer)
          }
        }

        // Warn about stall (only once)
        if (timeSinceActivity > STALL_WARNING && !stallWarned) {
          console.log(`[Claude Bridge] A4F stalled for ${Math.round(timeSinceActivity / 1000)}s - still waiting...`)
          stallWarned = true
        }
      }, HEARTBEAT_INTERVAL / 2) // Check twice per interval

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          lastActivity = Date.now()
          stallWarned = false // Reset stall warning on activity
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            // Fast path: skip non-data lines
            if (line.length < 7 || line[0] !== 'd') continue
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const chunk: OpenAIStreamChunk = JSON.parse(data)

              // Update token counts from usage
              if (chunk.usage) {
                inTok = chunk.usage.prompt_tokens
                outTok = chunk.usage.completion_tokens
                cacheTok = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0
              }

              const delta = chunk.choices?.[0]?.delta

              // Handle thinking/reasoning content
              if (delta?.reasoning_content && thinkingEnabled) {
                if (!thinkingStarted) {
                  blockIdx++
                  controller.enqueue(ENC.encode(
                    `event: content_block_start\n` +
                    `data: {"type":"content_block_start","index":${blockIdx},"content_block":{"type":"thinking","thinking":""}}\n\n`
                  ))
                  thinkingStarted = true
                }
                controller.enqueue(ENC.encode(
                  `event: content_block_delta\n` +
                  `data: {"type":"content_block_delta","index":${blockIdx},"delta":{"type":"thinking_delta","thinking":${JSON.stringify(delta.reasoning_content)}}}\n\n`
                ))
              }

              // Handle text content
              if (delta?.content) {
                // Close thinking block if transitioning to text
                if (thinkingStarted && !textStarted) {
                  controller.enqueue(ENC.encode(
                    `event: content_block_delta\n` +
                    `data: {"type":"content_block_delta","index":${blockIdx},"delta":{"type":"signature_delta","signature":"${generateSignature()}"}}\n\n`
                  ))
                  controller.enqueue(ENC.encode(
                    `event: content_block_stop\n` +
                    `data: {"type":"content_block_stop","index":${blockIdx}}\n\n`
                  ))
                  thinkingStarted = false
                }

                // Start text block if not started
                if (!textStarted) {
                  blockIdx++
                  controller.enqueue(ENC.encode(
                    `event: content_block_start\n` +
                    `data: {"type":"content_block_start","index":${blockIdx},"content_block":{"type":"text","text":""}}\n\n`
                  ))
                  textStarted = true
                }

                accumulatedText += delta.content
                controller.enqueue(ENC.encode(
                  `event: content_block_delta\n` +
                  `data: {"type":"content_block_delta","index":${blockIdx},"delta":{"type":"text_delta","text":${JSON.stringify(delta.content)}}}\n\n`
                ))
              }

              // Handle tool calls
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (tc.id && tc.function?.name) {
                    toolCalls.set(tc.index, {
                      id: tc.id,
                      name: tc.function.name,
                      args: tc.function.arguments ?? ''
                    })
                  } else if (tc.function?.arguments) {
                    const existing = toolCalls.get(tc.index)
                    if (existing) existing.args += tc.function.arguments
                  }
                }
              }

              // Handle finish
              const finish = chunk.choices?.[0]?.finish_reason
              if (finish) {
                // Close thinking block if still open
                if (thinkingStarted) {
                  controller.enqueue(ENC.encode(
                    `event: content_block_delta\n` +
                    `data: {"type":"content_block_delta","index":${blockIdx},"delta":{"type":"signature_delta","signature":"${generateSignature()}"}}\n\n`
                  ))
                  controller.enqueue(ENC.encode(
                    `event: content_block_stop\n` +
                    `data: {"type":"content_block_stop","index":${blockIdx}}\n\n`
                  ))
                }

                // Close text block if open
                if (textStarted) {
                  controller.enqueue(ENC.encode(
                    `event: content_block_stop\n` +
                    `data: {"type":"content_block_stop","index":${blockIdx}}\n\n`
                  ))
                }

                // Emit tool calls
                for (const [, tc] of toolCalls) {
                  blockIdx++
                  controller.enqueue(ENC.encode(
                    `event: content_block_start\n` +
                    `data: {"type":"content_block_start","index":${blockIdx},"content_block":{"type":"tool_use","id":"${tc.id}","name":"${tc.name}","input":{}}}\n\n`
                  ))
                  controller.enqueue(ENC.encode(
                    `event: content_block_delta\n` +
                    `data: {"type":"content_block_delta","index":${blockIdx},"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(tc.args)}}}\n\n`
                  ))
                  controller.enqueue(ENC.encode(
                    `event: content_block_stop\n` +
                    `data: {"type":"content_block_stop","index":${blockIdx}}\n\n`
                  ))
                }

                // Count output tokens if not provided by API
                if (outTok === 0 && accumulatedText) {
                  outTok = countTokens(accumulatedText)
                }

                // Determine stop reason
                const stopReason = toolCalls.size > 0
                  ? 'tool_use'
                  : (STOP_REASON_MAP[finish] ?? 'end_turn')

                // Build usage object
                const usage = cacheTok > 0
                  ? `{"input_tokens":${inTok},"output_tokens":${outTok},"cache_read_input_tokens":${cacheTok}}`
                  : `{"input_tokens":${inTok},"output_tokens":${outTok}}`

                // Send message_delta
                controller.enqueue(ENC.encode(
                  `event: message_delta\n` +
                  `data: {"type":"message_delta","delta":{"stop_reason":"${stopReason}","stop_sequence":null},"usage":${usage}}\n\n`
                ))

                // Send message_stop
                controller.enqueue(SSE_STOP)
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }

        // Cleanup heartbeat timer
        streamClosed = true
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        controller.close()
      } catch (error) {
        streamClosed = true
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        // Only log if it's not an expected "controller closed" error
        const errorMsg = String(error)
        if (!errorMsg.includes('Controller is already closed')) {
          console.error(`[Claude Bridge] Stream error: ${error}`)
        }
        try {
          controller.error(error)
        } catch {
          // Controller already closed, ignore
        }
      }
    },

    cancel() {
      reader.cancel()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
}
