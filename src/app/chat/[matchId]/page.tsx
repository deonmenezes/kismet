import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { meView } from "@/lib/views";
import { ChatRoom } from "@/components/chat-room";
import { sideView, viewerFor } from "@/lib/text/web-chat";

export const metadata: Metadata = { title: "Chat" };

export default async function Chat({ params }: PageProps<"/chat/[matchId]">) {
  const me = await currentUser();
  const { matchId } = await params;
  if (!me) redirect(`/sign-in?next=${encodeURIComponent(`/chat/${encodeURIComponent(matchId)}`)}`);
  const m = (await meView(me)).matches.find((x) => x.dateId === matchId);
  // An ended or unknown chat looks the same from here: the room itself shows "This chat has ended."
  if (!m && !/^[0-9a-f-]{36}$/i.test(matchId)) notFound();
  const v = await viewerFor();
  const side = v ? await sideView(v).catch(() => null) : null;
  return <ChatRoom matchId={matchId} name={m?.name ?? "Chat"} photo={m?.photos[0] ?? null} me={me.name} side={side} />;
}
