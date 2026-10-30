// Text folded for matching (never for storing or showing): NFKC (full-width letters and punctuation, ligatures, NBSP),
// Cyrillic and Greek letters that look like Latin ones, then lower case. "Ｔеlegram：" (full-width T, Cyrillic е,
// full-width colon) folds to "telegram:". No imports (unit-tested directly).

const LOOKALIKES: Record<string, string> = {
  // Cyrillic
  "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x",
  "ѕ": "s", "і": "i", "ї": "i", "ј": "j", "ԁ": "d", "ɡ": "g", "ԛ": "q", "ԝ": "w", "һ": "h", "ӏ": "l",
  "А": "a", "В": "b", "Е": "e", "К": "k", "М": "m", "Н": "h", "О": "o", "Р": "p", "С": "c", "Т": "t", "У": "y", "Х": "x", "Ѕ": "s", "І": "i", "Ј": "j",
  // Greek
  "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ω": "w",
  "Α": "a", "Β": "b", "Ε": "e", "Η": "h", "Ι": "i", "Κ": "k", "Μ": "m", "Ν": "n", "Ο": "o", "Ρ": "p", "Τ": "t", "Υ": "y", "Χ": "x", "Ζ": "z",
};
/** The lookalike letters and the Latin letter each stands for (lib/contacts.ts folds with them too). */
export const LOOKALIKE_MAP: Readonly<Record<string, string>> = LOOKALIKES;
const LOOKALIKE = new RegExp(`[${Object.keys(LOOKALIKES).join("")}]`, "g");

/** NFKC, lookalike letters to Latin, lower case. The same length or shorter, character for character where it can be. */
export const fold = (s: string) => s.normalize("NFKC").replace(LOOKALIKE, (c) => LOOKALIKES[c] ?? c).toLowerCase();

/** fold, and every run of whitespace one space, trimmed: for comparing names. */
export const foldName = (s: string) => fold(s).replace(/\s+/g, " ").trim();
