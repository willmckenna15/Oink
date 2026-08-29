"use client";

/**
 * What Oink is and how the pig works.
 *
 * Shown once automatically after a first sign-in, and reachable from the
 * profile any time after that. The tier ladder is rendered with the real
 * PigAvatar rather than described, because the whole point is what they look
 * like.
 */
import PigAvatar from "@/components/pigs/PigAvatar";
import { OinkPig, ShamePig } from "@/components/pigs/ReactionPigs";
import { FATNESS_TIERS, TIER_LABELS } from "@/lib/pig";
import { Sheet } from "@/components/ui";
import { InstallSteps } from "@/components/AddToHomeScreen";
import { platform } from "@/lib/homescreen";

const NOW = new Date().toISOString();
const LONG_AGO = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();

export default function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="how oink works">
      <div className="space-y-5 pb-4">
        <p className="text-sm text-ink-soft">
          Somewhere between you and your friends, every good restaurant you&apos;ve been to
          is already known. Oink is where it gets written down.
        </p>

        <section className="space-y-2">
          <h3 className="font-display text-sm font-extrabold">there are no stars</h3>
          <div className="flex items-start gap-3">
            <OinkPig size={38} active />
            <p className="flex-1 text-sm text-ink-soft">
              <strong className="text-ink">oink</strong> — you&apos;d send a friend here.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <ShamePig size={38} active />
            <p className="flex-1 text-sm text-ink-soft">
              <strong className="text-ink">shame</strong> — you wouldn&apos;t. Say why in the
              write-up; that&apos;s where the useful part lives.
            </p>
          </div>
          <p className="text-sm text-ink-soft">
            Adding a place counts as an oink, so it lands on your profile straight away.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-display text-sm font-extrabold">your pig is your logbook</h3>
          <p className="text-sm text-ink-soft">
            It fattens as you log places. Everyone starts slim.
          </p>
          <div className="grid grid-cols-3 gap-2 pt-1">
            {FATNESS_TIERS.map((t) => (
              <div key={t.tier} className="flex flex-col items-center text-center">
                <PigAvatar placesLogged={t.min} lastLoggedAt={NOW} size={74} variant="full" />
                <p className="font-display text-[11px] font-extrabold leading-tight">
                  {TIER_LABELS[t.tier]}
                </p>
                <p className="text-[10px] text-ink-soft">{t.min}+ places</p>
              </div>
            ))}
            <div className="flex flex-col items-center text-center">
              <PigAvatar placesLogged={20} lastLoggedAt={LONG_AGO} size={74} variant="full" />
              <p className="font-display text-[11px] font-extrabold leading-tight">dead pig</p>
              <p className="text-[10px] text-ink-soft">gone quiet</p>
            </div>
          </div>
          <p className="text-sm text-ink-soft">
            Keep going and it just keeps growing: <strong className="text-ink">humungous</strong>.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-display text-sm font-extrabold">it works both ways</h3>
          <p className="text-sm text-ink-soft">
            Go a month without logging anywhere and your pig drops a tier. Keep it up and
            it starves all the way down to a dead pig. <strong className="text-ink">Nothing is
            ever lost though</strong> — log a single place and you&apos;re straight back to
            whatever you&apos;d earned, however far you fell.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-display text-sm font-extrabold">sties</h3>
          <p className="text-sm text-ink-soft">
            The farm is made of sties, and a sty is a set of friends. You can be in more
            than one, and your feed and map only ever show the places logged by the sties
            you&apos;re in. Each one picks its own ground and its own hut.
          </p>
          <p className="text-sm text-ink-soft">
            Every sty keeps its <strong className="text-ink">own verdict</strong>. A small
            sty crowns its own pig rather than being permanently outvoted by a big one, so
            the same person can be on the throne in one and in the enclosure in another.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-display text-sm font-extrabold">the throne and the enclosure</h3>
          <p className="text-sm text-ink-soft">
            Both are decided by the sty, not by you, and neither can be farmed by logging
            more. What counts is your <strong className="text-ink">OG places</strong> — the
            ones you were first to put on the map — and what everyone else made of them.
          </p>
          <div className="flex items-start gap-3">
            <OinkPig size={38} active />
            <p className="flex-1 text-sm text-ink-soft">
              <strong className="text-ink">the throne</strong> — whoever&apos;s OG places have
              collected the most oinks. The sty saying your taste can be trusted.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <ShamePig size={38} active />
            <p className="flex-1 text-sm text-ink-soft">
              <strong className="text-ink">the shame enclosure</strong> — whoever&apos;s have
              collected the most shames. Penned in, with a placard.
            </p>
          </div>
          <p className="text-sm text-ink-soft">
            Nobody is crowned and caged at once — the throne wins. Nobody wins either on
            nothing: with no oinks and no shames going around, both stand empty.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-display text-sm font-extrabold">the graveyard</h3>
          <p className="text-sm text-ink-soft">
            Pigs that have starved all the way down get buried at the bottom of the sty,
            behind the railings, with a headstone each. It isn&apos;t a punishment and it
            isn&apos;t permanent — log a single place and you climb straight back out to
            whatever tier you&apos;d earned.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="font-display text-sm font-extrabold">put it on your home screen</h3>
          <p className="text-sm text-ink-soft">
            Oink works like an app from there — own icon, no browser bar, straight to the feed.
          </p>
          <InstallSteps os={platform()} />
        </section>

        <button onClick={onClose} className="btn-primary w-full text-lg">
          Got it
        </button>
      </div>
    </Sheet>
  );
}
