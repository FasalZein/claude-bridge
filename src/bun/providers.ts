// =============================================================================
// Providers
// Model mappings and provider configurations
// =============================================================================

import { config } from './config'
import type { ProviderConfig, ProviderType } from './types'

// =============================================================================
// A4F Model Mappings
// All available models from A4F with their prefixes
// =============================================================================

// Claude models (provider-7)
export const CLAUDE_MODELS: Record<string, string> = {
  // Opus 4.5 family
  'claude-opus-4-5-20251101': 'provider-7/claude-opus-4-5-20251101',
  'claude-opus-4-5': 'provider-7/claude-opus-4-5-20251101',
  'claude-opus-4.5': 'provider-7/claude-opus-4-5-20251101',

  // Sonnet 4 family
  'claude-sonnet-4-20250514': 'provider-7/claude-sonnet-4-20250514',
  'claude-sonnet-4': 'provider-7/claude-sonnet-4-20250514',
  'claude-sonnet-4.5-20250929': 'provider-7/claude-sonnet-4-5-20250929',
  'claude-sonnet-4-5-20250929': 'provider-7/claude-sonnet-4-5-20250929',
  'claude-sonnet-4.5': 'provider-7/claude-sonnet-4-5-20250929',

  // Claude 3.7 Sonnet
  'claude-3-7-sonnet-20250219': 'provider-7/claude-3-7-sonnet-20250219',
  'claude-3.7-sonnet': 'provider-7/claude-3-7-sonnet-20250219',

  // Claude 3.5 family
  'claude-3-5-sonnet-20241022': 'provider-7/claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620': 'provider-7/claude-3-5-sonnet-20240620',
  'claude-3.5-sonnet': 'provider-7/claude-3-5-sonnet-20241022',

  // Haiku models
  'claude-3-5-haiku-20241022': 'provider-7/claude-3-5-haiku-20241022',
  'claude-3.5-haiku': 'provider-7/claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307': 'provider-7/claude-3-haiku-20240307',
  'claude-3-haiku': 'provider-7/claude-3-haiku-20240307',
  'claude-haiku-4-5-20251001': 'provider-7/claude-haiku-4-5-20251001',
  'claude-haiku-4.5': 'provider-7/claude-haiku-4-5-20251001',
}

// Gemini models (provider-3 and provider-8)
export const GEMINI_MODELS: Record<string, string> = {
  // Gemini 3 family (SOTA for background tasks)
  'gemini-3-flash-preview': 'provider-3/gemini-3-flash-preview',
  'gemini-3-flash': 'provider-8/gemini-3-flash',

  // Gemini 2.5 family
  'gemini-2.5-pro': 'provider-3/gemini-2.5-pro',
  'gemini-2.5-flash': 'provider-3/gemini-2.5-flash',
  'gemini-2.5-flash-preview-09-2025': 'provider-3/gemini-2.5-flash-preview-09-2025',
  'gemini-2.5-flash-lite-preview-09-2025': 'provider-3/gemini-2.5-flash-lite-preview-09-2025',

  // Gemini 2.0 family
  'gemini-2.0-flash': 'provider-3/gemini-2.0-flash',

  // Image models
  'gemini-2.5-flash-image-preview': 'provider-3/gemini-2.5-flash-image-preview',
  'gemini-2.5-flash-image': 'provider-4/gemini-2.5-flash-image',
}

// Combined model mapping for A4F
export const A4F_MODELS: Record<string, string> = {
  ...CLAUDE_MODELS,
  ...GEMINI_MODELS,
}

// Background/light models that should use CLI Proxy with Gemini Flash
export const BACKGROUND_MODELS = new Set([
  'claude-3-haiku-20240307',
  'claude-3-haiku',
  'claude-3-5-haiku-20241022',
  'claude-3.5-haiku',
  'claude-haiku-4-5-20251001',
  'claude-haiku-4.5',
  'haiku',
])

// CLI Proxy model mapping (uses Gemini 3 Flash Preview for background tasks)
export const CLI_PROXY_BACKGROUND_MODEL = 'gemini-3-flash-preview'

// CLI Proxy model name mapping (A4F names -> CLIProxy/Antigravity names)
export const CLI_PROXY_MODEL_MAP: Record<string, string> = {
  'claude-opus-4-5-20251101': 'gemini-claude-opus-4-5-thinking',
  'claude-opus-4.5': 'gemini-claude-opus-4-5-thinking',
  'claude-sonnet-4-20250514': 'gemini-claude-sonnet-4-5-thinking',
  'claude-sonnet-4': 'gemini-claude-sonnet-4-5-thinking',
  'claude-sonnet-4-5-20250929': 'gemini-claude-sonnet-4-5-thinking',
  'claude-sonnet-4.5': 'gemini-claude-sonnet-4-5-thinking',
  'claude-haiku-4-5-20251001': 'gemini-3-flash-preview',
  'claude-haiku-4.5': 'gemini-3-flash-preview',
  'gemini-3-flash-preview': 'gemini-3-flash-preview',
}

