import { agentScript } from "@/lib/agent-script";
import { worldConfig } from "@/lib/world";

export function GET(req: Request) {
  return new Response(agentScript(new URL(req.url).origin, { worldId: Boolean(worldConfig()) }), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
