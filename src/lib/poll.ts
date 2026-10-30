// How often an open match chat polls for messages (src/components/chat-room.tsx). No imports (unit-tested directly).

/** Active (a message, a key or a tap in the last 2 minutes): every 4 s. Then 8, 16, and at most 30 s. */
export function pollDelay(idleMs: number) {
  return idleMs < 120_000 ? 4000 : Math.min(30_000, 4000 * 2 ** Math.ceil((idleMs - 120_000) / 60_000));
}
