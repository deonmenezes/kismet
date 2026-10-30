import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, type LanguageModel } from "ai";
import { withFallback, type Attempt } from "./fallback.ts";

// Text models for dates and persona cards: GMI Cloud (OpenAI-compatible) first, the AI Gateway's Haiku last.
// Reasoning is off on every model: these are short structured calls, and with reasoning on DeepSeek spends
// the whole output budget thinking and returns no text. Embeddings and the photo check stay on the gateway.

export const GMI_BASE_URL = "https://api.gmi-serving.com/v1";
export const GATEWAY_MODEL = "anthropic/claude-haiku-5.5";

type Options = Parameters<typeof generateText>[0];
type Spec = { id: string; model: () => LanguageModel; providerOptions: NonNullable<Options["providerOptions"]>; timeoutMs: number };

let gmiProvider: ReturnType<typeof createOpenAICompatible> | null | undefined;
const gmi = () =>
  (gmiProvider ??= process.env.GMI_API_KEY
    ? // Structured outputs (json_schema): in plain JSON mode a third of the dates came back off-schema.
      createOpenAICompatible({ name: "gmi", baseURL: GMI_BASE_URL, apiKey: process.env.GMI_API_KEY, supportsStructuredOutputs: true })
    : null);

const NO_REASONING_GMI = { gmi: { reasoningEffort: "none" } };
// Haiku thinks adaptively; thinking off keeps these calls cheap and never empty.
const NO_THINKING_ANTHROPIC = { anthropic: { thinking: { type: "disabled" } } };
/** Anthropic prompt caching for the fixed instructions (ignored by the other providers). */
export const CACHED = { anthropic: { cacheControl: { type: "ephemeral" } } };

/** The chain, in order. Without GMI_API_KEY only the gateway model is used. */
export function textModels(): Spec[] {
  const p = gmi();
  const gateway: Spec = { id: GATEWAY_MODEL, model: () => GATEWAY_MODEL, providerOptions: NO_THINKING_ANTHROPIC, timeoutMs: 25_000 };
  if (!p) return [gateway];
  return [
    { id: "gmi/deepseek-ai/DeepSeek-V4.1-Flash", model: () => p("deepseek-ai/DeepSeek-V4.1-Flash"), providerOptions: NO_REASONING_GMI, timeoutMs: 20_000 },
    { id: "gmi/google/gemini-3.5-flash-lite", model: () => p("google/gemini-3.5-flash-lite"), providerOptions: NO_REASONING_GMI, timeoutMs: 15_000 },
    gateway,
  ];
}

type Call = Omit<Options, "model" | "providerOptions" | "abortSignal">;

/**
 * One text generation through the fallback chain. `accept` decides whether a reply is usable (default:
 * non-empty); an error, a timeout or an unusable reply moves on to the next model. Logs which model served.
 */
export async function generateWithFallback(label: string, call: Call, accept: (text: string) => boolean = (t) => t.trim().length > 0, outer?: AbortSignal) {
  const attempts: Attempt<string>[] = textModels().map((m) => ({
    id: m.id,
    timeoutMs: m.timeoutMs,
    run: async (signal) => {
      try {
        // `outer`: the caller's own deadline cancels the request in flight too (and every model after it).
        const abortSignal = outer ? AbortSignal.any([signal, outer]) : signal;
        const res = await generateText({ ...call, model: m.model(), providerOptions: m.providerOptions, abortSignal } as Options);
        return res.text;
      } catch (err) {
        // Unparseable structured output: hand the raw text to `accept` (it decides whether to move on).
        if (NoObjectGeneratedError.isInstance(err)) return err.text ?? "";
        throw err;
      }
    },
  }));
  const served = await withFallback(label, attempts, accept, (line) => console.log(line));
  return { text: served.value, model: served.model, ms: served.ms };
}
