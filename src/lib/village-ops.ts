import { after } from "next/server";
import { sql, toUser } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { parseProfile } from "@/lib/validate";
import { addAgentNotes, autoStartDates, decideDate, deleteUser, insertUser, removeAgentNotes, setEdgeCity, startDates, updateProfile } from "@/lib/actions";
import { meView, summaryJson } from "@/lib/views";
import { notesText, notSignedUpText, profileUpdatedText, signupText, summaryText, verifyOfferText } from "@/lib/chat";
import { residentKey, type VillageRequest } from "@/lib/village";
import { consentError } from "@/lib/safety";
import { worldConfig } from "@/lib/world";
import { verifyLink } from "@/lib/world-store";
import { parseNotes, VILLAGE } from "@/lib/client";
import { listNotes, markShown, touchSeen } from "@/lib/records";
import { DEMO_RESERVED_TEXT, reservedForDemo } from "@/lib/demo";

// One Agent Village operation for one resident, after auth and request checks. Shared by the partner
// HTTP API (/api/village/<op>) and the authenticated MCP tools (/mcp), so both answer the same way:
// the same status, JSON body, rate limits and texts.

export type VillageResult = { status: number; body: Record<string, unknown> };

const done = (body: Record<string, unknown>, status = 200): VillageResult => ({ status, body });
const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  done({ ok: false, error, message, ...extra }, status);
const limited = () => fail(429, "rate_limited", "Too many requests for this resident. Try again later.");

export async function runVillageOp(r: VillageRequest): Promise<VillageResult> {
  const resident = residentKey(r.residentId);
  const [row] = await sql`select * from users where village_resident = ${resident}`;
  let me = row ? toUser(row) : null;
  // Agent Village residents are at Edge City India by definition (lib/edge-city.ts): always in the pool.
  if (me && me.edgeCity !== true && r.op !== "delete") me = (await setEdgeCity(me.id, true, undefined, VILLAGE)) ?? me;
  if (me) after(() => touchSeen(me.id, VILLAGE));

  if (r.op === "signup") {
    // Same validation as /api/signup. The pairing's Telegram username fills in when the quiz did not ask for one.
    const consent = consentError(r.answers);
    if (consent) return fail(400, "invalid_answers", consent);
    const parsed = parseProfile({ ...r.answers, telegram: r.answers.telegram ?? r.telegram, edgeCity: true });
    if ("error" in parsed) return fail(400, "invalid_answers", String(parsed.error));
    // App Review's demo name and handle (lib/demo.ts): never on a partner account, new or updated.
    if (reservedForDemo(parsed.profile)) return fail(400, "invalid_answers", DEMO_RESERVED_TEXT, { text: DEMO_RESERVED_TEXT });
    // Optional facts the resident's agent already knows about them (agent_notes).
    const notes = r.notes === undefined ? [] : parseNotes({ notes: r.notes });
    if (!Array.isArray(notes)) return fail(400, "invalid_request", `notes: ${notes.error}`);
    if (!(await rateLimit(`village-signup:${resident}`, 20, 3600))) return limited();
    // Idempotent per resident: a repeat replaces that resident's answers, never a second account.
    if (me) {
      await updateProfile(me.id, parsed.profile, VILLAGE);
      if (notes.length) await addAgentNotes(me.id, notes, VILLAGE);
      const text = profileUpdatedText(parsed.profile.name);
      return done({ ok: true, created: false, text, message: text });
    }
    if (!(await rateLimit("village-signup:all", 300, 3600))) return fail(429, "rate_limited", "Lots of sign-ups right now. Try again in a few minutes.");
    const created = await insertUser(parsed.profile, VILLAGE, resident, notes);
    if (!created) {
      // A concurrent sign-up for the same resident won the insert: apply these answers to that account.
      const [winner] = await sql`select id from users where village_resident = ${resident}`;
      await updateProfile(winner.id as string, parsed.profile, VILLAGE);
      const text = profileUpdatedText(parsed.profile.name);
      return done({ ok: true, created: false, text, message: text });
    }
    // Residents never start dates in chat: their agent goes on its first dates right away.
    const [fresh] = await sql`select * from users where id = ${created.id}`;
    if (fresh) await autoStartDates(toUser(fresh), `village:${resident.slice(0, 32)}`, VILLAGE);
    const text = signupText(parsed.profile.name);
    return done({ ok: true, created: true, text, message: text }, 201);
  }

  if (r.op === "delete") {
    if (!me) return done({ ok: true, deleted: false, text: "There is no Kismet account to delete." });
    await deleteUser(me.id, VILLAGE);
    return done({ ok: true, deleted: true, text: "Done: your Kismet account, agent chats and matches are deleted." });
  }

  if (!me) return fail(404, "not_signed_up", "This resident has no Kismet account.", { text: notSignedUpText });

  if (r.op === "summary") {
    if (!(await rateLimit(`village-summary:${resident}`, 120, 3600))) return limited();
    await autoStartDates(me, `village:${resident.slice(0, 32)}`, VILLAGE);
    const view = await meView(me);
    const summary = summaryJson(view);
    after(() => markShown(me.id, summary.recommendations.map((x) => x.dateId), VILLAGE));
    return done({ ok: true, text: summaryText(view), summary });
  }

  if (r.op === "notes") {
    if (!(await rateLimit(`village-notes:${resident}`, 120, 3600))) return limited();
    if (r.add !== undefined) {
      const notes = parseNotes({ notes: r.add });
      if (!Array.isArray(notes)) return fail(400, "invalid_request", `add: ${notes.error}`);
      await addAgentNotes(me.id, notes, VILLAGE);
    } else if (r.deleteId || r.deleteAll) {
      const n = await removeAgentNotes(me.id, r.deleteAll ? "all" : { id: r.deleteId! }, VILLAGE);
      if (!n && r.deleteId) return fail(404, "note_not_found", "No note with that id for this resident.");
    }
    const notes = await listNotes(me.id);
    return done({ ok: true, notes, text: notesText(notes) });
  }

  if (r.op === "verify-link") {
    // Optional World ID badge: a one-time link (expires within 15 minutes) for the resident to open on their phone.
    const world = worldConfig();
    if (!world) return fail(503, "verification_unavailable", "World ID verification is not available right now.", { text: "World ID verification isn't available right now." });
    if (!(await rateLimit(`village-verify:${resident}`, 60, 3600))) return limited();
    if (me.worldVerifiedAt) return done({ ok: true, verified: true, link: null, expiresAt: null, text: "You're already World ID verified ✓" });
    const link = await verifyLink(world, me);
    if (!link) return limited();
    return done({ ok: true, verified: false, link: link.url, expiresAt: link.expiresAt, text: verifyOfferText(link.url) });
  }

  if (r.op === "go") {
    if (!(await rateLimit(`dates:${me.id}`, 10, 3600))) return limited();
    // The per-network daily cap is keyed per resident here (every call comes from one app server).
    const { started, dateIds, text } = await startDates(me, `village:${resident.slice(0, 32)}`, VILLAGE, r.targetId);
    return done({ ok: true, started, dateIds, text, message: text }, started ? 202 : 200);
  }

  if (!(await rateLimit(`decide:${me.id}`, 120, 3600))) return limited();
  const result = await decideDate(me, r.dateId, r.decision, VILLAGE);
  // Not this resident's date, unknown, or still running: one answer for all three (no probing other dates).
  if (!result) return fail(404, "date_not_found", "No finished agent chat with that dateId for this resident.");
  return done(result);
}
