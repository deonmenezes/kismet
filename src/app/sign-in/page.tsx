import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, currentUser } from "@/lib/auth";
import { neonAuth, sessionIdentity } from "@/lib/identity";
import { googleErrorMessage, safeNext } from "@/lib/sign-in-help";
import { CHAT_VIEWPORT } from "@/lib/theme";
import Link from "next/link";
import { SignInPage } from "@/components/sign-in-page";

export const metadata: Metadata = { title: "Sign in", alternates: { canonical: "/sign-in" } };
export const viewport: Viewport = CHAT_VIEWPORT;
export const dynamic = "force-dynamic";

// Sign-in as a page (not a popup: see components/sign-in-page.tsx). `next`: where to go once in (lib/sign-in-help.ts
// safeNext; the chat by default). Signed in with Google / email: straight there, or to the chat while that sign-in has
// no account yet (consent, Connect: the pages behind `next` would send it back here, a loop). A private-link visitor
// stays, to connect Google or email to that account.
export default async function SignInRoute({ searchParams }: PageProps<"/sign-in">) {
  const { error, expired, next, back } = await searchParams;
  const to = safeNext(next);
  if (await sessionIdentity()) redirect(to !== "/chat" && (await currentUser()) ? to : "/chat");
  const viaLink = (await cookies()).has(COOKIE);
  const notice = !neonAuth ? null
    : expired ? "That private link doesn't work any more. Sign in with Google or your email instead."
    : error ? googleErrorMessage(error)
    : viaLink ? <>You&apos;re signed in with a private link. Sign in with Google or email to connect it, so either works next time. Or <Link href="/chat" className="font-bold underline">go back to your chat</Link>.</>
    : null;
  return <SignInPage next={to} notice={notice} enabled={Boolean(neonAuth)} back={back === "1"} />;
}
