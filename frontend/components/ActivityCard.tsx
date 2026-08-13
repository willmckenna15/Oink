"use client";

/**
 * Home feed items — spec §6.2.
 *
 * Two shapes, because a reaction isn't a small review:
 *
 *   anything written  a card — thumbnail beside the review text and dish tags
 *   a bare reaction   a row — who, the place, the meta, the time. No thumbnail.
 *
 * The split is on whether there's something to read, not on the activity: a
 * shame written up is a full card carrying its reasons, with a rust "shames"
 * sticker where the review card says "recommends".
 *
 * The row carries **no thumbnail on purpose**. Most places reached only by a
 * reaction have no photo, so the tile was the generated letter placeholder far
 * more often than a picture — a coloured square repeated down the page, saying
 * nothing. A review keeps its thumbnail, which is where a photo actually is.
 *
 * Agreement is folded in rather than repeated (see lib/feed.ts): where other
 * people have oinked the same place, they appear as a face and a count at the
 * foot of the log they agreed with, instead of each getting a row of their own.
 *
 * Replies show as **faces and a count only** — never their text. The thread
 * lives on the place page. Putting bodies here would grow cards without limit
 * and undo the work of making this feed quiet, and bumping a review when someone
 * replies would break the ordering for the sake of one chatty thread.
 *
 * No rating appears anywhere (spec §8).
 */
import Link from "next/link";
import { googlePhotoSrc } from "@/lib/api";
import type { FeedItem, User } from "@/lib/types";
import { agreementLabel } from "@/lib/feed";
import PigAvatar from "@/components/pigs/PigAvatar";
import { BudgetTag } from "@/components/pigs/PricePig";
import { KIND_LABELS, timeAgo } from "@/components/ui";
import PlacePhoto from "@/components/PlacePhoto";

export default function ActivityCard({
  item,
  agreed = [],
}: {
  item: FeedItem;
  agreed?: User[];
}) {
  // A shame with a write-up is a write-up: it has text, dishes and photos, and
  // the row shape would throw all three away. What changes is the verdict on
  // it, not the shape of the card.
  const written = item.activity === "recommendation" || !!item.review_text;
  return written ? (
    <ReviewCard item={item} agreed={agreed} />
  ) : (
    <ReactionRow item={item} agreed={agreed} />
  );
}

/**
 * Everyone who oinked the same place after it was logged: one face, a count for
 * the rest, and their names in the label. One face rather than a pile because a
 * pile wraps as soon as a fourth person joins, and the names carry who it was
 * better than three near-identical pigs at 22px.
 */
function Agreement({ agreed }: { agreed: User[] }) {
  if (agreed.length === 0) return null;
  return (
    <>
      <div className="rule-dashed mx-3" />
      <div className="flex items-center gap-1.5 px-3 py-2">
        <PigAvatar
          config={agreed[0].pig_avatar_config}
          placesLogged={agreed[0].places_logged}
          lastLoggedAt={agreed[0].last_logged_at}
          size={22}
          variant="face"
        />
        {agreed.length > 1 && <span className="micro-pill bg-plum text-oat">+{agreed.length - 1}</span>}
        <span className="micro min-w-0 truncate">{agreementLabel(agreed)}</span>
      </div>
    </>
  );
}

