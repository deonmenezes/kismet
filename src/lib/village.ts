import { createHash, timingSafeEqual } from "node:crypto";
import { stripControlsDeep } from "./controls.ts";

// Agent Village partner API: request checks with no database or framework imports (unit-tested
// directly). The Agent Village APP SERVER calls /api/village/<op> after resolving the paired
// resident; a resident's agent never holds this key.

export const VILLAGE_OPS = ["signup", "summary", "go", "decide", "delete", "verify-link", "notes"] as const;
export type VillageOp = (typeof VILLAGE_OPS)[number];
export const isVillageOp = (op: string): op is VillageOp => (VILLAGE_OPS as readonly string[]).includes(op);

const MIN_KEY_LENGTH = 32;
const sha = (s: string) => createHash("sha256").update(s).digest();

/** "disabled" when no usable key is configured, "denied" for a missing or wrong bearer. Constant-time compare. */
export function partnerAuth(header: string | null, key: string | undefined): "ok" | "disabled" | "denied" {
  if (!key || key.length < MIN_KEY_LENGTH) return "disabled";
  const m = /^Bearer ([^\s]{1,512})$/i.exec(header ?? "");
  if (!m) return "denied";
  // Hash both sides so the comparison is fixed-length and leaks nothing about the key's length.
  return timingSafeEqual(sha(m[1]), sha(key)) ? "ok" : "denied";
}

export const RESIDENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only this hash is stored (users.village_resident): the app server's id never sits in the database. */
export const residentKey = (residentId: string) => createHash("sha256").update(`agent-dates:village:${residentId}`).digest("hex");

export type VillageRequest =
  | { op: "signup"; residentId: string; telegram?: string; answers: Record<string, unknown>; notes?: unknown }
  | { op: "notes"; residentId: string; add?: unknown; deleteId?: string; deleteAll?: boolean }
  | { op: "summary"; residentId: string }
  | { op: "delete"; residentId: string }
  | { op: "verify-link"; residentId: string }
  | { op: "go"; residentId: string; targetId?: string }
  | { op: "decide"; residentId: string; dateId: string; decision: "meet" | "pass" };

const FIELDS: Record<VillageOp, { required: string[]; optional: string[] }> = {
  signup: { required: ["residentId", "answers"], optional: ["telegram", "notes"] },
  // What the resident's agent knows about them: list (no fields), add facts, delete one or all.
  notes: { required: ["residentId"], optional: ["add", "deleteId", "deleteAll"] },
  summary: { required: ["residentId"], optional: [] },
  go: { required: ["residentId"], optional: ["targetId"] },
  decide: { required: ["residentId", "dateId", "decision"], optional: [] },
  delete: { required: ["residentId"], optional: [] },
  "verify-link": { required: ["residentId"], optional: [] },
};

/** Agent Village's per-resident subject header: the same opaque id as residentId, hashed the same way. */
export const SUBJECT_HEADER = "x-village-subject";
const RESIDENT_ID_RULE = "1-128 characters: letters, digits and . _ : @ - (starting with a letter or digit)";

/** The X-Village-Subject value: null when absent, else the id or an error (same rule as residentId). */
export function parseSubject(header: string | null): { subject: string } | { error: string } | null {
  if (header === null) return null;
  return RESIDENT_ID.test(header) ? { subject: header } : { error: `X-Village-Subject must be ${RESIDENT_ID_RULE}.` };
}

/**
 * Puts the subject header into the body as residentId, so parseVillageRequest checks one shape either way.
 * A body residentId that differs from the header is refused (never silently overridden).
 */
export function withSubject(body: unknown, subject: string): { body: unknown } | "mismatch" {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { body };
  const b = body as Record<string, unknown>;
  if (b.residentId !== undefined && b.residentId !== null && b.residentId !== subject) return "mismatch";
  return { body: { ...b, residentId: subject } };
}

/** Exact top-level shape per operation: unknown keys are refused, never ignored. */
export function parseVillageRequest(op: VillageOp, body: unknown): VillageRequest | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be a JSON object." };
  // Control characters out of every field (lib/controls.ts): the HTTP API and the MCP tools both come through here.
  body = stripControlsDeep(body);
  const b = body as Record<string, unknown>;
  const { required, optional } = FIELDS[op];
  const extra = Object.keys(b).filter((k) => !required.includes(k) && !optional.includes(k));
  if (extra.length) return { error: `Unknown field: ${extra[0]}.` };
  const missing = required.find((k) => b[k] === undefined || b[k] === null);
  if (missing) return { error: `Missing field: ${missing}.` };
  if (typeof b.residentId !== "string" || !RESIDENT_ID.test(b.residentId)) {
    return { error: `residentId must be ${RESIDENT_ID_RULE}.` };
  }
  const residentId = b.residentId;
  switch (op) {
    case "signup": {
      if (typeof b.answers !== "object" || Array.isArray(b.answers)) return { error: "answers must be an object." };
      if (b.telegram !== undefined && b.telegram !== null && typeof b.telegram !== "string") return { error: "telegram must be a string." };
      return {
        op, residentId, answers: b.answers as Record<string, unknown>,
        ...(typeof b.telegram === "string" ? { telegram: b.telegram } : {}),
        ...(b.notes !== undefined && b.notes !== null ? { notes: b.notes } : {}),
      };
    }
    case "notes": {
      if (b.deleteId !== undefined && b.deleteId !== null && (typeof b.deleteId !== "string" || !UUID.test(b.deleteId))) return { error: "deleteId must be a note id." };
      if (b.deleteAll !== undefined && b.deleteAll !== null && typeof b.deleteAll !== "boolean") return { error: "deleteAll must be true or false." };
      const ops = [b.add, b.deleteId, b.deleteAll === true ? true : undefined].filter((v) => v !== undefined && v !== null).length;
      if (ops > 1) return { error: "Send one of add, deleteId or deleteAll (or none to list)." };
      return {
        op, residentId,
        ...(b.add !== undefined && b.add !== null ? { add: b.add } : {}),
        ...(typeof b.deleteId === "string" ? { deleteId: b.deleteId.toLowerCase() } : {}),
        ...(b.deleteAll === true ? { deleteAll: true } : {}),
      };
    }
    case "go": {
      if (b.targetId !== undefined && b.targetId !== null && (typeof b.targetId !== "string" || !UUID.test(b.targetId))) {
        return { error: "targetId must be a targetId from the summary." };
      }
      return { op, residentId, ...(typeof b.targetId === "string" ? { targetId: b.targetId } : {}) };
    }
    case "decide": {
      if (typeof b.dateId !== "string" || !UUID.test(b.dateId)) return { error: "dateId must be a dateId from the summary." };
      if (b.decision !== "meet" && b.decision !== "pass") return { error: 'decision must be "meet" or "pass".' };
      return { op, residentId, dateId: b.dateId, decision: b.decision };
    }
    default:
      return { op, residentId } as VillageRequest;
  }
}
