import type { Inbound, SendResult, TextAdapter, YesNo } from "./types.ts";

// In-memory "test" provider: records what would be sent, and builds inbound messages. For unit and
// end-to-end tests of the conversation (no network, no signatures).

export type Sent = { to: string; kind: "text" | "buttons" | "template" | "match-template"; text: string; dateId?: string };

export function memoryAdapter(opts: { windowMs?: number } = {}) {
  const sent: Sent[] = [];
  let n = 0;
  const ok = (): SendResult => ({ ok: true, id: `mem-${++n}` });
  const adapter: TextAdapter & { sent: Sent[]; inbound(from: string, text: string, buttonId?: string): Inbound } = {
    channel: "whatsapp",
    sent,
    configured: () => true,
    verify: () => true,
    parse: (body) => (Array.isArray(body) ? (body as Inbound[]) : []),
    sendText: async (to, text) => {
      sent.push({ to, kind: "text", text });
      return ok();
    },
    sendYesNo: async (to, p: YesNo, windowOpen) => {
      sent.push({ to, kind: windowOpen ? "buttons" : "template", text: windowOpen ? p.text : `${p.name}: ${p.why}`, dateId: p.dateId });
      return ok();
    },
    sendMatchTemplate: async (to) => {
      sent.push({ to, kind: "match-template", text: "You have a new Kismet match. Reply MATCHES to see it." });
      return ok();
    },
    windowOpen: (last, now) => Boolean(last && now.getTime() - last.getTime() < (opts.windowMs ?? 24 * 3600 * 1000)),
    inbound: (from, text, buttonId) => ({ channel: "whatsapp", from, text, buttonId: buttonId ?? null, providerId: `in-${++n}`, isGroup: false }),
  };
  return adapter;
}

/**
 * In-memory TextStore with the production semantics that matter: save() does not touch pendingDateId or
 * notices (only the atomic operations do), lock() serializes one number, counters persist across threads
 * (keys are per number). minuteCap: enforce the per-minute cap (counters here never expire).
 */
export function memoryStore({ minuteCap = false } = {}) {
  type T = import("./agent.ts").Thread;
  const threads = new Map<string, T>();
  const seen = new Set<string>();
  const msgs = new Map<string, { direction: "in" | "out"; text: string }[]>();
  const counters = new Map<string, number>();
  const userCodes = new Map<string, string>(); // app/web code -> user id
  const threadCodes = new Map<string, string>(); // phone-handed code -> thread id
  const requests = new Map<string, { id: string; userId: string; userName: string; threadId: string; needs: "web" | "phone" }>();
  const locks = new Map<string, Promise<void>>();
  const users = new Map<string, string>(); // user id -> name, for link requests
  const pendingUsers = new Map<string, string>(); // thread id -> the account id its sign-up is fixed to
  let id = 0;
  const key = (t: { channel: string; phone: string }) => `${t.channel}:${t.phone}`;
  const byId = (tid: string) => [...threads.values()].find((t) => t.id === tid);
  const store: import("./agent.ts").TextStore & Record<string, unknown> = {
    threads, msgs, counters, userCodes, threadCodes, requests, users, pendingUsers,
    thread: async (ch, phone) => (threads.get(`${ch}:${phone}`) ? structuredClone(threads.get(`${ch}:${phone}`)!) : null),
    createThread: async (ch, phone) => {
      const t: T = { id: `t${++id}`, channel: ch, phone, userId: null, state: "new", draft: {}, verifiedAt: null, optedOutAt: null, pausedAt: null,
        blockedAt: null, lastInboundAt: null, pendingDateId: null, toldFinal: false, notices: [] };
      if (!threads.has(key(t))) threads.set(key(t), t);
      return structuredClone(threads.get(key(t))!);
    },
    save: async (t) => {
      const cur = threads.get(key(t));
      if (!cur || cur.id !== t.id) return;
      threads.set(key(t), { ...structuredClone(t), pendingDateId: cur.pendingDateId, notices: cur.notices });
    },
    deleteThread: async (tid) => {
      for (const [k, t] of threads) if (t.id === tid) threads.delete(k);
      msgs.delete(tid);
      pendingUsers.delete(tid);
      for (const [rid, r] of requests) if (r.threadId === tid) requests.delete(rid);
    },
    lock: async (t) => {
      const k = key(t);
      const prev = locks.get(k) ?? Promise.resolve();
      let release!: () => void;
      const next = new Promise<void>((r) => (release = r));
      locks.set(k, prev.then(() => next));
      await prev;
      return async () => release();
    },
    claimState: async (t, from, to) => {
      const cur = threads.get(key(t));
      if (!cur || cur.state !== from) return false;
      cur.state = to;
      return true;
    },
    claimSignup: async (t, userId) => {
      const cur = threads.get(key(t));
      if (!cur || cur.state !== "confirm") return null;
      cur.state = "signing_up";
      if (!pendingUsers.has(cur.id)) pendingUsers.set(cur.id, userId);
      return pendingUsers.get(cur.id)!;
    },
    claimInbound: async (t, pid, text) => {
      if (seen.has(pid)) return false;
      seen.add(pid);
      msgs.set(t.id, [...(msgs.get(t.id) ?? []), { direction: "in", text }]);
      return true;
    },
    recordOutbound: async (t, text) => {
      if (byId(t.id)) msgs.set(t.id, [...(msgs.get(t.id) ?? []), { direction: "out", text }]);
    },
    history: async (t, n) => (msgs.get(t.id) ?? []).slice(-n - 1, -1),
    hit: async (k, limit) => {
      if (!minuteCap && k.startsWith("text-min:")) return true;
      const v = (counters.get(k) ?? 0) + 1;
      counters.set(k, v);
      return v <= limit;
    },
    threadsOfUser: async (uid) => [...threads.values()].filter((t) => t.userId === uid).map((t) => structuredClone(t)),
    claimPending: async (t, dateId) => {
      const cur = threads.get(key(t));
      if (!cur || cur.pendingDateId) return false;
      cur.pendingDateId = dateId;
      return true;
    },
    releasePending: async (t, dateId) => {
      const cur = threads.get(key(t));
      if (cur?.pendingDateId === dateId) cur.pendingDateId = null;
    },
    queueNotice: async (t, n) => {
      const cur = threads.get(key(t));
      if (cur && !cur.notices.some((x) => x.dateId === n.dateId)) cur.notices.push(n);
    },
    takeNotices: async (t) => {
      const cur = threads.get(key(t));
      if (!cur) return [];
      const list = cur.notices;
      cur.notices = [];
      return list;
    },
    requestLinkFromUserCode: async (t, code) => {
      const userId = userCodes.get(code);
      if (!userId) return null;
      userCodes.delete(code);
      const r = { id: `r${++id}`, userId, userName: users.get(userId) ?? "", threadId: t.id, needs: "web" as const };
      requests.set(r.id, r);
      return { id: r.id, userId, userName: r.userName };
    },
    createThreadCode: async (t) => {
      const code = `CODE${String(++id).padStart(4, "0")}`;
      threadCodes.set(code, t.id);
      return code;
    },
    phoneLinkRequest: async (t) => {
      const r = [...requests.values()].find((x) => x.threadId === t.id && x.needs === "phone");
      return r ? { id: r.id, userId: r.userId, userName: r.userName } : null;
    },
    completeLink: async (t, rid) => {
      const r = requests.get(rid);
      if (!r || r.threadId !== t.id) return false;
      requests.delete(rid);
      return true;
    },
  };
  return store;
}
