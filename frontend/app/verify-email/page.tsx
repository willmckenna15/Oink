"use client";

/**
 * Confirming an email address from an emailed link.
 *
 * Nothing to fill in — the token is the whole thing — so this spends it on
 * mount and reports what happened. The token is single use, so arriving here
 * twice (a double tap, a prefetching mail client) shows the failed state; the
 * copy says so rather than implying the address is broken.
 */
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { Spinner } from "@/components/ui";
import PigAvatar from "@/components/pigs/PigAvatar";

function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("failed");
      setMessage("That link is incomplete. Open it from your email exactly as it was sent.");
      return;
    }
    let live = true;
    api
      .verifyEmail(token)
      .then(() => live && setState("done"))
      .catch((err) => {
        if (!live) return;
        setState("failed");
        setMessage(
          err instanceof ApiError
            ? err.message
            : "Something went wrong confirming that address."
        );
      });
    return () => {
      live = false;
    };
  }, [token]);

  if (state === "working") {
    return (
      <div className="card w-full p-6 text-center">
        <Spinner />
        <p className="mt-2 text-sm text-ink-soft">Confirming your address…</p>
      </div>
    );
  }

  return (
    <div className="card w-full space-y-3 p-4 text-center">
      <p className="font-display text-lg font-bold">
        {state === "done" ? "Address confirmed" : "That link didn't work"}
      </p>
      <p className="text-sm text-ink-soft">
        {state === "done"
          ? "You can get back into your account if you ever forget your password."
          : `${message} A confirmation link works once — if you've already used it, you're done.`}
      </p>
      <Link href="/" className="btn-primary block w-full text-lg">
        Off to the feed
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="mb-5 flex flex-col items-center">
        <PigAvatar size={110} variant="full" placesLogged={12} config={{ color: "pink" }} />
        <h1 className="mt-2 text-4xl tracking-tight">oink</h1>
      </div>
      <Suspense fallback={null}>
        <Verify />
      </Suspense>
    </main>
  );
}
