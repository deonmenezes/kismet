import { agentScriptCore } from "@/lib/agent-script";
import { worldConfig } from "@/lib/world";

// The compact core script (the full guide is /llms-full.txt).
export function GET(req: Request) {
  return new Response(agentScriptCore(new URL(req.url).origin, { worldId: Boolean(worldConfig()) }), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
