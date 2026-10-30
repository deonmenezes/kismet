// Run: npm test. The un-hold push (src/app/api/text/unheld, vercel.json "0 6 * * 6") and the overnight re-hold on a real
// Postgres (PGlite, in memory) with the clock fixed. Friday 30 Oct: after the 7 pm drop nothing was held from 20:00 India
// time until the Saturday 31 Oct 10:00 drop was added, so what showed up then stays visible all night (lib/drop.ts
// HOLDS_LIFTED), while a date that finishes after Saturday's cutoff is held until holding stops at 11:00 and the
// Saturday cron right after puts it in the web chat, once. Any other time the cron answers "skipped" and sends nothing.
import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-support/pg.mjs";

const pg = await freshDb();
process.env.CRON_SECRET = "test-cron-secret";
const { decideDate, insertUser } = await import("./actions.ts");
const { toUser } = await import("./db.ts");
const { parseProfile } = await import("./validate.ts");
const { syncChat } = await import("./text/web-chat.ts");
const { pendingRecommendations } = await import("./views.ts");
const { holdingNow } = await import("./drop.ts");
const { GET } = await import("../app/api/text/unheld/route.ts");

mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-30T18:00:00Z") }); // Fri 23:30 India time: held for Saturday
after(async () => {
  mock.timers.reset();
  await pg.close(); // PGlite's own interval timer re-arms against the fixed clock, so it would keep the run alive
});
const at = (iso) => mock.timers.setTime(new Date(iso).getTime());

async function person(name) {
  const r = parseProfile({ name, telegram: `${name.toLowerCase()}_tg`, lookingFor: ["friends"], interests: ["AI", "Books"], edgeCity: true });
  return insertUser(r.profile, { channel: "web", client: "" });
}
const user = async (id) => toUser((await pg.query("select * from users where id = $1", [id])).rows[0]);
const call = (auth) => GET(new Request("https://kismet.test/api/text/unheld", { headers: auth ? { authorization: auth } : {} }));
const cron = () => call("Bearer test-cron-secret");
const said = async (id) => (await pg.query(
  "select m.text from conversation_messages m join user_phones t on t.id = m.phone_id where t.user_id = $1 order by m.id", [id])).rows.map((r) => r.text);
const v = JSON.stringify({ score: 8, meet: true, reason: "Good chat.", bestLine: "Chai?", suggestedMeetup: "Chai at Riva" });
const insertDate = async (a, b, finishedAt) => (await pg.query(`insert into dates (pair_key, a_id, b_id, mode, status, verdict_a, verdict_b, finished_at, held)
  values ($1, $2, $3, 'friendly', 'done', $4::jsonb, $4::jsonb, $5, true) returning id`, [[a.id, b.id].sort().join(":"), a.id, b.id, v, finishedAt])).rows[0].id;
const pending = async (id) => (await pendingRecommendations(await user(id))).map((r) => r.dateId);

const ana = await person("Ana");
const bo = await person("Bo");
const cy = await person("Cy");
const di = await person("Di");
// A late joiner's date: finished after Friday's 18:00 cutoff, held then, un-held at 20:00 (and visible since), never
// released or marked shown to either side.
const late = await insertDate(ana, bo, "2026-10-30T13:45:00Z");
// A date that finishes after Saturday's 09:00 cutoff, while held: not in the drop, shown once holding stops at 11:00.
const fresh = await insertDate(cy, di, "2026-10-31T04:00:00Z");
const shown = (id) => `[recommendation date:${id}]`;

test("only with CRON_SECRET", async () => {
  assert.equal((await call()).status, 403);
  assert.equal((await call("Bearer wrong")).status, 403);
});

test("overnight, held again for Saturday's drop: what was visible after Friday's 7 pm drop stays visible to both sides", async () => {
  for (const iso of ["2026-10-30T18:00:00Z", "2026-10-30T22:00:00Z", "2026-10-31T03:45:00Z", "2026-10-31T05:00:00Z"]) {
    at(iso);
    assert.equal(holdingNow(), true, iso);
    assert.deepEqual(await pending(ana.id), [late], iso);
    assert.deepEqual(await pending(bo.id), [late], iso);
  }
  // Bo opens the web chat at night: it is there, as an ordinary recommendation.
  at("2026-10-30T18:30:00Z");
  await syncChat({ me: await user(bo.id), identity: null, connect: null });
  assert.equal((await said(bo.id)).filter((x) => x === shown(late)).length, 1);
  // Ana can still answer it overnight (the answer's own visibility check), and it is no longer pending for her.
  at("2026-10-30T20:00:00Z");
  assert.ok(await decideDate(await user(ana.id), late, "meet", { channel: "web", client: "" }));
  assert.deepEqual(await pending(ana.id), []);
  assert.deepEqual(await pending(bo.id), [late]);
});

test("while Cy's date is held (finished after Saturday's cutoff), Cy's web chat does not show it and the cron does nothing", async () => {
  at("2026-10-31T04:10:00Z");
  assert.deepEqual(await pending(cy.id), []);
  await syncChat({ me: await user(cy.id), identity: null, connect: null });
  assert.ok(!(await said(cy.id)).includes(shown(fresh)));
  // Friday night, the drop's hour and the backup drop cron's hour before 11:00: still holding.
  for (const iso of ["2026-10-24T06:30:00Z", "2026-10-30T15:30:00Z", "2026-10-31T04:30:00Z", "2026-10-31T05:20:00Z"]) {
    at(iso);
    assert.deepEqual(await (await cron()).json(), { ok: true, skipped: "nothing was un-held just now" }, iso);
  }
  assert.ok(!(await said(cy.id)).includes(shown(fresh)));
});

test("Sat 31 Oct 11:40 India time: the un-held date is pushed into Cy's chat, once", async () => {
  at("2026-10-31T06:10:00Z");
  assert.deepEqual(await pending(cy.id), [fresh]);
  const r = await (await cron()).json();
  assert.equal(r.ok, true);
  assert.equal(r.skipped, undefined);
  assert.equal(r.pushedThreads, 2); // Bo and Cy, the two with a chat thread
  assert.equal((await said(cy.id)).filter((x) => x === shown(fresh)).length, 1);
  assert.equal((await said(bo.id)).filter((x) => x === shown(late)).length, 1, "Bo's open recommendation is not sent again");
  at("2026-10-31T06:50:00Z"); // a retry or a double fire in the same hour: nothing new
  await cron();
  assert.equal((await said(cy.id)).filter((x) => x === shown(fresh)).length, 1);
  at("2026-11-07T06:10:00Z"); // the next Saturday: skipped
  assert.equal((await (await cron()).json()).skipped, "nothing was un-held just now");
});
