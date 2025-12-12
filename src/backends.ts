// ============================================================================
// Backend Configurations
// ============================================================================

import type { BackendType, BackendConfig } from "./types";

export const BACKENDS: Record<BackendType, BackendConfig> = {
  a4f: {
    baseUrl: "https://api.a4f.co/v1",
    format: "openai",
    modelMapping: {
      // A4F uses full model names with provider prefix
      // These are direct mappings for common models
      "claude-sonnet-4-20250514": "provider-7/claude-sonnet-4-20250514",
      "claude-opus-4-5-20251101": "provider-7/claude-opus-4-5-20251101",
      "claude-3-5-sonnet-20241022": "provider-7/claude-3-5-sonnet-20241022",
      "claude-3-haiku-20240307": "provider-7/claude-3-haiku-20240307",
    },
  },
  algion: {
    baseUrl: "https://api.algion.dev/v1",
    format: "openai", // Algion also supports OpenAI-compatible format
    modelMapping: {
      // Algion uses simplified model names
      // Direct mappings
      "claude-sonnet-4": "claude-sonnet-4",
      "claude-opus-4.5": "claude-opus-4.5",
      "claude-sonnet-4.5": "claude-sonnet-4.5",
      "claude-haiku-4.5": "claude-haiku-4.5",
    },
  },
};

/**
 * Get the backend configuration
 */
export function getBackendConfig(backend: string): BackendConfig {
  const backendType = (backend || "a4f").toLowerCase() as BackendType;
  return BACKENDS[backendType] || BACKENDS.a4f;
}

/**
 * Map model name for the specific backend using pattern matching
 */
export function mapModelName(model: string, backend: string): string {
  const config = getBackendConfig(backend);
  const modelLower = model.toLowerCase();
  
  // Check if there's a direct mapping
  if (config.modelMapping[model]) {
    return config.modelMapping[model];
  }
  
  // For Algion, use pattern matching to map to simplified names
  if (backend.toLowerCase() === "algion") {
    // Claude Opus 4.5 variants (opus-4-5, opus-4.5, opus-45)
    if (modelLower.includes("opus-4-5") || modelLower.includes("opus-4.5") || modelLower.includes("opus-45")) {
      return "claude-opus-4.5";
    }
    
    // Claude Sonnet 4.5 variants
    if (modelLower.includes("sonnet-4-5") || modelLower.includes("sonnet-4.5") || modelLower.includes("sonnet-45")) {
      return "claude-sonnet-4.5";
    }
    
    // Claude Sonnet 4 variants (but not 4.5)
    if (modelLower.includes("sonnet-4") && !modelLower.includes("sonnet-4-5") && !modelLower.includes("sonnet-4.5") && !modelLower.includes("sonnet-45")) {
      return "claude-sonnet-4";
    }
    
    // Claude Haiku 4.5 variants
    if (modelLower.includes("haiku-4-5") || modelLower.includes("haiku-4.5") || modelLower.includes("haiku-45")) {
      return "claude-haiku-4.5";
    }
    
    // Claude Haiku 4 variants
    if (modelLower.includes("haiku-4") && !modelLower.includes("haiku-4-5") && !modelLower.includes("haiku-4.5") && !modelLower.includes("haiku-45")) {
      return "claude-haiku-4.5"; // Map to 4.5 as fallback
    }
    
    // Claude 3.5 Sonnet
    if (modelLower.includes("3-5-sonnet") || modelLower.includes("3.5-sonnet")) {
      return "claude-sonnet-4.5";
    }
    
    // Claude 3 Haiku
    if (modelLower.includes("3-haiku") || modelLower.includes("3.0-haiku")) {
      return "claude-haiku-4.5";
    }
    
    // Default: return as-is (will likely fail, but at least shows the error)
    return model;
  }
  
  // For A4F, add the provider prefix if not already present
  if (backend.toLowerCase() === "a4f" && !model.startsWith("provider-7/")) {
    return `provider-7/${model}`;
  }
  
  return model;
}

/**
 * Get the API key for the backend
 */
export function getBackendApiKey(env: { A4F_API_KEY: string; ALGION_API_KEY: string }, backend: string): string {
  const backendType = (backend || "a4f").toLowerCase();
  return backendType === "algion" ? env.ALGION_API_KEY : env.A4F_API_KEY;
}