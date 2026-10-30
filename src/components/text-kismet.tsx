import { textLinks } from "@/lib/text/links";

// "Text Kismet on WhatsApp": sign up and get recommendations by text, no app. Hidden when
// KISMET_WHATSAPP_NUMBER is unset or KISMET_WHATSAPP_PUBLIC is not 1 (lib/text/links.ts). (iMessage stays the native app extension, so there is no iMessage button.)
export function TextKismet({ className, label = "Text Kismet on WhatsApp" }: { className: string; label?: string }) {
  const { whatsappUrl } = textLinks();
  if (!whatsappUrl) return null;
  return (
    <a href={whatsappUrl} className={className} rel="noopener">
      {label}
    </a>
  );
}
