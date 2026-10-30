import { json } from "@/lib/auth";
import { isVillageOp, parseSubject, parseVillageRequest, partnerAuth, SUBJECT_HEADER, withSubject } from "@/lib/village";
import { runVillageOp } from "@/lib/village-ops";
import { INPUT_ERROR_TEXT, isInputError } from "@/lib/mcp-partner";

// Agent Village partner API (server to server). Auth: Authorization: Bearer <VILLAGE_PARTNER_KEY>.
// The app server supplies the paired resident's stable opaque id, as the X-Village-Subject header or as
// residentId in the body (both hash to the same account); it maps to one user.
// Contract: mini-apps/agent-dates/README.md in the Agent Village bundle. The same ops are MCP tools on /mcp.
export const maxDuration = 60;

const fail = (status: number, error: string, message: string) => json({ ok: false, error, message }, status);

export async function POST(req: Request, ctx: RouteContext<"/api/village/[op]">) {
  const auth = partnerAuth(req.headers.get("authorization"), process.env.VILLAGE_PARTNER_KEY);
  if (auth === "disabled") return fail(503, "partner_api_disabled", "The partner API is not configured.");
  if (auth !== "ok") return fail(401, "unauthorized", "Send Authorization: Bearer <partner key>.");
  const { op } = await ctx.params;
  if (!isVillageOp(op)) return fail(404, "unknown_operation", "Operations: signup, summary, go, decide, delete, verify-link, notes.");
  const subject = parseSubject(req.headers.get(SUBJECT_HEADER));
  if (subject && "error" in subject) return fail(400, "invalid_request", subject.error);

  const raw = await req.text();
  if (raw.length > 12_000) return fail(413, "too_large", "Request body over 12000 characters.");
  let body: unknown;
  try {
    // With the subject header, ops that take nothing else may send an empty body.
    body = subject && !raw.trim() ? {} : JSON.parse(raw);
  } catch {
    return fail(400, "invalid_json", "Body must be JSON.");
  }
  if (subject) {
    const merged = withSubject(body, subject.subject);
    if (merged === "mismatch") return fail(400, "subject_mismatch", "residentId in the body differs from X-Village-Subject. Send one, or the same id in both.");
    body = merged.body;
  }
  const r = parseVillageRequest(op, body);
  if ("error" in r) return fail(400, "invalid_request", r.error);

  try {
    const { status, body: out } = await runVillageOp(r);
    return json(out, status);
  } catch (e) {
    // The same answer as the MCP tools (lib/mcp-partner.ts): a value the database refuses is a 400, never a 500.
    if (isInputError(e)) return fail(400, "invalid_request", INPUT_ERROR_TEXT);
    throw e;
  }
}
