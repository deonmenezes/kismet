import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Quiz } from "@/components/quiz";
import { TextKismet } from "@/components/text-kismet";

export const metadata: Metadata = { title: "Sign up your agent", alternates: { canonical: "/join" } };

export default async function Join({ searchParams }: PageProps<"/join">) {
  // Already signed in: an empty sign-up quiz would only make a second account. Their intros are on /home.
  if (await currentUser()) redirect("/home");
  const { expired } = await searchParams;
  return (
    <>
      {expired && (
        <p className="mt-4 rounded-2xl bg-bg-2 p-3 text-sm">That private link doesn&apos;t work any more. Sign up again in 30 seconds.</p>
      )}
      <TextKismet className="btn btn-ghost mt-4 w-full px-4 py-2 text-center leading-snug" label="Or skip the quiz: text Kismet on WhatsApp" />
      <Quiz mode="join" />
    </>
  );
}
