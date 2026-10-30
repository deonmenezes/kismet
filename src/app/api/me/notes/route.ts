import { currentUser, json, rateLimit, requestClient, tooMany, unauthorized } from "@/lib/auth";
import { addAgentNotes, removeAgentNotes } from "@/lib/actions";
import { listNotes } from "@/lib/records";
import { parseNotes } from "@/lib/client";
import { notesText } from "@/lib/chat";

// "What your agent knows about me": short facts the person's agent learned about them. Private to them;
// dates only see the persona card written from them. Contact details are stripped; the newest 50 are kept.

export async function GET(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const notes = await listNotes(me.id);
  return json({ notes, text: notesText(notes) });
}

// POST {"notes": ["<fact>", ...]} or {"text": "<fact>"}: 1-280 characters each, up to 10 per call.
export async function POST(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!(await rateLimit(`notes:${me.id}`, 60, 3600))) return tooMany();
  const body = await req.json().catch(() => null);
  const notes = parseNotes(body);
  if (!Array.isArray(notes)) return json({ error: notes.error }, 400);
  const added = await addAgentNotes(me.id, notes, requestClient(req));
  const all = await listNotes(me.id);
  return json({ ok: true, added, notes: all, text: notesText(all) }, 201);
}

// DELETE {"noteId": "<id>"} (or ?id=) erases one note; {"all": true} (or ?all=1) erases every note.
export async function DELETE(req: Request) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const q = new URL(req.url).searchParams;
  const body = (await req.json().catch(() => null)) as { noteId?: unknown; all?: unknown } | null;
  const all = body?.all === true || q.get("all") === "1";
  const id = typeof body?.noteId === "string" ? body.noteId : q.get("id");
  if (!all && (!id || !/^[0-9a-f-]{36}$/i.test(id))) return json({ error: 'Send {"noteId": "<id>"} or {"all": true}.' }, 400);
  const deleted = await removeAgentNotes(me.id, all ? "all" : { id: id!.toLowerCase() }, requestClient(req));
  if (!all && !deleted) return json({ error: "No note of yours with that id." }, 404);
  const notes = await listNotes(me.id);
  return json({ ok: true, deleted, notes, text: notesText(notes) });
}
