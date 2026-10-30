import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { ADMIN_COOKIE, adminCookieOk } from "@/lib/safety";

const cell = (v: unknown) => {
  const s = Array.isArray(v) ? v.join("; ") : v instanceof Date ? v.toISOString() : String(v ?? "");
  // Quote every cell; neutralise spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

// CSV export of the waitlist for /admin.
export async function GET() {
  if (!adminCookieOk((await cookies()).get(ADMIN_COOKIE)?.value, process.env.ADMIN_KEY)) return new Response("Forbidden", { status: 403 });
  const rows = await sql`select w.id, w.email, w.name, w.place, w.handle, w.interests, w.platforms, w.ref_code, w.referred_by, w.created_at,
      (select count(*) from waitlist r where r.referred_by = w.ref_code)::int as referrals
    from waitlist w order by w.id`;
  const cols = ["id", "email", "name", "place", "handle", "interests", "platforms", "ref_code", "referred_by", "referrals", "created_at"];
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="agent-dates-waitlist.csv"', "cache-control": "no-store" },
  });
}
