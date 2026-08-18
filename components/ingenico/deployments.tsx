"use client"

import { useMemo, useState } from "react"
import { ChevronRight, Building2 } from "lucide-react"
import { stepById, type Merchant } from "@/lib/acquirer-data"
import { ALL_JOURNEYS, estateRows, ingenicoRole, laneOf } from "@/lib/estate"
import { useDecisions } from "@/components/acquirer/decisions-provider"
import { cn } from "@/lib/utils"

export function Deployments({ onOpenOrder }: { onOpenOrder: (m: Merchant) => void }) {
  const { decisions } = useDecisions()
  const rows = useMemo(() => estateRows(decisions), [decisions])

  // Acquirers are Ingenico's clients; every order sits under exactly one.
  const books = useMemo(() => {
    const map = new Map<string, typeof rows>()
    for (const r of rows) {
      const list = map.get(r.acquirer)
      if (list) list.push(r)
      else map.set(r.acquirer, [r])
    }
    return [...map.entries()]
      .map(([name, list]) => ({
        name,
        orders: list,
        onUs: list.filter((r) => laneOf(r) === "ingenico").length,
        breached: list.filter((r) => r.breached).length,
      }))
      .sort((a, b) => b.breached - a.breached || b.orders.length - a.orders.length)
  }, [rows])

  const [open, setOpen] = useState<string>(books[0]?.name ?? "")
  const current = books.find((b) => b.name === open) ?? books[0]

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Deployments
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Orders by acquirer
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {ALL_JOURNEYS.length} orders in flight across {books.length} acquirers. Pick a client to
          see their orders, then open one to follow its journey.
        </p>
      </header>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {books.map((b) => {
          const on = b.name === open
          return (
            <button
              key={b.name}
              onClick={() => setOpen(b.name)}
              aria-pressed={on}
              className={cn(
                "glass glass-hover rounded-2xl p-4 text-left transition-all",
                on && "ring-2 ring-inset ring-primary",
              )}
            >
              <span className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="truncate text-sm font-semibold text-foreground">{b.name}</span>
              </span>
              <span className="mt-3 flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {b.orders.length}
                </span>
                <span className="text-xs text-muted-foreground">
                  order{b.orders.length === 1 ? "" : "s"}
                </span>
              </span>
              {/* "0 with us" is a real state — every order sitting with the
                  acquirer or the merchant — not an empty figure, so it is
                  worded rather than printed as a bare zero. */}
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {b.onUs === 0 ? "Nothing waiting on us" : `${b.onUs} with us`}
                {b.breached > 0 && (
                  <span className="font-medium text-destructive"> · {b.breached} past target</span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <section className="glass rounded-2xl">
        <div className="border-b border-border/60 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-foreground">{current.name}</h2>
          <p className="text-xs text-muted-foreground">
            {current.orders.length} orders. Ordered by what is waiting on us.
          </p>
        </div>

        <ul className="divide-y divide-border/60">
          {[...current.orders]
            .sort(
              (a, b) =>
                Number(b.breached) - Number(a.breached) ||
                Number(laneOf(b) === "ingenico") - Number(laneOf(a) === "ingenico"),
            )
            .map((r) => {
              const step = stepById(r.merchant.currentStep)
              const role = ingenicoRole(r.merchant.currentStep)
              const ours = laneOf(r) === "ingenico"
              return (
                <li key={r.merchant.id}>
                  <button
                    onClick={() => onOpenOrder(r.merchant)}
                    className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-secondary/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {r.merchant.name}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {r.merchant.location} · {r.merchant.terminals}
                      </span>
                    </span>

                    <span className="hidden w-56 shrink-0 sm:block">
                      <span className="block text-[11px] text-muted-foreground">
                        Step {step.id} of 9
                      </span>
                      <span className="block truncate text-[13px] text-foreground">{step.name}</span>
                      <span className="mt-1 flex gap-0.5" aria-hidden>
                        {Array.from({ length: 9 }, (_, i) => (
                          <span
                            key={i}
                            className={cn(
                              "h-1 flex-1 rounded-full",
                              i + 1 < step.id
                                ? "bg-primary/50"
                                : i + 1 === step.id
                                  ? "bg-primary"
                                  : "bg-border",
                            )}
                          />
                        ))}
                      </span>
                    </span>

                    <span className="w-28 shrink-0 text-right">
                      {/* Whether the order is ours to move matters more than its
                          status label, which describes the onboarding rather
                          than our part in it. */}
                      <span
                        className={cn(
                          "text-[11px] font-medium",
                          r.breached
                            ? "text-destructive"
                            : ours
                              ? "text-foreground"
                              : "text-muted-foreground",
                        )}
                      >
                        {ours ? (r.breached ? "Late with us" : "With us") : "Waiting elsewhere"}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {role === "inbound"
                          ? "reported to us"
                          : role === "field"
                            ? "on site"
                            : `${r.daysInStep}d in step`}
                      </span>
                    </span>

                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              )
            })}
        </ul>
      </section>
    </main>
  )
}
