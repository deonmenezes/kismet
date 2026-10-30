"use client";

import { useState } from "react";

// A person's round avatar: their photo when the view carries one (only ever one they may see, lib/secret.ts
// visiblePhoto), else the first letter of their name on a flat tint. Decorative: the name is always beside it.

export const letter = (s: string) => (Array.from(s.trim())[0] ?? "?").toUpperCase();

/** eager: always on screen at load (a header). A photo that stops loading (removed, blocked) falls back to the letter. */
export function Avatar({ name, photo, className = "size-10 text-base", eager = false }: { name: string; photo?: string | null; className?: string; eager?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  return photo && photo !== broken
    ? <img src={photo} alt="" loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setBroken(photo)} className={`${className} shrink-0 rounded-full bg-[var(--k-bubble)] object-cover`} /> // eslint-disable-line @next/next/no-img-element
    : <span aria-hidden className={`${className} grid shrink-0 place-items-center rounded-full bg-tag font-semibold text-tag-ink`}>{letter(name)}</span>;
}
