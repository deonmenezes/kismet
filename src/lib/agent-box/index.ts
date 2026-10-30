import { Daytona, type Sandbox } from "@daytonaio/sdk";
import { Output } from "ai";
import { generateWithFallback } from "../models";
import { stripContacts } from "../contacts";
import { assembleDate, TURNS, verdictOnlySchema, type DateInput, type RawVerdict, type Side, type WrittenDate } from "../date-writer";
import { BOX_PROGRAM, BOX_PROGRAM_VERSION } from "./box-program";

// Every person's agent in its own box (Daytona sandbox), after Agent Village's one-agent-per-resident model.
// Security model:
// - A box has ALL network blocked and holds no secrets: only that person's agent card (already free of contact
//   details, relationship status, gender and orientation) and its agent's own memory of past dates (taste, never
//   names). Kismet's keys never enter a box.
// - A date runs turn by turn: each box builds its own agent's prompt from its own card plus the lines the other
//   agent actually said; Kismet calls the model and gives the line back. No model call ever sees both cards.
// - Nothing a box returns is trusted: sizes are capped, lines are clipped and stripped of contact details, verdicts
//   are schema-checked and normalised (date-writer assembleDate), exactly like the one-call writer.
// - The box is named after the account id only (no name or email) and is deleted with the account.
// Off unless AGENT_BOXES=daytona and DAYTONA_API_KEY are set; any failure falls back to the one-call writer.

export const agentBoxesOn = () => process.env.AGENT_BOXES === "daytona" && Boolean(process.env.DAYTONA_API_KEY);

let client: Daytona | null = null;
// Every Daytona call gives up after 60 s (the SDK's default is a day): a slow Daytona never holds a function to its limit.
const daytona = () => (client ??= new Daytona({ apiKey: process.env.DAYTONA_API_KEY, apiUrl: process.env.DAYTONA_API_URL || undefined, requestTimeoutMs: 60_000 }));
const boxName = (userId: string) => `kismet-${userId}`;
const MAX_PROMPT = 8000;
const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;

/** This person's box: found by name, created on first use (network blocked), started, program up to date. */
async function boxFor(userId: string): Promise<Sandbox> {
  const d = daytona();
  let box: Sandbox | null = await d.get(boxName(userId)).catch(() => null);
  if (!box) {
    box = await d.create({
      name: boxName(userId),
      language: "typescript",
      labels: { app: "kismet" },
      networkBlockAll: true,
      public: false,
      autoStopInterval: 3, // minutes idle: a box only runs while its agent is on a date (idle time is what costs)
      autoArchiveInterval: 60 * 24 * 3,
    }, { timeout: 90 });
  }
  if (box.state !== "started") await box.start(90);
  const version = (await box.process.executeCommand("cat kismet/VERSION 2>/dev/null || true", undefined, undefined, 20)).result.trim();
  if (version !== BOX_PROGRAM_VERSION) {
    await box.process.executeCommand("mkdir -p kismet", undefined, undefined, 20);
    await box.fs.uploadFile(Buffer.from(BOX_PROGRAM), "kismet/agent.mjs");
    await box.fs.uploadFile(Buffer.from(BOX_PROGRAM_VERSION), "kismet/VERSION");
  }
  return box;
}

/** Runs one box command with a JSON request; parses the last stdout line. */
async function run<T>(box: Sandbox, cmd: "card" | "turn" | "verdict" | "remember", req: unknown): Promise<T> {
  const r = await box.process.executeCommand(`node kismet/agent.mjs ${cmd}`, undefined, { KISMET_REQ: Buffer.from(JSON.stringify(req)).toString("base64") }, 30);
  if (r.exitCode !== 0) throw new Error(`agent box ${cmd} failed (exit ${r.exitCode})`);
  return JSON.parse(r.result.trim().split("\n").at(-1) ?? "null") as T;
}

type Built = { system: string; prompt: string };
const built = (b: Built) => {
  if (typeof b?.system !== "string" || typeof b?.prompt !== "string" || b.system.length > MAX_PROMPT || b.prompt.length > MAX_PROMPT) {
    throw new Error("agent box returned an unusable prompt");
  }
  return b;
};

