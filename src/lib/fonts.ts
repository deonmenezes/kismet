import { Fraunces } from "next/font/google";

// The serif of the sign-in sheet (headline, quote, "or"): italic only. Used by the chat shell
// (src/components/kismet-chat.tsx) and the plain pages' display headings (.k-serif, via src/components/site-chrome.tsx).
// display "optional": if it isn't there within ~100 ms the sheet keeps the fallback serif for that visit, so the
// headline never reflows while it animates in.
// One STATIC weight (400), not the variable font (QA2 S3): Google's variable Fraunces file has its default instance at
// wght 900, and a WebKit that lays text out at the requested weight but draws the default instance (Playwright WebKit;
// reported on iPhone) shows the headings black with no word gaps. A static file has no axes to get wrong, and it is
// smaller. Every heading asks for 400 (globals.css), so nothing is synthesized either.
export const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], style: "italic", weight: "400", display: "optional" });
