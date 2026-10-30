import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { meView } from "@/lib/views";
import { Home } from "@/components/home";
import { textLinks } from "@/lib/text/links";
import { addPhotoHint } from "@/lib/photos";

export const metadata: Metadata = { title: "My intros" };

export default async function HomePage() {
  const me = await currentUser();
  if (!me) redirect("/sign-in?next=/home");
  // Asked to add a photo only with none, and never after removing one or saying no to the Google picture. A failed check asks nothing.
  const [view, photoAsk] = await Promise.all([meView(me), addPhotoHint(me.id).catch(() => false)]);
  return <Home initial={view} whatsapp={Boolean(textLinks().whatsappUrl)} photoAsk={photoAsk} />;
}
