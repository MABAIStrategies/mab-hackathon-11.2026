// Claude API list prices, USD per million tokens.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-06).
// Update by re-reading that page. Never guess a rate.

export type ModelId = "claude-sonnet-5-5" | "claude-haiku-5-5";

interface RateTier {
  /** Applies when total prompt tokens (input + cache writes + cache reads) are <= this. */
  maxPromptTokens: number;
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheRead: number;
}

export const RATES: Record<ModelId, RateTier[]> = {
  "claude-sonnet-5-5": [
    { maxPromptTokens: Number.POSITIVE_INFINITY, input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.1 },
  ],
  "claude-haiku-5-5": [
    { maxPromptTokens: 100_000, input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheRead: 0.01 },
    { maxPromptTokens: Number.POSITIVE_INFINITY, input: 0.5, output: 2.5, cacheWrite5m: 0.625, cacheRead: 0.05 },
  ],
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function estimateCostUSD(model: ModelId, usage: TokenUsage): number {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const promptTokens = usage.input_tokens + cacheWrite + cacheRead;
  const tier = RATES[model].find((t) => promptTokens <= t.maxPromptTokens);
  if (!tier) throw new Error(`No rate tier for ${model}`);
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  return (
    usage.input_tokens * perToken(tier.input) +
    usage.output_tokens * perToken(tier.output) +
    cacheWrite * perToken(tier.cacheWrite5m) +
    cacheRead * perToken(tier.cacheRead)
  );
}
