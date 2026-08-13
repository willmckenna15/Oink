"use client";

/**
 * Swipeable photo strip for a place.
 *
 * Uses CSS scroll-snap rather than a carousel library: it gives native
 * momentum and rubber-banding on a phone, keeps working without JS, and the
 * only thing script is needed for is keeping the dots in step.
 *
 * With no photos it falls back to the same generated placeholder used
 * everywhere else, so the header never collapses.
 */
import { useRef, useState } from "react";
import type { Image } from "@/lib/types";
import PlacePhoto from "./PlacePhoto";

export default function PhotoCarousel({
  images,
  alt,
  tailSrc,
  onOpen,
  className = "",
}: {
  images: Image[];
  alt: string;
  /** The place's own Google listing photo, shown *after* everyone's own shots.
   *  Dropped if it fails. */
  tailSrc?: string | null;
  /** Raise the full-screen viewer at the photo currently showing. The carousel
   *  owns which slide that is, so it reports the index rather than the URL. */
  onOpen?: (index: number) => void;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [tailFailed, setTailFailed] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  // Uploads lead: whoever went and took a photo of the place has earned the
  // first slide over a stock listing shot. The listing one can 404 — no key, no
  // photo — so it's only counted once the browser has actually loaded it.
  const slides: { key: string; src: string }[] = [
    ...images.map((img) => ({ key: img.id, src: img.url })),
    ...(tailSrc && !tailFailed ? [{ key: "google", src: tailSrc }] : []),
  ];

  if (slides.length === 0) {
    return <PlacePhoto alt={alt} className={className} />;
  }

  function onScroll() {
    const el = trackRef.current;
    if (!el) return;
    // Each slide is exactly one viewport wide, so the nearest whole multiple of
    // the track width is the photo currently settled under the snap point.
    const next = Math.round(el.scrollLeft / el.clientWidth);
    setIndex(Math.max(0, Math.min(slides.length - 1, next)));
  }

  function goTo(i: number) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div className={`relative ${className}`}>
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={`${alt} — ${slides.length} photos`}
      >
        {slides.map((slide, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- uploads, no loader needed
          <img
            key={slide.key}
            src={slide.src}
            alt={`${alt} — photo ${i + 1} of ${slides.length}`}
            className={`h-full w-full shrink-0 snap-center object-cover ${onOpen ? "cursor-zoom-in" : ""}`}
            draggable={false}
            onClick={onOpen ? () => onOpen(i) : undefined}
            onError={slide.key === "google" ? () => setTailFailed(true) : undefined}
          />
        ))}
      </div>

      {slides.length > 1 && (
        <>
          <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-ink/55 px-2 py-0.5 font-display text-xs font-bold text-white">
            {index + 1}/{slides.length}
          </span>

          <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
            {slides.map((slide, i) => (
              <button
                key={slide.key}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Go to photo ${i + 1}`}
                aria-current={i === index}
                className={`pointer-events-auto h-1.5 rounded-full transition-all ${
                  i === index ? "w-4 bg-white" : "w-1.5 bg-white/60"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
