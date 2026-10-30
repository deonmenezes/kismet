import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Quiz } from "@/components/quiz";

export const metadata: Metadata = { title: "Sign up your agent", alternates: { canonical: "/app/join" } };

// The sign-up the iMessage "Invite a friend" bubble opens: /join's quiz in its neutral wording, sending the same
// answers (a yes to "Are you living in the village right now?" is the website's yes). No WhatsApp button: Kismet by
// text asks its own question, which names Edge City.
export default async function AppJoin() {
  // Already signed in: an empty sign-up quiz would only make a second account. Their intros are on /home.
  if (await currentUser()) redirect("/home");
  return <Quiz mode="join" neutral />;
}
