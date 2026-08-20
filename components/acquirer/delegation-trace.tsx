import { ArrowRight, ArrowUpRight, Check, Plug } from "lucide-react"

import type { Delegation } from "@/lib/acquirer-data"
import { PulseDot } from "@/components/acquirer/in-progress-tag"
import { cn } from "@/lib/utils"

/**
 * Where the round trip has got to.
 *
 * DERIVED by the caller from the task's own state and its outstanding checks —
 * never stored on the Delegation, which describes the arrangement and not this
 * file's progress through it. A second copy of "is it back yet" is how a badge
 * comes to disagree with the panel under it.
 */
export type Beat = "idle" | "sent" | "returned"

/** Ownership, in the acquirer's words rather than ours. */
const OWNER_LABEL: Record<Delegation["runsOn"], string> = {
  acquirer: "Your system",
  ingenico: "Ingenico",
  external: "External",
}

/** The node on the agent's own spine. Marker plus one line of what it did. */
function AgentLeg({
  state,
  title,
  detail,
}: {
  state: "done" | "pending"
  title: string
  detail: string
}) {
  return (
    <li className={cn("relative flex gap-3", state === "pending" && "opacity-60")}>
      <span className="relative z-10 mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-card">
        {state === "done" ? (
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary">
            <Check className="h-2.5 w-2.5 text-primary-foreground" aria-hidden />
          </span>
        ) : (
          // Hollow, not absent. An empty slot reads as a rendering fault; an
          // outline reads as a leg that has not happened yet.
          <span
            className="h-2.5 w-2.5 rounded-full border-[1.5px] border-muted-foreground/45"
            aria-hidden
          />
        )}
      </span>
      <span className="min-w-0 pb-3">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-primary">
          Agent
        </span>
        <span className="block text-[13px] font-semibold leading-snug text-foreground">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
          {detail}
        </span>
      </span>
    </li>
  )
}

/**
 * THE HANDOFF STRIP — the agent prepares, another system decides, the agent
 * reads the answer back.
 *
 * Why this exists: KYC, pricing and underwriting were rendering exactly like
 * the tasks the agent performs itself, which left the screen asserting that
 * Ingenico's agent screens sanctions and sets credit limits. It does neither.
 * The three legs are the correction, and the outer two are not filler — the
 * preparation and the read-back ARE the agent's contribution, and showing only
 * the middle would swing the claim too far the other way.
 *
 * The middle leg is the only one that names a system, because it is the only
 * one where the reader's next question is "run by whom?".
 */
export function DelegationTrace({
  delegate,
  beat,
  className,
}: {
  delegate: Delegation
  beat: Beat
  className?: string
}) {
  const sent = beat !== "idle"
  const back = beat === "returned"

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {delegate.capability}
        </span>
        {/* States the claim in words as well as in layout. Someone scanning
            will read one line, and it should be the one that says the agent
            did not decide this. */}
        <span className="text-[11px] leading-relaxed text-muted-foreground">
          runs outside the agent
        </span>
      </div>

      {/* THE EXCURSION. The agent's own legs sit on a spine at the left; the
          delegated one is INDENTED off it, so the work is drawn leaving the
          agent and coming back. Three equal boxes in a row said "three steps
          happened" and left which of them was ours to be read off a colour —
          the indent says it in the layout, before any label is read. */}
      <ol className="relative">
        {/* The spine. Stops short at both ends so it reads as connecting the
            nodes rather than running off the panel. */}
        <span
          aria-hidden
          className="absolute bottom-2 left-[6.5px] top-3 w-px bg-gradient-to-b from-primary/40 via-border to-primary/40"
        />

        <AgentLeg
          state={sent ? "done" : "pending"}
          title={sent ? "Prepared the request" : "Prepares the request"}
          detail={delegate.prepares}
        />

        <li className={cn("relative ml-[6.5px] pb-3 pl-5", !sent && "opacity-60")}>
          {/* The elbow out to the other party — a real corner, drawn with two
              borders, so the departure from the spine is visible and not
              implied by whitespace. */}
          <span
            aria-hidden
            className="absolute -top-1 left-0 h-4 w-4 rounded-bl-lg border-b border-l border-border"
          />
          <div
            className={cn(
              "rounded-lg border border-dashed px-3 py-2.5",
              // Amber only while it is genuinely out. Otherwise neutral: the
              // party is external whether or not anyone is waiting, and
              // colouring the arrangement would make "not ours" look like a
              // problem.
              sent && !back ? "border-warning/50 bg-warning/[0.07]" : "border-border bg-secondary/60",
            )}
          >
            <span className="flex items-center gap-1.5">
              <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {OWNER_LABEL[delegate.runsOn]}
              </span>
            </span>
            <span className="mt-0.5 block text-[13px] font-semibold leading-snug text-foreground">
              {delegate.system}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-[11px] leading-relaxed">
              {back ? (
                <Check className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              ) : sent ? (
                <PulseDot />
              ) : (
                <span
                  className="h-2 w-2 shrink-0 rounded-full border border-muted-foreground/45"
                  aria-hidden
                />
              )}
              <span className={cn(sent && !back ? "text-warning-foreground" : "text-muted-foreground")}>
                {back
                  ? "Returned its result"
                  : sent
                    ? "Out with them now — nothing is needed from you"
                    : "Not called yet"}
              </span>
            </span>
          </div>
        </li>

        <AgentLeg
          state={back ? "done" : "pending"}
          title={back ? "Read the answer back" : "Reads the answer back"}
          detail={delegate.reads}
        />
      </ol>

      {/* The upsell, in context and only where a substitution is actually
          possible. `swap` is a required field on the Ingenico branch, so this
          cannot go missing on a capability we are serving — an acquirer must
          never see our tool presented as the only way to run this. Nothing
          renders for their own systems: there is nothing to sell someone who
          already owns it. */}
      {delegate.runsOn === "ingenico" && (
        <p className="mt-2 flex gap-2 rounded-lg border border-border/70 bg-secondary/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold text-foreground">Optional. </span>
            {delegate.swap}
          </span>
        </p>
      )}
    </div>
  )
}

/**
 * The scannable version, for a task row in the list.
 *
 * Carries ownership and the beat but NOT the three legs: the list answers
 * "which of these does the agent not do?" and the panel answers "what happened
 * in the round trip?". Repeating the full strip per row would bury the two
 * tasks on Underwriting that carry no handoff at all, and those are the
 * comparison that makes the marked ones mean anything.
 */
export function DelegationChip({ delegate, beat }: { delegate: Delegation; beat: Beat }) {
  return (
    <span className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed border-border bg-secondary/50 px-2 py-0.5 text-[11px] text-muted-foreground">
      {beat === "sent" ? (
        <PulseDot />
      ) : (
        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/70" aria-hidden />
      )}
      <span className="truncate">
        <span className="font-medium text-foreground">{delegate.system}</span>
        <span className="text-muted-foreground"> · {OWNER_LABEL[delegate.runsOn].toLowerCase()}</span>
      </span>
    </span>
  )
}
