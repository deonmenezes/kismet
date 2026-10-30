import { boardQuotes, stats } from "@/lib/db";
import { json, publicAllowed, tooMany } from "@/lib/auth";

export async function GET(req: Request) {
  if (!(await publicAllowed(req, "board"))) return tooMany();
  const limit = Number(new URL(req.url).searchParams.get("limit")) || 10;
  const [s, quotes] = await Promise.all([stats(), boardQuotes(limit)]);
  return json({ stats: s, quotes });
}
