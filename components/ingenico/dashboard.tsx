"use client"

import { useMemo } from "react"
import { ArrowRight, PackageCheck, Radio, TriangleAlert } from "lucide-react"
import { MERCHANTS, stepById, type Merchant } from "@/lib/acquirer-data"
import { ALL_JOURNEYS, acquirerOf, estateRows, laneOf } from "@/lib/estate"
import { availabilityPct, fleetDevices, fleetSummary, licenceLines } from "@/lib/devices"
import { sitesFrom } from "@/lib/geo"
import { useDecisions } from "@/components/acquirer/decisions-provider"
import { HealthDot } from "@/components/ingenico/estate-map"
import type { IngenicoScreen } from "@/lib/nav"
import { cn } from "@/lib/utils"

export function Dashboard({
  onGo,
  onOpenOrder,
}: {
  onGo: (s: IngenicoScreen) => void
  onOpenOrder: (m: Merchant) => void
}) {
  const { decisions } = useDecisions()
  const rows = useMemo(() => estateRows(decisions), [decisions])
  const devices = useMemo(() => fleetDevices(ALL_JOURNEYS, acquirerOf), [])
  const licences = useMemo(() => MERCHANTS.flatMap(licenceLines).reduce((n, l) => n + l.qty, 0), [])

  const summary = fleetSummary(devices, licences)
  const avail = availabilityPct(summary)
  const sites = useMemo(() => sitesFrom(devices), [devices])
  const failingSites = sites.filter((s) => s.health === "failing")
  const faultySites = sites.filter((s) => s.fault)

  const onUs = rows.filter((r) => laneOf(r) === "ingenico")
  const late = onUs.filter((r) => r.breached)

  const books = useMemo(() => {
    const names = [...new Set(rows.map((r) => r.acquirer))]
    return names
      .map((name) => {
        const orders = rows.filter((r) => r.acquirer === name)
        const dev = devices.filter((d) => d.acquirer === name)
        const bad = sites.filter((s) => s.acquirer === name && s.health === "failing").length
        return {
          name,
          orders: orders.length,
          onUs: orders.filter((r) => laneOf(r) === "ingenico").length,
          late: orders.filter((r) => r.breached).length,
          devices: dev.length,
          failingSites: bad,
        }
      })
      .sort((a, b) => b.late - a.late || b.failingSites - a.failingSites)
  }, [rows, devices, sites])

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Dashboard
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Deployment and operations
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {rows.length} orders in flight and {devices.length} terminals in the field, across{" "}
          {books.length} acquirers.
        </p>
      </header>

      {/* The two things that can be wrong right now, stated before anything
          else. Both are counts of named records, not scores. */}
      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <AttentionCard
          tone={late.length ? "bad" : "calm"}
          icon={PackageCheck}
          title={
            late.length
              ? `${late.length} order${late.length === 1 ? "" : "s"} past our target`
              : "No order is past our target"
          }
          body={
            late.length
              ? late
                  .slice(0, 3)
                  .map((r) => `${r.merchant.name} — ${stepById(r.merchant.currentStep).name}, ${r.daysInStep}d`)
                  .join(" · ")
              : `${onUs.length} order${onUs.length === 1 ? " is" : "s are"} with us and inside their service level.`
          }
          cta="Open deployments"
          onClick={() => onGo("deploy")}
        />
        <AttentionCard
          tone={failingSites.length ? "bad" : "calm"}
          icon={TriangleAlert}
          title={
            failingSites.length
              ? `${failingSites.length} site${failingSites.length === 1 ? "" : "s"} reporting an outage`
              : "No site is reporting an outage"
          }
          body={
            failingSites.length
              ? failingSites
                  .slice(0, 3)
                  .map((s) => `${s.merchant} (${s.city}) — ${s.fault}`)
                  .join(" · ")
              : avail === null
                ? "No terminal has been activated yet, so there is nothing to report on."
                : `${summary.online} of ${summary.activated} activated terminals are online.`
          }
          cta="Open estate map"
          onClick={() => onGo("estate")}
        />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders with us" value={String(onUs.length)} note={`of ${rows.length} in flight`} />
        <Stat
          label="Waiting elsewhere"
          value={String(rows.length - onUs.length)}
          note="acquirer, merchant, or done"
        />
        <Stat
          label="Fleet available"
          value={avail === null ? "—" : `${avail}%`}
          note={
            avail === null
              ? "Nothing activated yet"
              : `${summary.online} of ${summary.activated} activated`
          }
          tone={avail !== null && avail < 95 ? "warn" : "plain"}
        />
        <Stat
          label="Awaiting activation"
          value={String(summary.notActivated)}
          note="shipped, never switched on"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section className="glass rounded-2xl">
          <div className="border-b border-border/60 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-foreground">Acquirers</h2>
            <p className="text-xs text-muted-foreground">
              Our clients. Each carries its own shops and terminals.
            </p>
          </div>
          <ul className="divide-y divide-border/60">
            {books.map((b) => (
              <li key={b.name}>
                <button
                  onClick={() => onGo("deploy")}
                  className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-secondary/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {b.name}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {b.orders} orders · {b.devices} terminals
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[13px] tabular-nums text-foreground">
                      {b.onUs} with us
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {b.late === 0 && b.failingSites === 0 ? (
                        "nothing overdue"
                      ) : (
                        <span className="font-medium text-destructive">
                          {[
                            b.late ? `${b.late} late` : null,
                            b.failingSites ? `${b.failingSites} site down` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="glass rounded-2xl">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Next with us</h2>
              <p className="text-xs text-muted-foreground">
                Orders we can move today, longest waiting first.
              </p>
            </div>
            <Radio className="h-4 w-4 text-muted-foreground" />
          </div>
          {onUs.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              Nothing is sitting with us. Every order in flight is waiting on an acquirer, a
              merchant, or is already live.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {[...onUs]
                .sort((a, b) => Number(b.breached) - Number(a.breached) || b.daysInStep - a.daysInStep)
                .slice(0, 6)
                .map((r) => (
                  <li key={r.merchant.id}>
                    <button
                      onClick={() => onOpenOrder(r.merchant)}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-secondary/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {r.merchant.name}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {stepById(r.merchant.currentStep).name} · {r.acquirer}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[11px] tabular-nums",
                          r.breached ? "font-medium text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {r.daysInStep}d
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      <section className="glass mt-5 rounded-2xl">
        <div className="border-b border-border/60 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-foreground">Sites needing attention</h2>
          {/* This list is a WIDER population than the outage card above: it
              includes degraded sites, which are faulty but not down. Without
              naming both counts the two numbers read as a contradiction. */}
          <p className="text-xs text-muted-foreground">
            {faultySites.length} sites with a fault — {failingSites.length} offline,{" "}
            {faultySites.length - failingSites.length} degraded.
          </p>
        </div>
        {faultySites.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No site is reporting a fault.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {faultySites
              .slice(0, 6)
              .map((s) => (
                <li key={`${s.merchant}-${s.city}`}>
                  <button
                    onClick={() => onGo("estate")}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-secondary/40"
                  >
                    <HealthDot health={s.health} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {s.merchant}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {s.city} · {s.acquirer}
                      </span>
                    </span>
                    {/* Degraded is not an outage, so it must not borrow the
                        outage colour — red here is reserved for down. */}
                    <span
                      className={cn(
                        "shrink-0 text-[11px] font-medium",
                        s.health === "failing" ? "text-destructive" : "text-warning",
                      )}
                    >
                      {s.fault}
                    </span>
                  </button>
                </li>
              ))}
            {faultySites.length > 6 && (
              <li className="px-5 py-2.5 text-[11px] text-muted-foreground">
                Showing 6 of {faultySites.length}. Open the estate map for the rest.
              </li>
            )}
          </ul>
        )}
      </section>
    </main>
  )
}

function AttentionCard({
  tone,
  icon: Icon,
  title,
  body,
  cta,
  onClick,
}: {
  tone: "bad" | "calm"
  icon: typeof PackageCheck
  title: string
  body: string
  cta: string
  onClick: () => void
}) {
  return (
    <div
      className={cn(
        "glass rounded-2xl p-5",
        tone === "bad" && "ring-1 ring-inset ring-destructive/30",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
            tone === "bad" ? "bg-destructive/12 text-destructive" : "bg-secondary text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            className={cn(
              "text-sm font-semibold",
              tone === "bad" ? "text-destructive" : "text-foreground",
            )}
          >
            {title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
          <button
            onClick={onClick}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            {cta}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string
  value: string
  note: string
  tone?: "plain" | "warn"
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums",
          tone === "warn" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
    </div>
  )
}