/** Someone wrote something — the full card. */
function ReviewCard({ item, agreed }: { item: FeedItem; agreed: User[] }) {
  const place = item.restaurant;
  const shamed = item.activity === "shame";

  return (
    <article className="card overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Link href={`/profile/${item.user.username}`} className="shrink-0">
          <PigAvatar
            config={item.user.pig_avatar_config}
            placesLogged={item.user.places_logged}
            lastLoggedAt={item.user.last_logged_at}
            size={34}
            variant="full"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={`/profile/${item.user.username}`}
            className="block truncate font-display text-sm font-bold"
          >
            {item.user.display_name}
          </Link>
          <p className="micro">{timeAgo(item.created_at)}</p>
        </div>
        <span className={`sticker ${shamed ? "bg-rust text-oat" : "bg-lemon text-ink-deep"}`}>
          {shamed ? "shamed" : "recommends"}
        </span>
      </div>

      <div className="rule-dashed mx-3" />

      <Link href={`/restaurant/${place.id}`} className="flex gap-3 p-3">
        <PlacePhoto
          /* This person's own shot of the place first, then anyone else's,
             then the listing photo. The card is their write-up; leading it with
             a stock image of the dining room is somebody else's story. */
          src={
            item.images[0]?.url ??
            place.uploaded_photo_url ??
            (place.google_place_id ? googlePhotoSrc(place.id) : place.cover_image_url)
          }
          alt={place.name}
          className="h-[74px] w-[74px] shrink-0 rounded-lg border-2 border-ink"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="min-w-0 truncate font-display text-lg font-bold leading-tight">
              {place.name}
            </h2>
            {/* Budget is never bare `$` text — it always travels with its pig. */}
            <BudgetTag budget={place.budget} size={26} />
          </div>
          <p className="micro mt-0.5">
            {[place.city, KIND_LABELS[place.kind]].filter(Boolean).join(" · ")}
          </p>
          {item.review_text && (
            <p className="mt-1.5 line-clamp-3 text-sm leading-snug">{item.review_text}</p>
          )}
          {!shamed && item.recommended_dishes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.recommended_dishes.slice(0, 3).map((dish) => (
                <span key={dish} className="dish-tag">{dish}</span>
              ))}
            </div>
          )}
        </div>
      </Link>

      <Agreement agreed={agreed} />
      <Replies item={item} />
    </article>
  );
}

/**
 * Who is talking about this review, not what they said. Tapping goes to the
 * place, where the thread actually is.
 */
function Replies({ item }: { item: FeedItem }) {
  if (!item.reply_count) return null;
  return (
    <>
      <div className="rule-dashed mx-3" />
      <Link
        href={`/restaurant/${item.restaurant.id}`}
        className="flex items-center gap-1.5 px-3 py-2"
      >
        {item.repliers.slice(0, 3).map((u) => (
          <PigAvatar
            key={u.id}
            config={u.pig_avatar_config}
            placesLogged={u.places_logged}
            lastLoggedAt={u.last_logged_at}
            size={20}
            variant="face"
          />
        ))}
        <span className="micro">
          {item.reply_count} {item.reply_count === 1 ? "reply" : "replies"}
        </span>
      </Link>
    </>
  );
}

/** Someone reacted — a row, and no thumbnail (see the note at the top). */
function ReactionRow({ item, agreed }: { item: FeedItem; agreed: User[] }) {
  const place = item.restaurant;
  const shamed = item.activity === "shame";

  return (
    <article className="card">
      <div className="flex items-center gap-2.5 p-2.5">
        <Link href={`/profile/${item.user.username}`} className="shrink-0">
          <PigAvatar
            config={item.user.pig_avatar_config}
            placesLogged={item.user.places_logged}
            lastLoggedAt={item.user.last_logged_at}
            size={30}
            variant="face"
          />
        </Link>

        <div className="min-w-0 flex-1">
          {/* Header mirrors the review card — pig, name, verdict — so the two
              shapes read as one family rather than two separate designs. */}
          <div className="flex items-center gap-1.5">
            <Link
              href={`/profile/${item.user.username}`}
              className="min-w-0 truncate font-display text-sm font-bold"
            >
              {item.user.display_name}
            </Link>
            <span
              className={`micro-pill shrink-0 ${shamed ? "bg-rust text-oat" : "bg-plum text-oat"}`}
            >
              {shamed ? "shamed" : "oinked"}
            </span>
            <span className="micro ml-auto shrink-0">{timeAgo(item.created_at)}</span>
          </div>

          <Link href={`/restaurant/${place.id}`} className="block">
            <h2 className="mt-0.5 truncate font-display text-base font-bold leading-tight">
              {place.name}
            </h2>
            <div className="flex items-center gap-1.5">
              <p className="micro min-w-0 truncate">
                {[place.city, KIND_LABELS[place.kind]].filter(Boolean).join(" · ")}
              </p>
              {/* Budget is never bare `$` text — it always travels with its pig. */}
              <BudgetTag budget={place.budget} size={20} />
            </div>
          </Link>
        </div>
      </div>

      {/* A shame never collects agreement — it can't be the first log of a place,
          so nothing folds onto it. */}
      <Agreement agreed={agreed} />
    </article>
  );
}
