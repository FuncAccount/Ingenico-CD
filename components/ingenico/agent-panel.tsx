"use client"

import { useEffect, useRef, useState } from "react"
import { Ban, Check, Sparkles, Truck } from "lucide-react"
import type { Merchant, StepId } from "@/lib/acquirer-data"
import { distanceLabel } from "@/lib/devices"
import {
  agentActivity,
  agentTasks,
  chooseRouting,
  sameRouting,
  type Routing,
  type RoutingId,
} from "@/lib/agent-work"
import { cn } from "@/lib/utils"

export function AgentPanel({
  merchant,
  step,
  daysInStep,
}: {
  merchant: Merchant
  step: StepId
  daysInStep: number
}) {
  const activity = agentActivity(merchant, step)
  const tasks = agentTasks(merchant, step, daysInStep)
  const choice = step === 3 ? chooseRouting(merchant) : null

  // Which routing is on display. Starts on the agent's own recommendation;
  // asking for a different objective genuinely re-plans rather than just
  // acknowledging the click.
  const [picked, setPicked] = useState<RoutingId | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [done, setDone] = useState<{ id: string; text: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const shown: Routing | null = choice
    ? (choice.all.find((r) => r.id === picked) ?? choice.recommended)
    : null

  function run(id: string, label: string) {
    if (timer.current) clearTimeout(timer.current)
    setRunning(id)
    setDone(null)
    timer.current = setTimeout(() => {
      setRunning(null)
      if (choice && (id === "cheapest" || id === "fastest")) {
        const target = id === "cheapest" ? "cheapest" : "fastest"
        const next = choice.all.find((r) => r.id === target) ?? choice.recommended
        setPicked(next.id)
        setDone({
          id,
          text: `Plan updated to ${next.label.toLowerCase()} — €${next.cost}, ${next.days} day${next.days === 1 ? "" : "s"}, ${next.shipments} shipment${next.shipments === 1 ? "" : "s"}.`,
        })
      } else {
        // Never claim a change that did not happen: these tasks produce a
        // proposal for a human, not a committed action.
        setDone({ id, text: `${label} drafted. Nothing is committed until you release the step.` })
      }
    }, 1100)
  }

  return (
    <section className={cn("glass edge-lit rounded-2xl", running && "agent-border")}>
      <header className="flex items-start gap-3 border-b border-border/60 px-5 py-3.5">
        <span className="relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
          <span
            className="absolute inset-0 rounded-full bg-primary/15"
            style={{ animation: "agent-pulse 2.4s ease-in-out infinite" }}
          />
          <Sparkles className="relative h-3.5 w-3.5 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{activity.headline}</h2>
          <p className="text-[11px] text-muted-foreground">
            {activity.watching
              ? "The agent cannot act on this step — it can only watch and chase."
              : "Agent work on this step"}{" "}
            · {activity.ranAt}
          </p>
        </div>
      </header>

      <ol className="divide-y divide-border/50">
        {activity.trace.map((t, i) => (
          <li key={i} className="flex gap-3 px-5 py-2.5">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" />
            <div className="min-w-0">
              <p className="text-[12.5px] text-foreground">{t.did}</p>
              <p className="text-[11px] text-muted-foreground">{t.found}</p>
            </div>
          </li>
        ))}
      </ol>

      {choice && shown && <RoutingCompare choice={choice} shown={shown} onPick={setPicked} />}

      <div className="border-t border-border/60 px-5 py-3.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Ask the agent
        </p>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {tasks.map((t) => {
            const isRunning = running === t.id
            const blocked = Boolean(t.blocked)
            return (
              <div key={t.id}>
                <button
                  disabled={blocked || isRunning}
                  onClick={() => run(t.id, t.label)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                    blocked
                      ? "cursor-not-allowed border-dashed border-border/70 opacity-70"
                      : "border-border/70 hover:border-primary/40 hover:bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-[12.5px] font-medium",
                      blocked ? "text-muted-foreground line-through" : "text-foreground",
                    )}
                  >
                    {blocked && <Ban className="h-3 w-3 shrink-0" />}
                    {isRunning ? "Working…" : t.label}
                  </span>
                  {/* Both halves always print. An option that shows only its
                      upside is asking to be clicked without being read. */}
                  <span className="mt-1 block text-[11px] text-muted-foreground">{t.optimises}</span>
                  <span className="mt-0.5 block text-[11px] text-warning">Costs: {t.concedes}</span>
                </button>
                {blocked && (
                  <p className="mt-1 px-1 text-[10.5px] text-muted-foreground">{t.blocked}</p>
                )}
                {done?.id === t.id && (
                  <p
                    className="mt-1 flex items-start gap-1 px-1 text-[10.5px] text-success"
                    style={{ animation: "trace-in 240ms ease-out" }}
                  >
                    <Check className="mt-0.5 h-3 w-3 shrink-0" />
                    {done.text}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function RoutingCompare({
  choice,
  shown,
  onPick,
}: {
  choice: NonNullable<ReturnType<typeof chooseRouting>>
  shown: Routing
  onPick: (id: RoutingId) => void
}) {
  // Two objectives can land on an identical plan. Showing it twice under
  // different names would invent a choice that does not exist — but silently
  // dropping the second name makes the agent look like it skipped an
  // objective, so each surviving card CARRIES the names it answers.
  const distinct: { plan: Routing; answers: string[] }[] = []
  for (const r of choice.all) {
    const hit = distinct.find((d) => sameRouting(d.plan, r))
    if (hit) hit.answers.push(r.label)
    else distinct.push({ plan: r, answers: [r.label] })
  }

  return (
    <div className="border-t border-border/60 px-5 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Routings compared
        </p>
        {/* The agent's recommendation does not change when the user overrides
            it, so once they have chosen otherwise this must be worded as a
            standing recommendation — not as a description of the live plan. */}
        <p className="text-[11px] text-muted-foreground">
          {!choice.against
            ? "Cheapest and fastest are the same plan — nothing is traded away."
            : shown.id === choice.recommended.id
              ? `Agent recommends lowest cost: saves €${choice.savingEur} for ${choice.extraDays} extra day${choice.extraDays === 1 ? "" : "s"}.`
              : `You have overridden the agent, which still recommends lowest cost (saves €${choice.savingEur} for ${choice.extraDays} extra day${choice.extraDays === 1 ? "" : "s"}).`}
        </p>
      </div>

      <div
        className={cn(
          "mt-2.5 grid gap-2",
          distinct.length === 1 ? "sm:grid-cols-1" : distinct.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3",
        )}
      >
        {distinct.map(({ plan: r, answers }) => {
          const on = r.id === shown.id
          return (
            <button
              key={r.id}
              onClick={() => onPick(r.id)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-colors",
                on ? "border-primary/50 bg-primary/5" : "border-border/70 hover:bg-secondary/60",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-foreground">
                  {answers.join(" & ")}
                </span>
                {r.id === choice.recommended.id && (
                  <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-primary">
                    Agent pick
                  </span>
                )}
              </span>
              <span className="mt-1.5 flex items-baseline gap-2 tabular-nums">
                <span className="text-base font-semibold text-foreground">€{r.cost}</span>
                <span className="text-[11px] text-muted-foreground">
                  {r.days}d · {r.shipments} shipment{r.shipments === 1 ? "" : "s"}
                </span>
              </span>
              {r.shortfall > 0 && (
                <span className="mt-1 block text-[10.5px] font-medium text-destructive">
                  {r.shortfall} units unsourced
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-3 rounded-xl bg-secondary/40 px-3 py-2.5">
        <p className="text-[11px] font-medium text-foreground">
          {shown.label} — how it is made up
        </p>
        <ul className="mt-1.5 space-y-1">
          {shown.legs.map((l) => (
            <li key={l.warehouse.id} className="flex items-start gap-2 text-[11px]">
              <Truck className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">
                <span className="text-foreground">{l.warehouse.name}</span> —{" "}
                {l.units.map((u) => `${u.qty}× ${u.model}`).join(", ")} ·{" "}
                {distanceLabel(l.distanceKm)} · {l.service.service}, {l.service.days}d ·{" "}
                <span className="tabular-nums">
                  €{l.service.cost} service + €{l.lineHaul} freight = €{l.total}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {/* The arithmetic is printed so the headline figure can be checked
            against the legs rather than taken on trust. */}
        <p className="mt-2 text-[10.5px] tabular-nums text-muted-foreground">
          {shown.legs.map((l) => `€${l.total}`).join(" + ")} = €{shown.cost} ·{" "}
          {shown.legs.length === 1
            ? `${shown.days} days`
            : `slowest leg ${shown.days} days sets the completion date`}
          . Freight is a planning estimate, not a carrier quote.
        </p>
      </div>
    </div>
  )
}
