"use client";

/**
 * Flagging something, and muting a person.
 *
 * One control rather than two, because they're the same moment: you've seen
 * something you didn't want to. Muting is instant and reversible; reporting
 * goes to the admins of your sties and needs a reason, because "why" is the
 * only part a moderator can actually act on.
 */
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { ReportTarget } from "@/lib/types";
import { ErrorNote, Sheet } from "@/components/ui";

const WHAT: Record<ReportTarget, string> = {
  user: "this person",
  recommendation: "this review",
  reply: "this reply",
  restaurant: "this place",
};

export default function ReportButton({
  targetType,
  targetId,
  name,
  compact,
}: {
  targetType: ReportTarget;
  targetId: string;
  /** Who this is about, when the target is a person. */
  name?: string;
  /** Render as a small inline link rather than a header button. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"reported" | "muted" | null>(null);

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          setDone(null);
          setError(null);
        }}
        className={
          compact
            ? "text-xs text-ink-soft underline"
            : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-cream font-display text-sm font-extrabold"
        }
        aria-label={`report ${WHAT[targetType]}`}
        title={`report ${WHAT[targetType]}`}
      >
        {compact ? "report" : "!"}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={`report ${WHAT[targetType]}`}>
        <div className="space-y-4 pb-4">
          {done === "reported" ? (
            <>
              <p className="font-display text-sm font-extrabold">Sent</p>
              <p className="text-sm text-ink-soft">
                The admins of your sties can see it. You won&apos;t be told what they decide.
              </p>
              <button className="btn-primary w-full" onClick={() => setOpen(false)}>
                Done
              </button>
            </>
          ) : done === "muted" ? (
            <>
              <p className="font-display text-sm font-extrabold">Muted</p>
              <p className="text-sm text-ink-soft">
                You won&apos;t see {name ?? "them"}, and they won&apos;t see you. They
                aren&apos;t told. Undo it any time under your account.
              </p>
              <button className="btn-primary w-full" onClick={() => setOpen(false)}>
                Done
              </button>
            </>
          ) : (
            <>
              {targetType === "user" && (
                <button
                  className="w-full rounded-card border-2 border-ink bg-oat p-3 text-left"
                  onClick={async () => {
                    setError(null);
                    try {
                      await api.block(targetId);
                      setDone("muted");
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : "Couldn't mute them");
                    }
                  }}
                >
                  <span className="font-display text-sm font-extrabold">
                    mute {name ?? "this person"}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-soft">
                    Instant, reversible, and nobody is told.
                  </span>
                </button>
              )}

              <form
                className="space-y-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError(null);
                  setBusy(true);
                  try {
                    await api.report(targetType, targetId, reason.trim());
                    setDone("reported");
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : "Couldn't send that");
                  }
                  setBusy(false);
                }}
              >
                <p className="font-display text-sm font-extrabold">
                  tell an admin about {WHAT[targetType]}
                </p>
                <textarea
                  className="field min-h-[90px] bg-oat"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What's wrong with it?"
                  minLength={3}
                  required
                />
                {error && <ErrorNote message={error} />}
                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  {busy ? "…" : "Send to admins"}
                </button>
              </form>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
