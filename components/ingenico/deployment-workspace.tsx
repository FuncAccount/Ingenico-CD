"use client"

import { useState } from "react"
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  Package,
  Truck,
  TriangleAlert,
  XCircle,
  Smartphone,
} from "lucide-react"
import {
  configProfile,
  deliveryOptions,
  distanceLabel,
  hardwareLines,
  licenceLines,
  sourcingPlan,
  testPack,
  MODELS,
  type LinePlan,
  type SourceCandidate,
} from "@/lib/devices"
import { defaultAcceptance, liveSchemeLabel } from "@/lib/scheme-acceptance"
import type { Merchant } from "@/lib/acquirer-data"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------ 3. Order */

export function OrderPane({ merchant }: { merchant: Merchant }) {
  const plans = sourcingPlan(merchant)
  const licences = licenceLines(merchant)

  return (
    <div className="flex flex-col gap-4">
      <Intro
        title="Source the hardware"
        body="The nearest depot and the depot that can cover the order are often not the same site. Both are shown, with the conflict named — picking on distance alone is what splits a shipment."
      />
      {plans.map((plan) => (
        <LinePlanCard key={plan.line.model} plan={plan} />
      ))}

      {licences.length > 0 && (
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-[13px] font-semibold text-foreground">
              {licences.map((l) => `${l.qty}× ${l.model}`).join(", ")}
            </h4>
          </div>
          {/* A software product has no depot, no carrier and no serial. Listing
              it beside the shipment would put a delivery date on something that
              is never delivered. */}
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Software on the merchant&apos;s own phone. Nothing to source or ship —
            provisioned at go-live, and it will not appear in the fleet as
            hardware.
          </p>
        </div>
      )}
    </div>
  )
}

function LinePlanCard({ plan }: { plan: LinePlan }) {
  const recommended = plan.singleSite
  const [pick, setPick] = useState<string | null>(recommended?.warehouse.id ?? null)
  const chosen = plan.candidates.find((c) => c.warehouse.id === pick) ?? null

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-foreground">
          {plan.line.qty}× {plan.line.model}
        </h4>
        <span className="text-[11px] text-muted-foreground">
          {MODELS[plan.line.model].form}
        </span>
      </div>

      {plan.shortfall > 0 ? (
        <Callout tone="bad">
          No depot holds {plan.line.qty}. The largest single holding is{" "}
          {plan.line.qty - plan.shortfall}, leaving {plan.shortfall} short —
          this needs a split shipment or a production slot, not a depot choice.
        </Callout>
      ) : plan.conflict ? (
        <Callout tone="warn">
          {`${plan.nearest.warehouse.name} is closest — ${plan.nearest.distanceKm < 25 ? "it is in the same city" : `${plan.nearest.distanceKm} km`} — but holds only ${plan.nearest.onHand} of ${plan.line.qty}. ${recommended!.warehouse.name} can cover the whole order from one site, ${recommended!.distanceKm} km out and ${recommended!.transitDays - plan.nearest.transitDays} day${recommended!.transitDays - plan.nearest.transitDays === 1 ? "" : "s"} further.`}
        </Callout>
      ) : (
        <Callout tone="ok">
          {recommended!.warehouse.name} is both the closest depot and holds
          enough to cover the order. No trade-off to make.
        </Callout>
      )}

      <table className="mt-3 w-full">
        <thead>
          <tr className="border-b border-border/60 text-left">
            <ThMini>Depot</ThMini>
            <ThMini right>Distance</ThMini>
            <ThMini right>On hand</ThMini>
            <ThMini right>Covers</ThMini>
            <ThMini right>Transit</ThMini>
          </tr>
        </thead>
        <tbody>
          {plan.candidates.map((c) => (
            <CandidateRow
              key={c.warehouse.id}
              c={c}
              need={plan.line.qty}
              chosen={pick === c.warehouse.id}
              recommended={recommended?.warehouse.id === c.warehouse.id}
              onPick={() => setPick(c.warehouse.id)}
            />
          ))}
        </tbody>
      </table>

      {chosen && chosen.onHand >= plan.line.qty && (
        <DeliveryPicker transitDays={chosen.transitDays} cutoff={chosen.warehouse.cutoff} />
      )}
    </div>
  )
}

