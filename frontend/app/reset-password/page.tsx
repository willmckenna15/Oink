"use client";

/**
 * Setting a new password from an emailed link.
 *
 * The token arrives in the query string and is spent on submit. Resetting also
 * ends every other session on the account, which is the point rather than a
 * side effect: if you're here because somebody else got in, they're now out.
 */
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { ErrorNote } from "@/components/ui";
import PigAvatar from "@/components/pigs/PigAvatar";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Those two don't match");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
    setBusy(false);
  }

  if (!token) {
    return (
      <div className="card w-full space-y-3 p-4 text-center">
        <p className="font-display text-lg font-bold">That link is incomplete</p>
        <p className="text-sm text-ink-soft">
          Open the link from your email exactly as it was sent, or ask for a new one.
        </p>
        <Link href="/sign-in" className="btn block w-full bg-oat">
          Back to sign in
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card w-full space-y-3 p-4 text-center">
        <p className="font-display text-lg font-bold">Password changed</p>
        <p className="text-sm text-ink-soft">
          Every device that was signed in has been signed out, including this one.
        </p>
        <Link href="/sign-in" className="btn-primary block w-full text-lg">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card w-full space-y-3 p-4">
      <p className="font-display text-lg font-bold">Set a new password</p>
      <label className="block">
        <span className="font-display text-sm font-bold">new password</span>
        <input
          className="field mt-1 bg-oat"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
      </label>
      <label className="block">
        <span className="font-display text-sm font-bold">again</span>
        <input
          className="field mt-1 bg-oat"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
      </label>
      {error && <ErrorNote message={error} />}
      <button type="submit" className="btn-primary w-full text-lg" disabled={busy}>
        {busy ? "…" : "Change it"}
      </button>
      <p className="text-center text-xs text-ink-soft">
        This link works once, and signs out every device.
      </p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="mb-5 flex flex-col items-center">
        <PigAvatar size={110} variant="full" placesLogged={12} config={{ color: "pink" }} />
        <h1 className="mt-2 text-4xl tracking-tight">oink</h1>
      </div>
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
