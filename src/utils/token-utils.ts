import type { Usage } from '../types/usage.js';

export type ModelPricingKey =
  | "gpt-5.1"
  | "gpt-5"
  | "gpt-5-mini"
  | "gpt-5-nano";

type Pricing = {
  input: number;
  cachedInput: number;
  output: number;
};

const TOKENS_PER_MILLION = 1_000_000;

const MODEL_PRICING: Record<ModelPricingKey, Pricing> = {
  "gpt-5.1": {
    input: 1.25,
    cachedInput: 0.125,
    output: 10,
  },
  "gpt-5": {
    input: 1.25,
    cachedInput: 0.125,
    output: 10,
  },
  "gpt-5-mini": {
    input: 0.25,
    cachedInput: 0.025,
    output: 2,
  },
  "gpt-5-nano": {
    input: 0.05,
    cachedInput: 0.005,
    output: 0.4,
  },
};

export function calculateUsageCost(
  usage: Usage,
  model: ModelPricingKey,
  options?: { cachedInputTokens?: number; currencyMultiplier?: number },
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(`Unsupported model for cost calculation: ${model}`);
  }

  const cachedInputTokens = Math.max(
    options?.cachedInputTokens ?? usage.cachedInputTokens ?? 0,
    0,
  );
  const currencyMultiplier = Number.isFinite(options?.currencyMultiplier)
    ? (options?.currencyMultiplier as number)
    : 1;
  const billableInputTokens = Math.max(
    usage.inputTokens - cachedInputTokens,
    0,
  );

  const inputCost = (billableInputTokens / TOKENS_PER_MILLION) * pricing.input;
  const cachedInputCost =
    (cachedInputTokens / TOKENS_PER_MILLION) * pricing.cachedInput;
  const outputCost =
    (Math.max(usage.outputTokens, 0) / TOKENS_PER_MILLION) *
    pricing.output;

  return (inputCost + cachedInputCost + outputCost) * currencyMultiplier;
}

// ---------------------------------------------------------
// トークン使用量集計ヘルパー
// ---------------------------------------------------------
export function accumulateUsage(totals: Usage, usage: unknown) {
  if (!usage || typeof usage !== "object") return;

  const input = Number(
    (usage as any).input_tokens ?? (usage as any).prompt_tokens,
  );
  const output = Number(
    (usage as any).output_tokens ?? (usage as any).completion_tokens,
  );
  const total = Number((usage as any).total_tokens);
  const cachedInput = Number(
    (usage as any)?.input_tokens_details?.cached_tokens ??
    (usage as any)?.prompt_tokens_details?.cached_tokens,
  );

  if (Number.isFinite(input)) totals.inputTokens += input;
  if (Number.isFinite(output)) totals.outputTokens += output;
  if (Number.isFinite(cachedInput)) {
    totals.cachedInputTokens = (totals.cachedInputTokens ?? 0) + cachedInput;
  }
  if (Number.isFinite(total)) {
    totals.totalTokens += total;
  } else if (Number.isFinite(input) && Number.isFinite(output)) {
    totals.totalTokens += input + output;
  }
}
