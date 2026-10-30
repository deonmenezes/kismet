// Authenticated MCP tools for Agent Village (app-token auth): the partner ops of /api/village/<op> as tools
// on /mcp. They appear only when the request carries the partner bearer (Agent Village's MINI_APP_KISMET_KEY,
// our VILLAGE_PARTNER_KEY) and a valid X-Village-Subject; each call acts for that one resident. No database
// or framework imports: src/app/mcp/route.ts passes the runner (lib/village-ops.ts), so this is unit-tested.
import { AVAILABILITY, GENDER, INTERESTED_IN, LOOKING_FOR, OPENNESS, REL_STATUS } from "./options.ts";
import { parseSubject, parseVillageRequest, partnerAuth, type VillageOp, type VillageRequest } from "./village.ts";

/** Bound on one serialized response with a resident's data, under Agent Village's 262144. */
export const PARTNER_MAX_RESPONSE_BYTES = 196_608;

export type PartnerResult = { status: number; body: Record<string, unknown> };
export type RunPartnerOp = (req: VillageRequest) => Promise<PartnerResult>;

/** Who is calling /mcp: anyone (public tools only), a refused partner, or the partner acting for one resident. */
export type Caller =
  | { kind: "public" }
  | { kind: "refused"; error: string; message: string }
  | { kind: "resident"; subject: string; run: RunPartnerOp };

export const PUBLIC_CALLER: Caller = { kind: "public" };

/** From the request headers. No Authorization header at all is the public server, exactly as before. */
export function partnerCaller(authorization: string | null, subjectHeader: string | null, key: string | undefined, run: RunPartnerOp): Caller {
  if (authorization === null) return PUBLIC_CALLER;
  const auth = partnerAuth(authorization, key);
  if (auth === "disabled") return { kind: "refused", error: "partner_api_disabled", message: "The partner API is not configured." };
  if (auth !== "ok") return { kind: "refused", error: "unauthorized", message: "Send Authorization: Bearer <partner key>." };
  const subject = parseSubject(subjectHeader);
  if (!subject) return { kind: "refused", error: "missing_subject", message: "Send the resident's id in the X-Village-Subject header." };
  if ("error" in subject) return { kind: "refused", error: "invalid_subject", message: subject.error };
  return { kind: "resident", subject: subject.subject, run };
}

const ids = (list: readonly { id: string }[]) => list.map((o) => o.id);
const UUID = { type: "string", format: "uuid" };
const TELEGRAM = { type: "string", pattern: "^@?[A-Za-z0-9_]{4,32}$" };
const NOTES = { type: "array", items: { type: "string", minLength: 1, maxLength: 280 }, minItems: 1, maxItems: 10 };

/** The quiz answers, as parseProfile (lib/validate.ts) reads them with /llms.txt's field names. */
const ANSWERS = {
  type: "object",
  description: "The owner's quiz answers (as /llms.txt asks them, one at a time). Omit skipped optional fields.",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 40, description: "Shown to others." },
    status: { type: "string", enum: ids(REL_STATUS), description: "Private. Default undisclosed." },
    openness: { type: "string", enum: ids(OPENNESS), description: "Private; only if single or complicated." },
    lookingFor: { type: "array", items: { type: "string", enum: ids(LOOKING_FOR) }, minItems: 1, maxItems: 6 },
    gender: { type: "string", enum: ids(GENDER), description: "Private; only with romance." },
    interestedIn: { type: "string", enum: ids(INTERESTED_IN), description: "Private; only with romance." },
    interests: { type: "array", items: { type: "string", minLength: 1, maxLength: 30 }, maxItems: 15, description: "Ask for 3 or more." },
    about: { type: "string", maxLength: 160, description: "One line." },
    availability: { type: "string", enum: ids(AVAILABILITY) },
    area: { type: "string", maxLength: 40, description: "Where they stay." },
    telegram: { ...TELEGRAM, description: "Telegram username, shown only to matches. Required here or as the top-level telegram." },
    agentProfile: { type: "string", maxLength: 1500, description: "Under 150 words, first person, no contacts, status or orientation." },
    publicQuotes: { type: "boolean", description: "Allow anonymous best lines on the public Village Board. Default false." },
    agreedToTerms: { type: "boolean", const: true, description: "The owner agreed to the Terms (/terms)." },
    ageConfirmed: { type: "boolean", const: true, description: "The owner is 18 or older." },
  },
  required: ["name", "lookingFor", "interests", "agreedToTerms", "ageConfirmed"],
  additionalProperties: false,
};

const schema = (properties: Record<string, unknown>, required: string[] = []) =>
  ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false });

export type PartnerTool = {
  name: string; title: string; description: string; inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>; op: VillageOp;
};

const writes = (destructiveHint: boolean, idempotentHint: boolean) => ({ readOnlyHint: false, destructiveHint, idempotentHint, openWorldHint: false });