const parses = (text: string) => {
  try {
    return verdictOnlySchema.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
};

/** A whole date, each agent in its own box. Throws on any failure (the caller falls back to one call). */
export async function boxedDate(aId: string, bId: string, input: DateInput, served: { model: string }): Promise<WrittenDate> {
  const [boxA, boxB] = await Promise.all([boxFor(aId), boxFor(bId)]);
  const card = (s: Side) => ({ me: { name: s.name, agent: s.agent, card: s.card, goals: s.goals, voice: s.voice, tags: s.tags } });
  await Promise.all([run(boxA, "card", card(input.a)), run(boxB, "card", card(input.b))]);

  const lines: string[] = [];
  const view = (mine: 0 | 1) => lines.map((text, i) => ({ mine: i % 2 === mine, text }));
  for (let i = 0; i < TURNS; i++) {
    const speaker = i % 2 === 0 ? boxA : boxB;
    const p = built(await run<Built>(speaker, "turn", { mode: input.mode, transcript: view(i % 2 === 0 ? 0 : 1) }));
    // A line that assumes a gender is not usable: the chain moves on to the next model, and only if every model
    // does it is the plain line taken (it is still a fine date).
    const call = { system: p.system, prompt: p.prompt, maxOutputTokens: 160 };
    const out = await generateWithFallback("box turn", call, (t) => t.trim().length > 0 && !GENDERED.test(t))
      .catch(() => generateWithFallback("box turn", call));
    served.model = `box/${out.model}`;
    lines.push(stripContacts(out.text.replace(/\s+/g, " ").trim()));
  }

  const verdictOf = async (box: Sandbox, mine: 0 | 1) => {
    const p = built(await run<Built>(box, "verdict", { mode: input.mode, transcript: view(mine) }));
    const out = await generateWithFallback("box verdict", { system: p.system, prompt: p.prompt, output: Output.object({ schema: verdictOnlySchema }), maxOutputTokens: 300 }, parses);
    return verdictOnlySchema.parse(JSON.parse(out.text)) as RawVerdict;
  };
  const [va, vb] = await Promise.all([verdictOf(boxA, 0), verdictOf(boxB, 1)]);
  const date = assembleDate(lines, va, vb);

  // Each agent remembers what it learned, for its own human only: taste and outcome, never the other person.
  const lesson = (s: Side, v: RawVerdict) => `A ${input.mode} date (${s.tags.slice(0, 3).join(", ") || "general"}): ${Math.round(v.score)}/10, ${v.meet ? "worth meeting" : "not a fit"}.`;
  await Promise.all([run(boxA, "remember", { line: lesson(input.a, va) }), run(boxB, "remember", { line: lesson(input.b, vb) })]).catch(() => {});
  return date;
}

/** FORGET EVERYTHING: the agent's memory in their box is wiped (if they have a box). */
export async function forgetBox(userId: string) {
  if (!process.env.DAYTONA_API_KEY) return;
  const box = await daytona().get(boxName(userId)).catch(() => null);
  if (!box) return;
  if (box.state !== "started") await box.start(90);
  // Plain shell, so it works whatever version of the program the box still has.
  const r = await box.process.executeCommand("mkdir -p kismet && rm -f kismet/me.json && echo '[]' > kismet/memory.json", undefined, undefined, 30);
  if (r.exitCode !== 0) throw new Error(`agent box forget failed (exit ${r.exitCode})`);
}

/** Daytona says there is no such box (never made, or already deleted). */
const gone = (e: unknown) => [404, 410].includes((e as { statusCode?: number } | null)?.statusCode ?? 0);
/** A box Daytona is already destroying, or has destroyed (it may still answer for it for a while). */
const destroyed = (box: Sandbox) => /^destroy/.test(String(box.state ?? ""));

/**
 * Deletes a person's box (account deletion), whenever Daytona is configured (also after boxes were switched off).
 * Resolves when the box is gone or never existed; throws otherwise, so the caller queues a retry (lib/deletion-jobs.ts).
 */
export async function deleteBox(userId: string) {
  if (!process.env.DAYTONA_API_KEY) return;
  let box: Sandbox;
  try {
    box = await daytona().get(boxName(userId));
  } catch (e) {
    if (gone(e)) return;
    throw e;
  }
  if (destroyed(box)) return;
  await box.delete(60).catch((e) => {
    if (!gone(e)) throw e;
  });
}
