"use client"

import { useMemo } from "react"
import {
  ArrowUpRight,
  Clock,
  Plus,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react"
import {
  PIPELINE,
  laneState,
  portfolioKpis,
  portfolioOrder,
  statusTone,
  stepById,
  type Merchant,
  type PipelineStep,
  type StepId,
} from "@/lib/acquirer-data"
import { haltedByMerchant, pendingCheckSteps as pendingChecks } from "@/lib/artifacts"

/** A merchant the book-level map has no entry for. Named rather than an inline
 *  `new Set()`, which reads as a measured "nothing is blocked" — the map is
 *  built from the same list, so a miss is a bug, not a clean result. */
const EMPTY_HALTS: ReadonlySet<StepId> = new Set()
import { useBrandTheme } from "@/components/acquirer/brand-theme-provider"
import { PulseDot } from "@/components/acquirer/in-progress-tag"
import { applyDecisions } from "@/lib/decisions"
import { useDecisions } from "@/components/acquirer/decisions-provider"
import { useBook } from "@/components/acquirer/book-provider"
import { useProgress } from "@/components/acquirer/progress-provider"
import { cn } from "@/lib/utils"

function StepPill({ step }: { step: number }) {
  const s = stepById(step as 1)
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="font-mono text-xs font-semibold text-muted-foreground">
        {s.code}
      </span>
      <span className="text-sm text-foreground">{s.name}</span>
    </span>
  )
}

/* The lanes, derived from PIPELINE by ARRAY POSITION so adding a step to either
   one needs no edit here — and never by id, which is the whole trouble below. */
const FORK_AT = PIPELINE.findIndex((s) => s.lane !== "spine")
const LEAD_STEPS = PIPELINE.slice(0, FORK_AT)
const RISK_STEPS = PIPELINE.filter((s) => s.lane === "risk")
const BUILD_STEPS = PIPELINE.filter((s) => s.lane === "build")
const TAIL_STEPS = PIPELINE.slice(FORK_AT).filter((s) => s.lane === "spine")

function segTone(state: "done" | "active" | "upcoming") {
  return state === "done"
    ? "bg-primary"
    : state === "active"
      ? "bg-primary/60"
      : "bg-border"
}

/**
 * The pipeline forks, so one flat row of pills was the wrong shape — and it was
 * also wrong on the facts, which is the more serious half.
 *
 * It ranked steps with `s.id < current`, but the risk lane runs 10 → 11 → 2.
 * So a merchant sitting at B1 Order rendered KYC and Pricing as never-started
 * while Underwriting came out DONE: an approval nobody had given, sitting after
 * two checks it cannot legally precede. `laneState` has resolved this correctly
 * for every other surface — and its own comment warns against exactly this
 * comparison — so this was the last place still asking the question the old way.
 *
 * CONCURRENCY IS DRAWN AS SHARED HORIZONTAL EXTENT: the two lanes stack over one
 * span rather than running end to end, because occupying the same width is what
 * says "at the same time". Laid side by side they would read as six more
 * sequential steps, which is the diagram we are trying to stop drawing.
 */
