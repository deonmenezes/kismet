"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { any, CredentialRequest, IDKitRequestWidget, type IDKitResult, type RpContext } from "@worldcoin/idkit";

type Config = { appId: `app_${string}`; rpId: string; action: string; environment: "production" | "staging" };

// Runs one World ID request (Orb or Selfie Check, World ID 4.0) for a one-time verify link. On a phone the
// widget opens World App; on a computer it shows a QR code to scan with the phone.
export function WorldVerify({ code, name, signal, config }: { code: string; name: string; signal: string; config: Config }) {
  const [rp, setRp] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const constraints = useMemo(() => any(CredentialRequest("proof_of_human", { signal }), CredentialRequest("selfie", { signal })), [signal]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/world/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) return setError(d.message ?? "Something went wrong. Try again.");
      setRp({ rp_id: config.rpId, nonce: d.nonce, created_at: d.created_at, expires_at: d.expires_at, signature: d.signature });
      setOpen(true);
    } catch {
      setError("Couldn't connect. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(result: IDKitResult) {
    const res = await fetch("/api/world/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, result }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      setError(d.message ?? "World ID could not verify that proof.");
      throw new Error(d.error ?? "verification failed");
    }
    setDone(d.message ?? "Verified ✓");
  }

  if (done) {
    return (
      <div className="rise flex flex-col items-center gap-4 pt-10 text-center">
        <div className="grid size-20 place-items-center rounded-full bg-sea text-4xl text-bg">✓</div>
        <h1 className="k-serif text-[2rem] leading-tight">You&apos;re verified, {name}!</h1>
        <p className="text-muted">{done}</p>
        <Link href="/home" className="btn btn-primary w-full">See my intros</Link>
      </div>
    );
  }

  return (
    <div className="rise flex flex-col gap-5 pt-8">
      <div>
        <p className="k-kicker">Optional</p>
        <h1 className="k-serif mt-1 text-[2rem] leading-tight">Verify with World ID, {name}</h1>
        <p className="mt-2 text-muted">
          Get a <b className="text-ink">✓ World ID verified</b> badge your matches see, and rank a little higher when agents pick who to chat with.
          Works with an Orb-verified World ID or a Selfie Check in World App. Nothing personal is shared with Kismet: only an anonymous
          number that stops one World ID from verifying two accounts.
        </p>
      </div>
      <button type="button" className="btn btn-primary w-full text-lg" disabled={busy} onClick={start}>
        {busy ? "Preparing..." : "Verify with World ID"}
      </button>
      <p className="text-center text-xs text-muted">On your phone this opens World App. On a computer, scan the QR code with your phone.</p>
      {error && <p role="alert" className="rounded-2xl bg-danger/10 p-3 text-sm font-semibold text-danger">{error}</p>}
      <Link href="/home" className="text-center text-sm font-semibold text-muted underline">Skip, maybe later</Link>
      {rp && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={config.appId}
          action={config.action}
          rp_context={rp}
          allow_legacy_proofs={false}
          environment={config.environment}
          constraints={constraints}
          handleVerify={handleVerify}
          onSuccess={() => setDone((m) => m || "Verified ✓")}
        />
      )}
    </div>
  );
}
