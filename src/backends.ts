// ============================================================================
// Backend Configuration - A4F
// ============================================================================

import type { BackendConfig } from "./types";

// A4F Backend Configuration
export const A4F_CONFIG: BackendConfig = {
  baseUrl: "https://api.a4f.co/v1",
  modelMapping: {
    // A4F uses full model names with provider prefix
    // These are direct mappings for common models
    "claude-sonnet-4-20250514": "provider-7/claude-sonnet-4-20250514",
    "claude-opus-4-5-20251101": "provider-7/claude-opus-4-5-20251101",
    "claude-3-5-sonnet-20241022": "provider-7/claude-3-5-sonnet-20241022",
    "claude-3-haiku-20240307": "provider-7/claude-3-haiku-20240307",
  },
};

/**
 * Get the backend configuration
 */
export function getBackendConfig(): BackendConfig {
  return A4F_CONFIG;
}

/**
 * Map model name for A4F backend
 * A4F requires the provider-7/ prefix for all Claude models
 */
export function mapModelName(model: string): string {
  const config = getBackendConfig();
  
  // Check if there's a direct mapping
  if (config.modelMapping[model]) {
    return config.modelMapping[model];
  }
  
  // Add the provider prefix if not already present
  if (!model.startsWith("provider-7/")) {
    return `provider-7/${model}`;
  }
  
  return model;
}

/**
 * Get the API key for A4F
 */
export function getBackendApiKey(env: { A4F_API_KEY: string }): string {
  return env.A4F_API_KEY;
}