function MiniTrack({
  merchant,
  progressed,
  halted,
}: {
  merchant: Merchant
  progressed: ReadonlySet<StepId>
  /* Passed in rather than derived here. This used to call `haltedSteps` itself,
     which was correct but was a SECOND computation of the same judgement — and
     the row's status badge, now derived from the same findings, would have been
     free to disagree with the track beside it. One set, two renderings. */
  halted: ReadonlySet<StepId>
}) {
  const stateOf = (s: PipelineStep) => laneState(merchant, s, progressed, halted)
  const doneIn = (steps: PipelineStep[]) =>
    steps.filter((s) => stateOf(s) === "done").length

  const Trunk = ({ steps }: { steps: PipelineStep[] }) => (
    <>
      {steps.map((s) => (
        <span
          key={s.id}
          className={cn("h-2 w-3.5 rounded-full", segTone(stateOf(s)))}
        />
      ))}
    </>
  )

  return (
    <div
      className="flex items-center gap-1"
      role="img"
      // The picture asserts something the Stage column cannot: that these run
      // together. Left aria-hidden, that claim would reach nobody.
      // A halt is stated, not left to the colour. The segment renders in the
      // "active" tone, which a sighted reader sees as amber-ish progress but
      // which reads to a screen reader as nothing at all — so the one row that
      // is stuck would announce identically to one quietly working.
      aria-label={
        `Risk ${doneIn(RISK_STEPS)} of ${RISK_STEPS.length}, build ${doneIn(
          BUILD_STEPS,
        )} of ${BUILD_STEPS.length}, running in parallel` +
        (halted.size > 0
          ? `. ${halted.size} step${halted.size > 1 ? "s" : ""} held by a finding`
          : "")
      }
    >
      <Trunk steps={LEAD_STEPS} />
      {/* Split and merge ticks. The full diagram draws arches; at 8px the
          honest miniature is a hairline. */}
      <span className="h-2.5 w-px bg-border" />
      <div className="flex w-14 flex-col gap-[2px]">
        {[RISK_STEPS, BUILD_STEPS].map((lane, i) => (
          <div key={i} className="flex gap-[3px]">
            {lane.map((s) => (
              <span
                key={s.id}
                className={cn("h-[3px] flex-1 rounded-full", segTone(stateOf(s)))}
              />
            ))}
          </div>
        ))}
      </div>
      <span className="h-2.5 w-px bg-border" />
      <Trunk steps={TAIL_STEPS} />
    </div>
  )
}

function Kpi({
  icon: Icon,
  label,
  value,
  accent,
  onClick,
  action,
}: {
  icon: typeof Users
  label: string
  value: string | number
  accent?: "warning" | "destructive"
  /** Present only where the figure has somewhere to lead. A tile that counts
   *  something you cannot open stays inert rather than looking clickable. */
  onClick?: () => void
  action?: string
}) {
  // A measurement and a control are different things, so the clickable tile has
  // to SAY it is one — hence the named action line rather than a hover-only
  // affordance discoverable by accident.
  const Tag = onClick ? "button" : "div"
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "flex flex-col gap-3 rounded-2xl glass p-5",
        onClick && "glass-hover cursor-pointer text-left transition-colors",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            accent === "warning"
              ? "bg-warning/15 text-warning"
              : accent === "destructive"
                ? "bg-destructive/12 text-destructive"
                : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="h-4.5 w-4.5" />
        </span>
      </div>
      <div>
        <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
          {value}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
        {action && (
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-warning">
            {action}
            <ArrowUpRight className="h-3 w-3" />
          </span>
        )}
      </div>
    </Tag>
  )
}

