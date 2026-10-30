// Control characters out of free text, before it is checked, stored or shown. No imports (unit-tested directly).
// C0 controls but tab, newline and carriage return, DEL and C1, the zero-width space, direction marks and bidi
// overrides. The zero-width joiner and non-joiner (U+200C/D) stay: emoji (the rainbow flag, the woman technologist) and Indic and Persian
// scripts need them (lib/contacts.ts ignores them when it looks for contacts). Postgres refuses U+0000 in text
// outright, so a NUL left in any field was a 500.

const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** The text without control characters (tabs and line breaks stay). */
export const stripControls = (s: string) => s.replace(CONTROLS, "");

/** Every string in a parsed JSON value (objects and arrays, any depth) without control characters. */
export function stripControlsDeep<T>(v: T): T {
  if (typeof v === "string") return stripControls(v) as T;
  if (Array.isArray(v)) return v.map(stripControlsDeep) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [stripControls(k), stripControlsDeep(x)])) as T;
  }
  return v;
}

// A NUL written as JSON (the six characters \u0000, after an even number of backslashes): jsonb refuses it too.
const JSON_NUL = /(?<!\\)((?:\\\\)*)\\u0000/g;

/** NUL only (the one character Postgres can't store), for values on their way to the database (JSON text too). */
export function withoutNul<T>(v: T): T {
  if (typeof v === "string") {
    const s = v.includes("\u0000") ? v.replaceAll("\u0000", "") : v;
    return (s.includes("\\u0000") ? s.replace(JSON_NUL, "$1") : s) as T;
  }
  if (Array.isArray(v)) return (v.some((x) => typeof x !== "number") ? v.map(withoutNul) : v) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [withoutNul(k), withoutNul(x)])) as T;
  }
  return v;
}
