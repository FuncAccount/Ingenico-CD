import { cn } from "@/lib/utils"

/**
 * The mark for work that is genuinely in flight.
 *
 * ONE definition, used by the rail marker, the step badge and the checks panel.
 * Three hand-rolled amber dots would be three places for the colour, the pulse
 * and the wording to drift, and this state exists precisely because the badge
 * and the panel beneath it had already drifted once.
 *
 * WHY AMBER, given that amber elsewhere means "look at this".
 *
 * The alternative — grey — is what it replaced, and grey was indistinguishable
 * from a step that had not had its turn. So an open KYC check rendered exactly
 * like an inert one, and the merchant waited on a provider while nothing on
 * this side showed anyone was waiting at all. Between "reads as nothing
 * happening" and "reads as worth a glance", the second is the honest one: the
 * file IS held up, just not by a fault and not by the acquirer.
 *
 * It stays distinct from a finding, which is the other amber on these screens,
 * by MOTION and by ICON. A finding is a static amber warning triangle and it is
 * settled — someone has to answer it. This pulses, carries no triangle, and
 * says so in words. And where a step has both, the finding wins the marker:
 * a thing to be answered outranks a thing to be waited out.
 */
export function PulseDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex h-2 w-2 shrink-0", className)} aria-hidden>
      {/* The expanding ring is the whole signal — a solid dot that merely sat
          there is what grey already was. `animate-agent-ring` is disabled
          under prefers-reduced-motion in globals.css, which is why the colour
          and the wording have to carry the state on their own too. */}
      <span className="absolute inline-flex h-full w-full rounded-full bg-warning animate-agent-ring" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-warning" />
    </span>
  )
}

/**
 * The pill: pulse plus the words.
 *
 * The words are not decoration on the dot. Motion says "something is
 * happening" and amber says "worth a glance", but neither says WHICH of the
 * two things it is, and a reader who has to infer that from a colour will
 * eventually infer wrong. `label` is written by the caller because the count
 * differs by surface — a single row is "In progress", a step carrying three
 * open checks should say three.
 */
export function InProgressTag({
  label = "In progress",
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <span
      className={cn(
        // `warning-foreground` is the dark ink, not the amber itself: amber on
        // a light pill is around 3:1 and this is small text.
        "inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-foreground",
        className,
      )}
    >
      <PulseDot />
      {label}
    </span>
  )
}
