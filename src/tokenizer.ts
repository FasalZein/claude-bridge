// ============================================================================
// Tokenizer - Pre-warmed on module load to avoid cold start delays
// ============================================================================

import { fromPreTrained } from "@lenml/tokenizer-claude";

// Pre-warm the tokenizer on module load
// This prevents delays on the first request
let tokenizer: ReturnType<typeof fromPreTrained>;

try {
  tokenizer = fromPreTrained();
} catch (error) {
  console.error(`[Claude Bridge] Failed to initialize tokenizer: ${error}`);
  // Create a fallback that estimates tokens (4 chars per token average)
  tokenizer = {
    encode: (text: string) => {
      const estimatedTokens = Math.ceil(text.length / 4);
      return new Array(estimatedTokens).fill(0);
    },
  } as ReturnType<typeof fromPreTrained>;
}

/**
 * Count tokens using the Claude tokenizer
 */
export function countTokens(text: string): number {
  try {
    const encoded = tokenizer.encode(text, { add_special_tokens: false });
    return encoded.length;
  } catch {
    // Fallback: estimate ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}