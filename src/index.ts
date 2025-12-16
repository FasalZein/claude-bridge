// ============================================================================
// Claude Bridge - Anthropic API Gateway for A4F
// Main entry point for the Cloudflare Worker
// ============================================================================

import type { Env, AnthropicRequest, OpenAIResponse, AnthropicTextBlock } from "./types";
import { getBackendConfig, mapModelName, getBackendApiKey } from "./backends";
import { convertRequest, convertResponse, estimateRequestTokens } from "./converter";
import { countTokens } from "./tokenizer";
import { streamAndConvert } from "./streaming";

// Request timeout (5 minutes for long-running requests)
const REQUEST_TIMEOUT_MS = 300000;

// ============================================================================
// Constants
// ============================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, x-api-key, Authorization, anthropic-version",
};

// ============================================================================
// Utility Functions
// ============================================================================

function extractApiKey(request: Request): string | null {
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) return xApiKey;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return null;
}

function validateUserApiKey(userKey: string, validKeysString: string): boolean {
  if (!validKeysString) return false;
  const validKeys = validKeysString.split(",").map((k) => k.trim()).filter((k) => k.length > 0);
  return validKeys.includes(userKey);
}

function validateModel(model: string): { valid: boolean; error?: string } {
  if (!model.includes("claude")) {
    return {
      valid: false,
      error: `Model "${model}" is not a Claude model. Only Claude models are supported.`,
    };
  }
  return { valid: true };
}

// ============================================================================
// Request Handlers
// ============================================================================

async function handleMessages(request: Request, env: Env): Promise<Response> {
  // Extract user's API key
  const userApiKey = extractApiKey(request);
  if (!userApiKey) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "authentication_error",
          message: "Missing API key",
        },
      }),
      {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }

  // Validate user's API key
  if (!validateUserApiKey(userApiKey, env.VALID_API_KEYS)) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "authentication_error",
          message: "Invalid API key",
        },
      }),
      {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }

  // Get A4F backend configuration
  const backendConfig = getBackendConfig();
  const backendApiKey = getBackendApiKey(env);

  if (!backendApiKey) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "api_error",
          message: "Server configuration error: A4F API key not configured",
        },
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }

  // Parse request body
  let body: AnthropicRequest;
  try {
    body = (await request.json()) as AnthropicRequest;
  } catch (e) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: e instanceof Error ? e.message : "Invalid JSON",
        },
      }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }

  // Validate model
  const validation = validateModel(body.model || "");
  if (!validation.valid) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: validation.error,
        },
      }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }

  // Map model name for A4F
  const mappedModel = mapModelName(body.model);

  // Convert request to OpenAI format
  // Note: A4F doesn't support native tools API for Claude models
  // Roo Code uses XML tools in system prompt which works fine
  const openaiReq = convertRequest(body, mappedModel);

  // Handle streaming
  if (body.stream) {
    const stream = await streamAndConvert(backendApiKey, backendConfig.baseUrl, openaiReq, body.model);
    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Handle non-streaming
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    
    const response = await fetch(`${backendConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${backendApiKey}`,
      },
      body: JSON.stringify(openaiReq),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Claude Bridge] API Error: ${response.status} - ${errorText}`);
      
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
      
      // Build response headers
      const responseHeaders: Record<string, string> = {
        ...CORS_HEADERS,
        "Content-Type": "application/json"
      };
      
      // Add Anthropic-specific rate limit headers for rate limit errors
      // This helps clients like Roo Code properly recognize rate limits
      if (response.status === 429) {
        // Set rate limit status header
        responseHeaders["anthropic-ratelimit-unified-status"] = "rate_limited";
        
        // Forward or set retry-after header
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) {
          responseHeaders["retry-after"] = retryAfter;
          // Also set the Anthropic-specific reset header (in seconds from epoch)
          const resetTime = Math.floor(Date.now() / 1000) + parseInt(retryAfter, 10);
          responseHeaders["anthropic-ratelimit-unified-reset"] = resetTime.toString();
        } else {
          // Default to 1 second retry
          responseHeaders["retry-after"] = "1";
          responseHeaders["anthropic-ratelimit-unified-reset"] = (Math.floor(Date.now() / 1000) + 1).toString();
        }
      }
      
      return new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: errorType,
            message: errorText,
          },
        }),
        {
          status: response.status,
          headers: responseHeaders,
        }
      );
    }

    const openaiResponse = (await response.json()) as OpenAIResponse;
    const inputTokens = estimateRequestTokens(openaiReq);
    const anthropicResponse = convertResponse(openaiResponse, body.model, inputTokens);

    return new Response(JSON.stringify(anthropicResponse), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[Claude Bridge] Request failed: ${error instanceof Error ? error.message : String(error)}`);
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "api_error",
          message: error instanceof Error ? error.message : String(error),
        },
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }
}

