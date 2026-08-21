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
  MERCHANTS,
  PIPELINE,
  portfolioKpis,
  portfolioOrder,
  statusTone,
  stepById,
  type Merchant,
} from "@/lib/acquirer-data"
import { pendingCheckSteps as pendingChecks } from "@/lib/artifacts"
import { PulseDot } from "@/components/acquirer/in-progress-tag"
import { applyDecisions } from "@/lib/decisions"
import { useDecisions } from "@/components/acquirer/decisions-provider"
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

function MiniTrack({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {PIPELINE.map((s) => (
        <span
          key={s.id}
          className={cn(
            "h-1.5 w-3.5 rounded-full",
            s.id < current
              ? "bg-primary"
              : s.id === current
                ? "bg-primary/60"
                : "bg-border",
          )}
        />
      ))}
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

  // Every figure and badge on this screen now comes off one list whose statuses
  // reflect the decisions actually taken. Previously the KPI, the filter and
  // the row badges each read the frozen fixture, so a merchant you had just
  // signed off went on being counted and labelled as awaiting you.
  const merchants = useMemo(
    () => portfolioOrder(applyDecisions(MERCHANTS, decisions)),
    [decisions],
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
                      <MiniTrack current={m.currentStep} />
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