// SOTA models for Claude Code (Sonnet 4, Opus 4.5, Gemini 3)
export const CLAUDE_CODE_MODELS = {
  primary: 'claude-sonnet-4-20250514',
  thinking: 'claude-opus-4-5-20251101',
  background: 'provider-3/gemini-3-flash-preview',
}

// =============================================================================
// Provider Configurations
// =============================================================================

export function getProvider(type: ProviderType): ProviderConfig {
  switch (type) {
    case 'a4f':
      return {
        name: 'a4f',
        baseUrl: config.a4fBaseUrl,
        apiKey: config.a4fApiKey,
        modelPrefix: 'provider-7/',
        supportsNativeTools: true, // A4F now supports native tools
        supportsThinking: true,
      }
    case 'cli_proxy':
      return {
        name: 'cli_proxy',
        baseUrl: config.cliProxyBaseUrl,
        apiKey: config.cliProxyApiKey,
        modelPrefix: '', // CLI Proxy uses Antigravity model names, no prefix needed
        supportsNativeTools: true,
        supportsThinking: true,
      }
    case 'gemini':
      return {
        name: 'gemini',
        baseUrl: config.a4fBaseUrl, // Use A4F for Gemini models too
        apiKey: config.a4fApiKey,
        modelPrefix: 'provider-3/',
        supportsNativeTools: true,
        supportsThinking: false,
      }
  }
}

// =============================================================================
// Model Resolution
// =============================================================================

/**
 * Map a model name to the appropriate format for the provider
 * - A4F: Uses provider-7/model-name format
 * - CLI Proxy: Uses Antigravity model names (gemini-claude-*)
 */
export function mapModelName(model: string, provider: ProviderConfig): string {
  // For CLI Proxy, use Antigravity model names
  if (provider.name === 'cli_proxy') {
    // Strip any provider prefix first
    const cleanModel = model.replace(/^provider-\d+\//, '')

    // Check if we have a CLI Proxy mapping
    if (CLI_PROXY_MODEL_MAP[cleanModel]) {
      return CLI_PROXY_MODEL_MAP[cleanModel]
    }

    // Return clean model name for CLI Proxy
    return cleanModel
  }

  // For A4F: If already has a provider prefix, return as-is
  if (model.startsWith('provider-')) {
    return model
  }

  // Check if we have a direct A4F mapping
  if (A4F_MODELS[model]) {
    return A4F_MODELS[model]
  }

  // For A4F, add the default Claude prefix if it's a Claude model
  if (provider.name === 'a4f' && model.includes('claude')) {
    return `provider-7/${model}`
  }

  // For Gemini models on A4F
  if (provider.name === 'a4f' && model.includes('gemini')) {
    return `provider-3/${model}`
  }

  // Return as-is for other providers
  return model
}

/**
 * Check if a model should use the background provider (Gemini Flash)
 */
export function isBackgroundModel(model: string): boolean {
  return BACKGROUND_MODELS.has(model)
}

/**
 * Get the best available provider based on configuration
 */
export function getAvailableProvider(preferred: ProviderType): ProviderConfig {
  const provider = getProvider(preferred)

  if (provider.apiKey) {
    return provider
  }

  // Fallback chain: a4f -> cli_proxy
  if (preferred !== 'a4f' && config.a4fApiKey) {
    return getProvider('a4f')
  }

  if (preferred !== 'cli_proxy' && config.cliProxyApiKey) {
    return getProvider('cli_proxy')
  }

  // Return the preferred even without API key (will fail with clear error)
  return provider
}

// =============================================================================
// Available Models for /v1/models endpoint
// =============================================================================

export function getAvailableModels(): Array<{ id: string; object: string; created: number; owned_by: string }> {
  const now = Math.floor(Date.now() / 1000)

  return [
    // Opus 4.5
    { id: 'claude-opus-4-5-20251101', object: 'model', created: now, owned_by: 'anthropic' },

    // Sonnet 4 family
    { id: 'claude-sonnet-4-20250514', object: 'model', created: now, owned_by: 'anthropic' },
    { id: 'claude-sonnet-4-5-20250929', object: 'model', created: now, owned_by: 'anthropic' },

    // Claude 3.7
    { id: 'claude-3-7-sonnet-20250219', object: 'model', created: now, owned_by: 'anthropic' },

    // Claude 3.5 family
    { id: 'claude-3-5-sonnet-20241022', object: 'model', created: now, owned_by: 'anthropic' },
    { id: 'claude-3-5-haiku-20241022', object: 'model', created: now, owned_by: 'anthropic' },

    // Haiku 4.5
    { id: 'claude-haiku-4-5-20251001', object: 'model', created: now, owned_by: 'anthropic' },

    // Gemini 3
    { id: 'gemini-3-flash-preview', object: 'model', created: now, owned_by: 'google' },
    { id: 'gemini-3-flash', object: 'model', created: now, owned_by: 'google' },

    // Gemini 2.5
    { id: 'gemini-2.5-pro', object: 'model', created: now, owned_by: 'google' },
    { id: 'gemini-2.5-flash', object: 'model', created: now, owned_by: 'google' },
  ]
}