function CandidateRow({
  c,
  need,
  chosen,
  recommended,
  onPick,
}: {
  c: SourceCandidate
  need: number
  chosen: boolean
  recommended: boolean
  onPick: () => void
}) {
  const full = c.onHand >= need
  return (
    <tr
      className={cn(
        "border-b border-border/40 last:border-0",
        chosen && "bg-primary/5",
      )}
    >
      <td className="py-2 pr-2">
        <button onClick={onPick} disabled={!full} className="text-left disabled:cursor-not-allowed">
          <span
            className={cn(
              "block text-[12px] font-medium",
              full ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {c.warehouse.name}
            {recommended && (
              <span className="ml-1.5 rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                Recommended
              </span>
            )}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {/* A depot that does not stock a model at all is a different fact
                from one that has run out of it. */}
            {c.stocked ? `Cut-off ${c.warehouse.cutoff}` : `Does not stock this model`}
          </span>
        </button>
      </td>
      <TdMini right>{distanceLabel(c.distanceKm)}</TdMini>
      <TdMini right>{c.stocked ? c.onHand : "—"}</TdMini>
      <td className="py-2 pl-2 text-right">
        <span
          className={cn(
            "text-[12px] tabular-nums",
            full ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {full ? "Full order" : `${c.canCover} of ${need}`}
        </span>
      </td>
      <TdMini right>{c.transitDays}d</TdMini>
    </tr>
  )
}

function DeliveryPicker({ transitDays, cutoff }: { transitDays: number; cutoff: string }) {
  const opts = deliveryOptions(transitDays)
  const [pick, setPick] = useState(opts[0].id)
  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Delivery from this depot
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {opts.map((o) => {
          const on = pick === o.id
          return (
            <button
              key={o.id}
              onClick={() => setPick(o.id)}
              aria-pressed={on}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                on ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-secondary",
              )}
            >
              <Truck className={cn("h-4 w-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-foreground">
                  {o.carrier} · {o.service}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {o.days} working day{o.days === 1 ? "" : "s"} after despatch
                  {o.note ? ` · ${o.note}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-[12px] font-medium tabular-nums text-foreground">
                €{o.cost}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Days run from despatch, not from now — an order placed after the{" "}
        {cutoff} cut-off leaves the next working day. Transit is a planning
        figure, not a carrier quote.
      </p>
    </div>
  )
}

/* -------------------------------------------------------- 5. Configure */

export function ConfigPane({ merchant, acquirer }: { merchant: Merchant; acquirer: string }) {
  // Same derivation the acquirer's own config record uses, so the two personas
  // cannot report different schemes as loaded onto the same terminals.
  const items = configProfile(
    merchant,
    acquirer,
    liveSchemeLabel(merchant, defaultAcceptance(merchant)),
  )
  return (
    <div className="flex flex-col gap-4">
      <Intro
        title="Terminal configuration"
        body="Each value carries where it came from. A limit the schemes mandate and a preference the acquirer stated are not the same kind of claim, and only one of them is ours to change."
      />
      <div className="glass rounded-2xl p-4">
        <dl className="flex flex-col gap-2.5">
          {items.map((it) => (
            <div
              key={it.label}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border/40 pb-2.5 last:border-0 last:pb-0"
            >
              <dt className="text-[12px] text-muted-foreground">{it.label}</dt>
              <dd className="flex items-baseline gap-2 text-right">
                <span className="text-[12px] font-medium text-foreground">{it.value}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px]",
                    it.source === "Scheme mandated"
                      ? "bg-secondary text-muted-foreground"
                      : it.source === "From acquirer"
                        ? "bg-secondary text-muted-foreground"
                        : "bg-primary/12 text-primary",
                  )}
                >
                  {it.source}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- 6. Test */

export function TestPane({ merchant }: { merchant: Merchant }) {
  const results = testPack(merchant)
  const done = results.filter((r) => r.state === "pass").length
  const notRun = results.filter((r) => r.state === "not-run").length
  return (
    <div className="flex flex-col gap-4">
      <Intro
        title="Certification test pack"
        body={`${done} of ${results.length} passed.${notRun > 0 ? ` ${notRun} have not run yet — that is not the same as failing.` : ""}`}
      />
      <div className="glass rounded-2xl p-4">
        <ul className="flex flex-col gap-2.5">
          {results.map((r) => (
            <li key={r.name} className="flex items-start gap-2.5">
              <TestIcon state={r.state} />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-foreground">{r.name}</span>
                <span className="block text-[11px] text-muted-foreground">{r.detail}</span>
              </span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {r.state === "not-run" ? "Not run" : r.state === "running" ? "Running" : r.state === "pass" ? "Pass" : "Fail"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function TestIcon({ state }: { state: string }) {
  if (state === "pass") return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
  if (state === "fail") return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
  if (state === "running") return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
  return <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
}

/* ------------------------------------------------------------- 7. Ship */

export function ShipPane({ merchant }: { merchant: Merchant }) {
  const plans = sourcingPlan(merchant)
  const lines = hardwareLines(merchant)
  const units = lines.reduce((n, l) => n + l.qty, 0)
  const site = plans[0]?.singleSite ?? plans[0]?.nearest ?? null
  const shipped = merchant.currentStep > 7

  return (
    <div className="flex flex-col gap-4">
      <Intro
        title="Shipment"
        body={`${units} unit${units === 1 ? "" : "s"} across ${lines.length} line${lines.length === 1 ? "" : "s"}.`}
      />
      <div className="glass rounded-2xl p-4">
        {site ? (
          <dl className="flex flex-col gap-2.5">
            <Pair k="Despatch depot" v={`${site.warehouse.name} · ${site.warehouse.city}`} />
            <Pair k="Lane" v={`${distanceLabel(site.distanceKm)} · ${site.transitDays} day transit`} />
            <Pair
              k="Status"
              v={shipped ? "Despatched, tracking issued" : "Awaiting despatch"}
            />
            {/* A tracking number that does not exist yet must not render as a
                blank field the reader assumes someone forgot to fill in. */}
            <Pair
              k="Tracking"
              v={shipped ? "DHL 4471 8829 03" : "Issued at despatch — not yet raised"}
              muted={!shipped}
            />
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nothing physical on this order — {merchant.name} is software only.
          </p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- shared */

function Pair({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-border/40 pb-2.5 last:border-0 last:pb-0">
      <dt className="text-[12px] text-muted-foreground">{k}</dt>
      <dd className={cn("text-[12px]", muted ? "text-muted-foreground" : "font-medium text-foreground")}>
        {v}
      </dd>
    </div>
  )
}

function Intro({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <Package className="h-4 w-4 text-primary" />
        {title}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

function Callout({ tone, children }: { tone: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mt-2.5 flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] leading-relaxed",
        tone === "ok" && "bg-secondary text-muted-foreground",
        tone === "warn" && "bg-warning/10 text-foreground",
        tone === "bad" && "bg-destructive/10 text-foreground",
      )}
    >
      {tone !== "ok" && <TriangleAlert className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone === "bad" ? "text-destructive" : "text-warning")} />}
      <span>{children}</span>
    </div>
  )
}

function ThMini({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn("pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground", right && "text-right")}>
      {children}
    </th>
  )
}

function TdMini({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td className={cn("py-2 text-[12px] tabular-nums text-muted-foreground", right && "pl-2 text-right")}>
      {children}
    </td>
  )
}
