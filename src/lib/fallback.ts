// Model fallback: try each model in order; an error, a timeout or an unusable reply moves to the next one.
// No imports (unit-tested directly); lib/models.ts supplies the real model calls.

export type Attempt<T> = { id: string; timeoutMs: number; run: (signal: AbortSignal) => Promise<T> };
export type Served<T> = { value: T; model: string; ms: number; tried: string[] };

export class AllModelsFailed extends Error {
  readonly failures: { model: string; reason: string }[];
  constructor(label: string, failures: { model: string; reason: string }[]) {
    super(`${label}: every model failed (${failures.map((f) => `${f.model}: ${f.reason}`).join("; ")})`);
    this.failures = failures;
  }
}

const reasonOf = (err: unknown, signal: AbortSignal) =>
  signal.aborted ? "timeout" : err instanceof Error ? err.message.slice(0, 160) : "unknown error";

/**
 * Runs the attempts in order until one returns a value that `accept` takes. Each attempt gets its own
 * timeout (an AbortSignal it must pass to the model call). Throws AllModelsFailed when none did.
 */
export async function withFallback<T>(
  label: string,
  attempts: Attempt<T>[],
  accept: (value: T) => boolean,
  log: (line: string) => void = () => {},
): Promise<Served<T>> {
  const failures: { model: string; reason: string }[] = [];
  for (const a of attempts) {
    const ctl = new AbortController();
    const signal = ctl.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t = Date.now();
    try {
      // Race the call against its own timeout too, so a provider that ignores the signal cannot hang the chain.
      const value = await Promise.race([
        a.run(signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            ctl.abort();
            reject(new Error("timeout"));
          }, a.timeoutMs);
        }),
      ]);
      clearTimeout(timer);
      const ms = Date.now() - t;
      if (accept(value)) {
        log(`${label} served by ${a.id} in ${ms} ms${failures.length ? ` after ${failures.map((f) => `${f.model} (${f.reason})`).join(", ")}` : ""}`);
        return { value, model: a.id, ms, tried: [...failures.map((f) => f.model), a.id] };
      }
      failures.push({ model: a.id, reason: "empty or unusable reply" });
    } catch (err) {
      clearTimeout(timer);
      failures.push({ model: a.id, reason: reasonOf(err, signal) });
    }
  }
  throw new AllModelsFailed(label, failures);
}
