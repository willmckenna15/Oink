/**
 * One sty.
 *
 * The server read is best-effort, exactly as `serverFetch` promises: it exists
 * to put the sty in the HTML, not to decide whether the page is allowed to
 * exist. An earlier version called `notFound()` when it came back null, which
 * turned every transient hiccup — the API restarting, a cold start, a dropped
 * connection — into a hard 404 on a sty that was there all along. The screen
 * falls back to fetching on mount, and only a sty the API positively denies
 * sends you back to the farm.
 */
import { serverFetch } from "@/lib/server-api";
import type { StyDetail, User } from "@/lib/types";
import StyScreen from "@/components/StyScreen";

export default async function StyPage({ params }: { params: Promise<{ styId: string }> }) {
  const { styId } = await params;
  const sty = await serverFetch<StyDetail>(`/sties/${styId}`);
  const members = sty?.is_member ? await serverFetch<User[]>(`/sties/${styId}/members`) : null;
  return <StyScreen styId={styId} initialSty={sty} initialMembers={members} />;
}