async function handleCountTokens(request: Request): Promise<Response> {
  let body: AnthropicRequest;
  try {
    body = (await request.json()) as AnthropicRequest;
  } catch (e) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: e instanceof Error ? e.message : "Invalid JSON",
        },
      }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }

  let totalTokens = 0;

  // Count system prompt tokens
  if (body.system) {
    if (typeof body.system === "string") {
      totalTokens += countTokens(body.system);
    } else {
      for (const block of body.system) {
        if (block.type === "text" && block.text) {
          totalTokens += countTokens(block.text);
        }
      }
    }
  }

  // Count message tokens
  for (const msg of body.messages || []) {
    if (typeof msg.content === "string") {
      totalTokens += countTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text" && "text" in block) {
          totalTokens += countTokens((block as AnthropicTextBlock).text);
        }
      }
    }
  }

  // Count tool definitions tokens
  if (body.tools) {
    totalTokens += countTokens(JSON.stringify(body.tools));
  }

  return new Response(JSON.stringify({ input_tokens: totalTokens }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function handleHealth(): Response {
  return new Response(
    JSON.stringify({
      status: "ok",
      service: "claude-bridge",
      backend: "a4f",
    }),
    {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
}

interface BackendModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface BackendModelsResponse {
  object: string;
  data: BackendModel[];
}

async function handleModels(env: Env): Promise<Response> {
  const backendConfig = getBackendConfig();
  const backendApiKey = getBackendApiKey(env);

  try {
    const url = `${backendConfig.baseUrl}/models?plan=ultra`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${backendApiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "api_error",
            message: `Failed to fetch models: ${errorText}`,
          },
        }),
        {
          status: response.status,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    const backendResponse = (await response.json()) as BackendModelsResponse;

    // Filter for Claude models
    const claudeModels = backendResponse.data
      .filter((model) => model.id.toLowerCase().includes("claude"))
      .map((model) => ({
        id: model.id.replace("provider-7/", ""), // Remove A4F prefix if present
        object: "model",
        created: model.created || Date.now(),
        owned_by: "anthropic",
      }));

    return new Response(JSON.stringify({ object: "list", data: claudeModels }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "api_error",
          message: `Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`,
        },
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

function handleNotFound(request: Request): Response {
  const url = new URL(request.url);
  return new Response(
    JSON.stringify({
      type: "error",
      error: {
        type: "not_found",
        message: `Endpoint ${request.method} ${url.pathname} not found`,
      },
    }),
    {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
}

// ============================================================================
// Main Handler
// ============================================================================

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return handleOptions();
    }

    // Route requests
    if (pathname === "/v1/messages" && method === "POST") {
      return handleMessages(request, env);
    }

    if (pathname === "/v1/messages/count_tokens" && method === "POST") {
      return handleCountTokens(request);
    }

    if (pathname === "/health" && method === "GET") {
      return handleHealth();
    }

    if (pathname === "/v1/models" && method === "GET") {
      return handleModels(env);
    }

    // Silently accept telemetry/logging endpoints (used by Claude Code)
    if (pathname.startsWith("/api/event_logging") || pathname.startsWith("/api/telemetry")) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Catch-all for unhandled routes
    return handleNotFound(request);
  },
};