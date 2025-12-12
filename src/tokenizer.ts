// ============================================================================
// Tokenizer
// ============================================================================

import { fromPreTrained } from "@lenml/tokenizer-claude";

let tokenizer: ReturnType<typeof fromPreTrained> | null = null;

function getTokenizer(): ReturnType<typeof fromPreTrained> {
  if (!tokenizer) {
    tokenizer = fromPreTrained();
  }
  return tokenizer;
}

/**
 * Count tokens using the Claude tokenizer
 */
export function countTokens(text: string): number {
  const tok = getTokenizer();
  const encoded = tok.encode(text, { add_special_tokens: false });
  return encoded.length;
}