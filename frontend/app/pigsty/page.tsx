/** The pigsty became the farm. Old links and bookmarks still work. */
import { redirect } from "next/navigation";

export default function PigstyPage() {
  redirect("/farm");
}
