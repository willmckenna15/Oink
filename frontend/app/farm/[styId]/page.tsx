/**
 * One sty. A non-member never gets here — the farm chains their hut shut and
 * offers a join request instead — but the check is repeated on the server
 * anyway, because a URL is a URL.
 */
import { notFound, redirect } from "next/navigation";
import { serverFetch } from "@/lib/server-api";
import type { StyDetail, User } from "@/lib/types";
import StyScreen from "@/components/StyScreen";

export default async function StyPage({ params }: { params: Promise<{ styId: string }> }) {
  const { styId } = await params;
  const sty = await serverFetch<StyDetail>(`/sties/${styId}`);
  if (!sty) notFound();
  if (!sty.is_member) redirect("/farm");
  const members = await serverFetch<User[]>(`/sties/${styId}/members`);
  return <StyScreen initialSty={sty} initialMembers={members} />;
}
