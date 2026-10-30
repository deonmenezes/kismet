import type { Viewport } from "next";

// The canvas colour (globals.css --bg): blush in light mode, deep indigo-ink in dark. html, body and the chat shell
// are all painted in it, and the browser's toolbars are tinted with it, so no band of another colour shows under the
// page, behind the toolbars or in the overscroll. Keep in step with --bg in globals.css.
export const CANVAS = { light: "#fbe5f5", dark: "#14101c" } as const;
// viewport-fit=cover: the chat pages run under the notch and home indicator, so env(safe-area-inset-*) is real (the
// shell and the sign-in sheet pad by it, globals.css .k-shell / .k-sheet-body).
export const CHAT_VIEWPORT: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: CANVAS.light },
    { media: "(prefers-color-scheme: dark)", color: CANVAS.dark },
  ],
  colorScheme: "light dark",
  viewportFit: "cover",
};