export const PARTNER_TOOLS: PartnerTool[] = [
  {
    name: "kismet_signup", op: "signup", title: "Sign up for Kismet",
    description: "Signs this resident up with their quiz answers (only after they said yes to signing up), or updates the answers of their existing account; their agent then goes on its first dates. Optional notes: short facts about them (no contact details).",
    inputSchema: schema({
      answers: ANSWERS,
      telegram: { ...TELEGRAM, description: "The pairing's Telegram username, used when answers has none (as the HTTP API's telegram)." },
      notes: NOTES,
    }, ["answers"]),
    annotations: writes(false, false),
  },
  {
    name: "kismet_summary", op: "summary", title: "Kismet summary",
    description: "This resident's Kismet summary: dates, recommendations (dateId, targetId) waiting for a meet/pass answer, matches and the weekly drop. Like any visit, it may send their agent on new dates. Relay the text.",
    inputSchema: schema({}),
    annotations: writes(false, false),
  },
  {
    name: "kismet_go", op: "go", title: "Go on dates",
    description: "Sends this resident's agent on new dates (up to 3 new people a day). Optional targetId (from the summary) asks for a date with that person.",
    inputSchema: schema({ targetId: { ...UUID, description: "A targetId from the summary." } }),
    annotations: writes(false, false),
  },
  {
    name: "kismet_decide", op: "decide", title: "Meet or pass",
    description: "Records this resident's own meet/pass answer for one of their finished dates. Final. A match only when both humans say meet; nobody learns the other's answer otherwise.",
    inputSchema: schema({ dateId: { ...UUID, description: "A dateId from the summary." }, decision: { type: "string", enum: ["meet", "pass"] } }, ["dateId", "decision"]),
    annotations: writes(false, true),
  },
  {
    name: "kismet_notes", op: "notes", title: "What the agent knows",
    description: "Facts this resident's agent knows about them. No arguments lists them; or one of add (new facts), deleteId (one note) or deleteAll: true.",
    inputSchema: schema({ add: NOTES, deleteId: { ...UUID, description: "A note id from the list." }, deleteAll: { type: "boolean" } }),
    annotations: writes(true, false),
  },
  {
    name: "kismet_delete", op: "delete", title: "Delete Kismet account",
    description: "Deletes this resident's Kismet account, dates and matches. Only when they ask.",
    inputSchema: schema({}),
    annotations: writes(true, true),
  },
];

export const isPartnerTool = (name: string) => PARTNER_TOOLS.some((t) => t.name === name);

/** tools/list entries (no internal op). */
export const partnerToolList = () =>
  PARTNER_TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));

/** Exact arguments (the schema's keys only), then the same request checks as the HTTP API, for this resident. */
export function partnerRequest(name: string, args: unknown, subject: string): VillageRequest | { error: string } {
  const tool = PARTNER_TOOLS.find((t) => t.name === name)!;
  if (args === undefined || args === null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) return { error: "arguments must be an object" };
  const a = args as Record<string, unknown>;
  const allowed = Object.keys(tool.inputSchema.properties as object);
  const extra = Object.keys(a).find((k) => !allowed.includes(k));
  if (extra) return { error: `unknown argument: ${extra}` };
  return parseVillageRequest(tool.op, { ...a, residentId: subject });
}

/**
 * The text to relay first, then the same JSON as structuredContent (the MCP spec's text copy for clients that
 * read only content; the summary text leaves out ids such as targetId).
 */
const toolResult = (text: string, body: Record<string, unknown>, isError: boolean) =>
  ({ content: [{ type: "text", text }, { type: "text", text: JSON.stringify(body) }], structuredContent: body, ...(isError ? { isError: true } : {}) });
const errorResult = (error: string, message: string) => toolResult(message, { ok: false, error, message }, true);

/** A database data exception (SQLSTATE class 22: a value it can't store or read): the input's fault, not ours. */
export const isInputError = (e: unknown) => {
  const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.startsWith("22");
};
export const INPUT_ERROR_TEXT = "a value has characters or a format Kismet can't store. Fix that value and send it again.";

/** One authenticated tool call -> the MCP tool result: the HTTP body as structuredContent, its text first in content. */
export async function callPartnerTool(name: string, args: unknown, caller: Caller): Promise<Record<string, unknown>> {
  if (caller.kind === "public") {
    return errorResult("unauthorized", `${name} needs Agent Village's app token (Authorization: Bearer) and the X-Village-Subject header.`);
  }
  if (caller.kind === "refused") return errorResult(caller.error, caller.message);
  const req = partnerRequest(name, args, caller.subject);
  if ("error" in req) return errorResult("invalid_request", `Invalid arguments for ${name}: ${req.error}`);
  let out: PartnerResult;
  try {
    out = await caller.run(req);
  } catch (e) {
    // A value the database refuses (SQLSTATE class 22, data exception) is the caller's input: an input error, so the
    // agent fixes it instead of retrying. Anything else is ours.
    if (isInputError(e)) return errorResult("invalid_request", `Invalid arguments for ${name}: ${INPUT_ERROR_TEXT}`);
    return errorResult("unavailable", "Kismet is temporarily unavailable. Try again shortly.");
  }
  const { status, body } = out;
  return toolResult(typeof body.text === "string" ? body.text : String(body.message ?? ""), body, status >= 400);
}

/** initialize instructions for a resident session (the public text otherwise). */
export const RESIDENT_INSTRUCTIONS =
  "This session is Agent Village acting for one resident (X-Village-Subject). Besides the public tools, the kismet_* tools act for " +
  "that resident only: kismet_signup (only after they said yes to signing up with these answers), kismet_summary, kismet_go, " +
  "kismet_decide (their own meet/pass, final), kismet_notes and kismet_delete (only when they ask). Relay each result's text. " +
  "Matching is secret (double opt-in): never hint at anyone's answer; status, openness, gender and interestedIn are private.";
