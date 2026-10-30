import { sql, type User } from "./db";
import { SITE } from "./copy";
import { CODE_VARIANTS, codeHash, mintCode, type VerifyStore, type WorldConfig } from "./world";

// Database side of World ID verification (see world.ts for the checks).

export const worldStore: VerifyStore = {
  async userState(userId) {
    const [r] = await sql`select world_verified_at from users where id = ${userId}`;
    return { exists: Boolean(r), verified: Boolean(r?.world_verified_at) };
  },
  async consumeCode(hash) {
    const rows = await sql`insert into world_codes_used (code_hash) values (${hash}) on conflict do nothing returning code_hash`;
    return rows.length > 0;
  },
  async saveNullifier(userId, nullifier, action, level) {
    // One statement: the nullifier row and the badge go in together, or neither does.
    const rows = await sql`
      with ins as (
        insert into world_ids (nullifier, action, user_id, credential)
        values (${nullifier}::numeric, ${action}, ${userId}, ${level})
        on conflict do nothing
        returning user_id)
      update users set world_verified_at = now(), world_level = ${level}
      where id in (select user_id from ins)
      returning id`;
    if (rows.length) return "ok";
    const [owner] = await sql`select user_id from world_ids where nullifier = ${nullifier}::numeric and action = ${action}`;
    // Taken by someone else = a second account for the same World ID. Otherwise this account already has one.
    return owner && owner.user_id !== userId ? "duplicate" : "already_verified";
  },
};

/** A fresh one-time /verify link for an unverified user, or null (verified, or every link this window is used). */
export async function verifyLink(c: WorldConfig, me: Pick<User, "id" | "worldVerifiedAt">) {
  if (me.worldVerifiedAt) return null;
  const now = Math.floor(Date.now() / 1000);
  const codes = Array.from({ length: CODE_VARIANTS }, (_, v) => mintCode(c, me.id, v, now));
  const used = new Set(
    (await sql`select code_hash from world_codes_used where code_hash = any(${codes.map((x) => codeHash(x.code))})`).map((r) => r.code_hash as string),
  );
  const free = codes.find((x) => !used.has(codeHash(x.code)));
  return free ? { url: `${SITE}/verify/${free.code}`, expiresAt: new Date(free.expiresAt * 1000).toISOString() } : null;
}
