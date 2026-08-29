"use client";

/**
 * The reports queue, for anyone who administers a sty.
 *
 * Two outcomes only. Dismissing closes the report and leaves everything alone;
 * actioning takes the content down. A reported *person* is a deliberate
 * exception — actioning removes what they wrote and leaves the account, because
 * throwing somebody off the farm isn't a decision to take from a list.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { Report } from "@/lib/types";
import { EmptyState, ErrorNote, Sheet, Spinner, timeAgo } from "@/components/ui";

const WHAT: Record<Report["target_type"], string> = {
  user: "a person",
  recommendation: "a review",
  reply: "a reply",
  restaurant: "a place",
};

const CONSEQUENCE: Record<Report["target_type"], string> = {
  user: "Takes down their reviews and replies. Their account stays.",
  recommendation: "Deletes the review and everything replying to it.",
  reply: "Deletes the reply.",
  restaurant: "Deletes the place, and the photos on it.",
};

export default function ModerationQueue({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .reports("open")
      .then(setReports)
      .catch((e) => {
        setReports([]);
        setError(e instanceof ApiError ? e.message : "Couldn't load the queue");
      });
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function resolve(report: Report, state: "actioned" | "dismissed") {
    setBusy(report.id);
    try {
      await api.resolveReport(report.id, state);
      setReports((r) => (r ?? []).filter((x) => x.id !== report.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't resolve that");
    }
    setBusy(null);
  }

  return (
    <Sheet open={open} onClose={onClose} title="reports">
      <div className="space-y-3 pb-4">
        {error && <ErrorNote message={error} />}
        {!reports ? (
          <Spinner />
        ) : reports.length === 0 ? (
          <EmptyState title="nothing to look at" body="No open reports." />
        ) : (
          reports.map((r) => (
            <div key={r.id} className="space-y-2 rounded-card border-2 border-ink bg-oat p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-sm font-extrabold">{WHAT[r.target_type]}</span>
                <span className="text-xs text-ink-soft">{timeAgo(r.created_at)}</span>
              </div>
              <p className="text-sm">{r.reason}</p>
              <p className="text-xs text-ink-soft">
                reported by {r.reporter.display_name}
              </p>
              <p className="text-xs text-ink-soft">{CONSEQUENCE[r.target_type]}</p>
              <div className="flex gap-2 pt-1">
                <button
                  className="btn flex-1 bg-cream text-xs"
                  disabled={busy === r.id}
                  onClick={() => resolve(r, "dismissed")}
                >
                  Leave it
                </button>
                <button
                  className="btn flex-1 border-2 border-ink bg-blood text-xs text-white"
                  disabled={busy === r.id}
                  onClick={() => resolve(r, "actioned")}
                >
                  Take it down
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}