export function PortfolioOverview({
  onSubmit,
  onOpenMerchant,
  onOpenSignoff,
  onOpenQueue,
}: {
  onSubmit: () => void
  onOpenMerchant: (m: Merchant) => void
  onOpenSignoff: (m: Merchant) => void
  /** Opens the sign-off queue itself, with no merchant focused. */
  onOpenQueue: () => void
}) {
  const { decisions } = useDecisions()
  const { merchants: book } = useBook()
  const { progressFor, playedFor } = useProgress()

  // Every figure and badge on this screen now comes off one list whose statuses
  // reflect the decisions actually taken. Previously the KPI, the filter and
  // the row badges each read the frozen fixture, so a merchant you had just
  // signed off went on being counted and labelled as awaiting you — and a
  // merchant you had just submitted never appeared at all.
  /* Status is DERIVED from the findings, not read off the fixture. Without this
     a row rendered "On track" while the progress cell immediately to its left
     drew a halt — one row making two contradictory claims about one file, which
     is the summary-versus-detail failure this app exists to prevent.
     Built once for the whole book and passed down, so the badge and the track
     are reading the same set rather than each deriving their own. */
  const { themeFor: themeForBook } = useBrandTheme()
  const halted = useMemo(
    () => haltedByMerchant(book, themeForBook, (m) => playedFor(m.id)),
    [book, themeForBook, playedFor],
  )
  const merchants = useMemo(
    () => portfolioOrder(applyDecisions(book, decisions, halted)),
    [book, decisions, halted],
  )
  const kpis = portfolioKpis(merchants)

  // The book lists the whole book. The "Needs your sign-off" filter that used
  // to sit over this table was a SECOND sign-off queue: same label as the
  // Sign-off screen, different membership (this one re-filters after each
  // decision, so a merchant you had just confirmed vanished from under you,
  // while the queue deliberately holds its list still). Two lists that disagree
  // about who is waiting on you is worse than one list — and only one of them
  // could ever approve or reject. The count is still here; it now LEADS to the
  // one place the work happens instead of re-answering it in place.
  const rows = merchants

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground text-balance">
            Your merchant book
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything onboarding through Ingenico&apos;s agentic pipeline, and
            what needs your call.
          </p>
        </div>
        <button
          onClick={onSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Submit new merchant
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon={Users} label="Merchants live this month" value={kpis.liveThisMonth} />
        <Kpi icon={Clock} label="Avg. time to go-live" value={kpis.avgTimeToGoLive} />
        <Kpi
          icon={ShieldCheck}
          label="Awaiting your sign-off"
          value={kpis.awaitingSignOff}
          accent="warning"
          // Withheld at zero: "Review the queue" pointing at an empty queue is
          // an invitation to work that does not exist.
          onClick={kpis.awaitingSignOff > 0 ? onOpenQueue : undefined}
          action={kpis.awaitingSignOff > 0 ? "Review the queue" : undefined}
        />
        <Kpi
          icon={TriangleAlert}
          label="Exceptions"
          value={kpis.exceptions}
          accent="destructive"
        />
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl glass glass-hover">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            {rows.length} {rows.length === 1 ? "merchant" : "merchants"}
          </h2>
          {/* No filter chips. The row's own action already opens whatever that
              merchant needs, and the count above leads to the queue. */}
          <p className="text-xs text-muted-foreground">
            Every merchant in your book, in pipeline order.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Merchant</th>
                <th className="px-5 py-3 font-medium">Terminals</th>
                <th className="px-5 py-3 font-medium">Current step</th>
                <th className="px-5 py-3 font-medium">Progress</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const tone = statusTone(m.status)
                const needsAction =
                  m.status === "Needs sign-off" || m.status === "Exception"
                return (
                  <tr
                    key={m.id}
                    onClick={() => onOpenMerchant(m)}
                    className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-secondary/50"
                  >
                    <td className="px-5 py-4">
                      <p className="font-medium text-foreground">{m.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.sector} · {m.location}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm text-foreground">{m.terminals}</p>
                    </td>
                    <td className="px-5 py-4">
                      <StepPill step={m.currentStep} />
                      {/* NAMES ITS OWN STEP, because it is usually not the one
                          above it: the file sits at Install while the open
                          check belongs to KYC, back on the risk lane. Without
                          the name this reads as "Install is in progress" and
                          sends anyone chasing it to the wrong provider.

                          Placed here rather than in the Status column on
                          purpose — the file really is On track, and overwriting
                          a health verdict with a wait would report a problem
                          that does not exist. */}
                      {pendingChecks(m).map(({ step, count }) => (
                        <span
                          key={step}
                          className="mt-1.5 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground"
                        >
                          <PulseDot />
                          <span>
                            {stepById(step).name} · {count} in progress
                          </span>
                        </span>
                      ))}
                    </td>
                    <td className="px-5 py-4">
                      {/* The session's own progress, so a row agrees with the
                          journey rather than judging the file against the bare
                          fixture. */}
                      <MiniTrack
                        merchant={m}
                        progressed={progressFor(m.id)}
                        halted={halted.get(m.id) ?? EMPTY_HALTS}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                          tone.bg,
                          tone.text,
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                        {m.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {needsAction ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (m.status === "Needs sign-off") onOpenSignoff(m)
                            else onOpenMerchant(m)
                          }}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                            m.status === "Needs sign-off"
                              ? "bg-warning/15 text-warning hover:bg-warning/25"
                              : "bg-destructive/12 text-destructive hover:bg-destructive/20",
                          )}
                        >
                          {m.status === "Needs sign-off" ? "Review" : "Resolve"}
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                          Watching
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
