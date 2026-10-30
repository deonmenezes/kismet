// Where a weekly-drop date plan can happen (lib/drop.ts). Edit freely: the plan writer may only pick one of these
// ids, and the plan text uses `idea` as written. Named places are real ones near the Edge City India hub (Riva Beach
// Resort, Mandrem, North Goa); everything else stays generic, never a made-up business name.
// parts: when it fits ("morning" ~10 am, "sunset" ~5:30 pm, "evening" ~7 pm). No imports (unit-tested directly).

export type Part = "morning" | "sunset" | "evening";
export type Venue = { id: string; place: string; idea: string; parts: Part[] };

/** For Edge City residents (or anyone whose area is in or near Mandrem). */
export const EDGE_CITY_VENUES: Venue[] = [
  { id: "mandrem-sunset", place: "Mandrem Beach", idea: "a sunset walk on Mandrem Beach", parts: ["sunset"] },
  { id: "ashvem-sunset", place: "Ashvem Beach", idea: "a sunset swim at Ashvem Beach", parts: ["sunset"] },
  { id: "riva-chai", place: "Riva Beach Resort", idea: "chai by the sea at Riva Beach Resort", parts: ["morning", "sunset", "evening"] },
  { id: "riva-dinner", place: "Riva Beach Resort", idea: "an early dinner at Riva Beach Resort", parts: ["evening"] },
  { id: "circle-cowork", place: "The Circle.Work", idea: "coffee and a co-working hour at The Circle.Work", parts: ["morning", "evening"] },
  { id: "mandrem-morning", place: "Mandrem Beach", idea: "a morning walk and a swim at Mandrem Beach", parts: ["morning"] },
  { id: "shack-chai", place: "a beach shack near the village", idea: "chai at a beach shack near the village", parts: ["morning", "sunset", "evening"] },
];

/** For people somewhere else: generic, safe anywhere. */
export const ANYWHERE_VENUES: Venue[] = [
  { id: "cafe", place: "a café you both like", idea: "coffee at a café you both like", parts: ["morning", "sunset", "evening"] },
  { id: "walk", place: "somewhere green nearby", idea: "a walk somewhere green nearby", parts: ["morning", "sunset"] },
  { id: "dinner", place: "a quiet place for dinner", idea: "an easy dinner somewhere quiet", parts: ["evening"] },
];

/** An area that is (or is near) the Edge City hub; empty counts as here, since most residents are. */
export const EDGE_AREA = /mandrem|ashvem|arambol|morjim|goa|edge ?city|riva|village|^\s*$/i;
