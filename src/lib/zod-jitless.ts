// Imported for its side effect, before anything that builds zod schemas in the browser (lib/auth-client.ts): zod's
// schemas probe for eval (Function("")) when they are built, to compile faster parsers. The page's
// Content-Security-Policy has no 'unsafe-eval' (lib/csp.ts), so the probe was refused and reported as a CSP violation
// on every page with sign-in. jitless skips the probe (same results, the interpreted parsers).
import { config } from "zod";

config({ jitless: true });
