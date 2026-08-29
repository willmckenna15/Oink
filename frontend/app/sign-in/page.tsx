"use client";

/** Sign-in — spec §6.1. Deliberately minimal: username, password, done. */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { queueIntroIfNew } from "@/lib/intro";
import { ErrorNote } from "@/components/ui";
import PigAvatar from "@/components/pigs/PigAvatar";

function SignInForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The forgot-password panel replaces the form rather than sitting under it —
  // somebody who can't get in doesn't need the thing that isn't working.
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } =
        mode === "signup"
          ? await api.signup(username, password, displayName || username, email)
          : await api.login(username, password);
      // Queue the explainer for anyone who hasn't seen it on this device.
      queueIntroIfNew(user.id);
      // The session cookie is set by the API; a full navigation lets the Next
      // middleware see it immediately.
      window.location.href = params.get("next") || "/";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <div className="mb-5 flex flex-col items-center">
        <PigAvatar
          size={140}
          variant="full"
          placesLogged={42}
          holding="knife"
          config={{ color: "pink", hat: "chef" }}
        />
        <h1 className="mt-2 text-5xl tracking-tight">oink</h1>
        <p className="mt-1 text-center font-display text-sm text-ink-soft">
          where your friends actually eat
        </p>
      </div>

      {forgot ? (
        <ForgotPanel
          sent={sent}
          busy={busy}
          error={error}
          onBack={() => {
            setForgot(false);
            setSent(false);
            setError(null);
          }}
          onSubmit={async (address) => {
            setError(null);
            setBusy(true);
            try {
              await api.forgotPassword(address);
              setSent(true);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Something went wrong");
            }
            setBusy(false);
          }}
        />
      ) : (
      <form onSubmit={submit} className="card w-full space-y-3 p-4">
        <div className="flex gap-2">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`btn flex-1 text-sm ${
                mode === m ? "bg-plum text-white" : "bg-oat"
              }`}
            >
              {m === "login" ? "Sign in" : "Join"}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="font-display text-sm font-bold">username</span>
          <input
            className="field mt-1 bg-oat"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            required
          />
        </label>

        {mode === "signup" && (
          <>
            <label className="block">
              <span className="font-display text-sm font-bold">display name</span>
              <input
                className="field mt-1 bg-oat"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="what friends call you"
              />
            </label>

            <label className="block">
              <span className="font-display text-sm font-bold">email</span>
              <input
                className="field mt-1 bg-oat"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="email"
                placeholder="so you can get back in"
                required
              />
              <span className="mt-1 block text-xs text-ink-soft">
                Only ever used to get you back into your account.
              </span>
            </label>
          </>
        )}

        <label className="block">
          <span className="font-display text-sm font-bold">password</span>
          <input
            className="field mt-1 bg-oat"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
        </label>

        {error && <ErrorNote message={error} />}

        <button type="submit" className="btn-primary w-full text-lg" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Let me in" : "Make me a pig"}
        </button>

        {mode === "login" && (
          <button
            type="button"
            onClick={() => {
              setForgot(true);
              setError(null);
            }}
            className="w-full text-center text-xs text-ink-soft underline"
          >
            Forgotten your password?
          </button>
        )}

        <p className="text-center text-xs text-ink-soft">stays signed in for 30 days</p>
      </form>
      )}
    </main>
  );
}

/**
 * Asking for a reset link.
 *
 * The API deliberately answers the same way whether or not the address has an
 * account, so that it can't be used to find out who's a member. The wording
 * here has to hold that line: "if there's an account", never "we've sent you".
 */
function ForgotPanel({
  sent,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  sent: boolean;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (email: string) => void;
}) {
  const [address, setAddress] = useState("");

  if (sent) {
    return (
      <div className="card w-full space-y-3 p-4 text-center">
        <p className="font-display text-lg font-bold">Check your email</p>
        <p className="text-sm text-ink-soft">
          If there&apos;s an account for <strong className="text-ink">{address}</strong>, a
          link to set a new password is on its way. It works once, and lasts two hours.
        </p>
        <button type="button" onClick={onBack} className="btn w-full bg-oat">
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form
      className="card w-full space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(address.trim());
      }}
    >
      <p className="font-display text-lg font-bold">Forgotten your password?</p>
      <p className="text-sm text-ink-soft">
        Put in the address you signed up with and we&apos;ll send you a link to set a new one.
      </p>
      <label className="block">
        <span className="font-display text-sm font-bold">email</span>
        <input
          className="field mt-1 bg-oat"
          type="email"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="email"
          required
        />
      </label>
      {error && <ErrorNote message={error} />}
      <button type="submit" className="btn-primary w-full text-lg" disabled={busy}>
        {busy ? "…" : "Send me a link"}
      </button>
      <button type="button" onClick={onBack} className="w-full text-center text-xs text-ink-soft underline">
        Back to sign in
      </button>
    </form>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
