"use client";

/**
 * Everything you can do to your own account: your address, your password, the
 * devices you're signed in on, the people you've muted, and leaving.
 *
 * All of it is deliberately in one place. These are the things somebody goes
 * looking for when something has gone wrong, and hunting for them across four
 * screens while worrying is the worst time to make anyone hunt.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { Account, BlockEntry } from "@/lib/types";
import { ErrorNote, Sheet, Spinner } from "@/components/ui";

type Panel = "menu" | "email" | "password" | "blocks" | "delete";

export default function AccountSettings({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<Panel>("menu");
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .account()
      .then(setAccount)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your account"));
  }, []);

  useEffect(() => {
    if (!open) return;
    setPanel("menu");
    setError(null);
    load();
  }, [open, load]);

  return (
    <Sheet open={open} onClose={onClose} title="your account">
      <div className="space-y-4 pb-4">
        {error && <ErrorNote message={error} />}
        {!account ? (
          <Spinner />
        ) : panel === "menu" ? (
          <Menu account={account} go={setPanel} />
        ) : panel === "email" ? (
          <EmailPanel account={account} onDone={load} back={() => setPanel("menu")} />
        ) : panel === "password" ? (
          <PasswordPanel back={() => setPanel("menu")} />
        ) : panel === "blocks" ? (
          <BlocksPanel back={() => setPanel("menu")} />
        ) : (
          <DeletePanel back={() => setPanel("menu")} />
        )}
      </div>
    </Sheet>
  );
}

function Row({ label, hint, onClick, danger }: {
  label: string; hint?: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-card border-2 border-ink p-3 text-left ${
        danger ? "bg-cream" : "bg-oat"
      }`}
    >
      <span className={`font-display text-sm font-extrabold ${danger ? "text-blood" : ""}`}>
        {label}
      </span>
      {hint && <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>}
    </button>
  );
}

function Menu({ account, go }: { account: Account; go: (p: Panel) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <Row
        label="email"
        hint={
          account.email
            ? account.email_verified
              ? `${account.email} — confirmed`
              : `${account.email} — not confirmed yet`
            : "none set. Without one there's no way back into your account."
        }
        onClick={() => go("email")}
      />
      <Row label="change password" onClick={() => go("password")} />
      <Row label="muted people" hint="they can't see you either" onClick={() => go("blocks")} />

      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await api.logoutEverywhere().catch(() => {});
          window.location.href = "/sign-in";
        }}
        className="w-full rounded-card border-2 border-ink bg-oat p-3 text-left"
      >
        <span className="font-display text-sm font-extrabold">sign out everywhere</span>
        <span className="mt-0.5 block text-xs text-ink-soft">
          Ends every session on every device, including this one. Use it if you think
          somebody else is signed in as you.
        </span>
      </button>

      <Row label="delete my account" hint="permanent" onClick={() => go("delete")} danger />
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-xs text-ink-soft underline">
      ← back
    </button>
  );
}

function EmailPanel({ account, onDone, back }: {
  account: Account; onDone: () => void; back: () => void;
}) {
  const [email, setEmail] = useState(account.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await api.setEmail(email.trim());
          setSent(true);
          onDone();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Couldn't save that");
        }
        setBusy(false);
      }}
    >
      <BackLink onClick={back} />
      <p className="font-display text-sm font-extrabold">your email</p>
      <p className="text-sm text-ink-soft">
        Only ever used to get you back in. Changing it means confirming the new one.
      </p>
      <input
        className="field bg-oat"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="email"
        required
      />
      {error && <ErrorNote message={error} />}
      {sent && (
        <p className="text-sm text-ink-soft">
          Saved. There&apos;s a confirmation link on its way to that address.
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "…" : "Save and send a confirmation"}
      </button>
    </form>
  );
}

function PasswordPanel({ back }: { back: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await api.changePassword(current, next);
          // Changing it ends every session, this one included — so there is no
          // "saved!" state to show. Send them back to the door.
          window.location.href = "/sign-in";
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Couldn't change it");
          setBusy(false);
        }
      }}
    >
      <BackLink onClick={back} />
      <p className="font-display text-sm font-extrabold">change password</p>
      <input
        className="field bg-oat"
        type="password"
        placeholder="current password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        autoComplete="current-password"
        required
      />
      <input
        className="field bg-oat"
        type="password"
        placeholder="new password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        autoComplete="new-password"
        minLength={6}
        required
      />
      {error && <ErrorNote message={error} />}
      <p className="text-xs text-ink-soft">
        This signs you out everywhere, here included.
      </p>
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "…" : "Change it"}
      </button>
    </form>
  );
}

function BlocksPanel({ back }: { back: () => void }) {
  const [rows, setRows] = useState<BlockEntry[] | null>(null);

  useEffect(() => {
    api.blocks().then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <div className="space-y-3">
      <BackLink onClick={back} />
      <p className="font-display text-sm font-extrabold">muted people</p>
      <p className="text-sm text-ink-soft">
        Muting hides them from you and you from them. Nothing is deleted, and they
        aren&apos;t told.
      </p>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-soft">You haven&apos;t muted anyone.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.user.id}
              className="flex items-center justify-between rounded-card border-2 border-ink bg-oat p-3"
            >
              <span className="font-display text-sm font-bold">{row.user.display_name}</span>
              <button
                className="btn bg-cream px-3 py-1 text-xs"
                onClick={async () => {
                  await api.unblock(row.user.id);
                  setRows((r) => (r ?? []).filter((x) => x.user.id !== row.user.id));
                }}
              >
                Unmute
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeletePanel({ back }: { back: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await api.deleteAccount(password);
          window.location.href = "/sign-in";
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Couldn't delete the account");
          setBusy(false);
        }
      }}
    >
      <BackLink onClick={back} />
      <p className="font-display text-sm font-extrabold text-blood">delete my account</p>
      <p className="text-sm text-ink-soft">
        This removes your pig, your reviews, your replies, your oinks and shames, your
        wishlist, your sty memberships and every photo you uploaded. It cannot be undone.
      </p>
      <p className="text-sm text-ink-soft">
        Places you added <strong className="text-ink">stay</strong> — other people&apos;s
        reviews hang off them — but nothing will say they were yours.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1"
        />
        <span>I understand this is permanent.</span>
      </label>
      <input
        className="field bg-oat"
        type="password"
        placeholder="your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
      />
      {error && <ErrorNote message={error} />}
      <button
        type="submit"
        className="btn w-full border-2 border-ink bg-blood text-white"
        disabled={busy || !confirmed}
      >
        {busy ? "…" : "Delete everything"}
      </button>
    </form>
  );
}
