import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { safeNext } from "@/lib/sign-in-help";

// After Google sign-in (the proxy has set the session by now): on to `next` once the sign-in has an account (a new one
// finishes in the chat first; the pages behind `next` would send it to /sign-in and back), else the chat.
export const dynamic = "force-dynamic";

export default async function SignedIn({ searchParams }: PageProps<"/auth/done">) {
  const to = safeNext((await searchParams).next);
  redirect(to !== "/chat" && (await currentUser()) ? to : "/chat");
}
