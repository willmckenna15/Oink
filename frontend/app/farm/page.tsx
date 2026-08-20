/**
 * The farm — server wrapper. Sties are fetched server-side so the meadow has
 * huts on it in the HTML; the screen itself is a client component because
 * panning and zooming need pointer events.
 */
import { serverFetch } from "@/lib/server-api";
import type { StySummary } from "@/lib/types";
import FarmScreen from "@/components/FarmScreen";

export default async function FarmPage() {
  const initialSties = await serverFetch<StySummary[]>("/sties");
  return <FarmScreen initialSties={initialSties} />;
}
