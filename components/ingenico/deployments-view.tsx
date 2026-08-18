"use client"

import { useMemo } from "react"
import { CheckCircle2, ChevronRight, Send, ShieldAlert } from "lucide-react"
import { estateRows, laneOf, type EstateRow } from "@/lib/estate"
import { stepById, type Merchant } from "@/lib/acquirer-data"
import { useDecisions } from "@/components/acquirer/decisions-provider"
import { cn } from "@/lib/utils"

export type Releases = Record<string, string>

/** What Ingenico is actually releasing at each owned step. Named per step,
 *  because "approve" on its own would not tell anyone what they just took
 *  responsibility for. */
const RELEASE: Record<number, { what: string; commits: string }> = {
  3: { what: "Release the order to the depot", commits: "Commits the stock and starts the pick." },
  5: { what: "Release the configuration", commits: "Locks the profile that will be written to every unit." },
  6: { what: "Accept the test results", commits: "Confirms the pack passed and the build may ship." },
  7: { what: "Release to despatch", commits: "Hands the shipment to the carrier. Cannot be recalled." },
}

export function pendingReleases(rows: EstateRow[], releases: Releases): EstateRow[] {
  return rows.filter(
    (r) => laneOf(r) === "ingenico" && RELEASE[r.merchant.currentStep] && !releases[r.merchant.id],
  )
}

export function DeploymentsView({
  releases,
  onRelease,
  onOpen,
}: {
  releases: Releases
  onRelease: (id: string) => void
  onOpen: (m: Merchant) => void
}) {
  const { decisions } = useDecisions()
  const rows = useMemo(() => estateRows(decisions), [decisions])

  const pending = pendingReleases(rows, releases)
  const released = rows.filter((r) => releases[r.merchant.id])
  // Journeys Ingenico is waiting on someone else for. Chasing is a real action
  // available here; deciding is not.
  const blocked = rows.filter((r) => laneOf(r) === "acquirer" || laneOf(r) === "merchant")

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          Deployment &amp; Operations
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Deployments
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Releases that are ours to make — stock, configuration, certification,
          despatch. Regulated decisions are not on this page; they belong to the
          acquirer and appear below only so they can be chased.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-[13px] font-semibold text-foreground">
          Ready to release
          <span className="ml-2 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
            {pending.length}
          </span>
        </h2>
        {pending.length === 0 ? (
          <p className="glass rounded-2xl px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing waiting on a release. {blocked.length} journeys are parked
            with someone else.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pending.map((r) => {
              const rel = RELEASE[r.merchant.currentStep]
              return (
                <li key={r.merchant.id} className="glass rounded-2xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        onClick={() => onOpen(r.merchant)}
                        className="text-left text-[13px] font-semibold text-foreground hover:underline"
                      >
                        {r.merchant.name}
                      </button>
                      <p className="text-[11px] text-muted-foreground">
                        {r.acquirer} · step {r.merchant.currentStep}{" "}
                        {stepById(r.merchant.currentStep).name} · {r.daysInStep}d in step
                        {r.breached && r.slaDays !== null && (
                          <span className="ml-1 font-medium text-destructive">
                            past {r.slaDays}d target
                          </span>
                        )}
                      </p>
                      <p className="mt-1.5 text-xs text-foreground">{rel.what}</p>
                      <p className="text-[11px] text-muted-foreground">{rel.commits}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => onOpen(r.merchant)}
                        className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        Open workspace
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onRelease(r.merchant.id)}
                        className="rounded-full bg-primary px-3.5 py-1.5 text-[12px] font-medium text-primary-foreground glow-soft transition-opacity hover:opacity-90"
                      >
                        Release
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {released.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-[13px] font-semibold text-foreground">Released</h2>
          <ul className="flex flex-col gap-2">
            {released.map((r) => (
              <li
                key={r.merchant.id}
                className="glass flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                <span className="text-[13px] font-medium text-foreground">
                  {r.merchant.name}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {RELEASE[r.merchant.currentStep]?.what ?? "Released"} · by you ·{" "}
                  {releases[r.merchant.id]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          Waiting on someone else
          <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {blocked.length}
          </span>
        </h2>
        {/* The limit is stated once, as a property of the seat. Leaving these
            rows out entirely would hide work that is genuinely stuck; giving
            them a Release button would imply we can end the wait ourselves. */}
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          These are not ours to decide. A regulated sign-off sits with the
          acquirer under their licence — we can evidence it and chase it, and
          that is the only action offered here.
        </p>
        <ul className="flex flex-col gap-2">
          {blocked.map((r) => (
            <li
              key={r.merchant.id}
              className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
            >
              <div className="min-w-0">
                <button
                  onClick={() => onOpen(r.merchant)}
                  className="text-left text-[13px] font-medium text-foreground hover:underline"
                >
                  {r.merchant.name}
                </button>
                <p className="text-[11px] text-muted-foreground">
                  {laneOf(r) === "acquirer" ? r.acquirer : "The merchant"} · {r.ask}
                </p>
              </div>
              <button
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium",
                  "text-muted-foreground ring-1 ring-border hover:bg-secondary hover:text-foreground",
                )}
              >
                <Send className="h-3.5 w-3.5" />
                Chase
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
