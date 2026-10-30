import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Quiz } from "@/components/quiz";
import { reachedByPhone, telegramOptionalFor } from "@/lib/validate";

export const metadata: Metadata = { title: "Edit profile" };

export default async function Edit() {
  const me = await currentUser();
  if (!me) redirect("/sign-in?next=/edit");
  return (
    <Quiz
      mode="edit"
      // Kismet-by-text accounts reached on WhatsApp (or with no Telegram yet) may save without one, as PATCH /api/me allows.
      telegram={{ optional: telegramOptionalFor(me), byPhone: reachedByPhone(me) }}
      initial={{
        name: me.name, relStatus: me.relStatus, openness: me.openness, lookingFor: me.lookingFor, gender: me.gender,
        interestedIn: me.interestedIn, interests: me.interests, bio: me.bio, telegram: me.telegram, agentProfile: me.agentProfile,
        agentName: me.agentName, agentPersonality: me.agentPersonality, publicQuotes: me.publicQuotes, xHandle: me.xHandle, useXPhoto: me.useXPhoto,
        availability: me.availability, area: me.area,
      }}
    />
  );
}
