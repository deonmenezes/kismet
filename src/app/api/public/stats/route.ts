import { stats } from "@/lib/db";
import { json, publicAllowed, tooMany } from "@/lib/auth";

export async function GET(req: Request) {
  if (!(await publicAllowed(req, "stats"))) return tooMany();
  return json(await stats());
}
