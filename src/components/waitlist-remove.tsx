"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function Remove() {
  const token = useSearchParams().get("t") ?? "";
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function remove() {
    setState("busy");
    const res = await fetch("/api/waitlist/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    const data = await res.json().catch(() => ({}));
    setState(res.ok ? "done" : "error");
    setMsg(res.ok ? "Done. You're off the waitlist and your details are deleted." : (data.error ?? "Something went wrong."));
  }
  return (
    <div className="rise mx-auto flex max-w-sm flex-col gap-4 pt-16 text-center">
      <h1 className="k-serif text-[2rem] leading-tight">Leave the waitlist</h1>
      {state === "done" || state === "error" ? (
        <p className={state === "error" ? "font-semibold text-danger" : ""}>{msg}</p>
      ) : (
        <>
          <p className="text-muted">This deletes your email and everything you told us. The link works once.</p>
          <button type="button" className="btn btn-primary" disabled={!token || state === "busy"} onClick={remove}>
            {state === "busy" ? "Removing..." : "Remove me"}
          </button>
        </>
      )}
    </div>
  );
}

/** Leave the waitlist with the one-time link (/waitlist/remove, and /app/waitlist/remove for the store apps). */
export function WaitlistRemove() {
  return (
    <Suspense>
      <Remove />
    </Suspense>
  );
}
