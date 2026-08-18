"use client"

import { useMemo, useState } from "react"
import { Building2, ChevronDown, ChevronRight, Search } from "lucide-react"
import { stepById, type Merchant } from "@/lib/acquirer-data"
import { estateRows, ingenicoRole, laneOf, type EstateRow } from "@/lib/estate"
import { useDecisions } from "@/components/acquirer/decisions-provider"
import { cn } from "@/lib/utils"

const ALL = "__all__"

export function Deployments({ onOpenOrder }: { onOpenOrder: (m: Merchant) => void }) {
  const { decisions } = useDecisions()
  const rows = useMemo(() => estateRows(decisions), [decisions])

  // Acquirers are Ingenico's clients; every order sits under exactly one.
  const books = useMemo(() => {
    const map = new Map<string, EstateRow[]>()
    for (const r of rows) {
      const list = map.get(r.acquirer)
      if (list) list.push(r)
      else map.set(r.acquirer, [r])
    }
    return [...map.entries()]
      .map(([name, orders]) => ({
        name,
        total: orders.length,
        orders: [...orders].sort(
          (a, b) =>
            Number(b.breached) - Number(a.breached) ||
            Number(laneOf(b) === "ingenico") - Number(laneOf(a) === "ingenico") ||
            b.daysInStep - a.daysInStep,
        ),
        onUs: orders.filter((r) => laneOf(r) === "ingenico").length,
        breached: orders.filter((r) => r.breached).length,
      }))
      .sort((a, b) => b.breached - a.breached || b.total - a.total)
  }, [rows])

  const [book, setBook] = useState<string>(ALL)
  const [query, setQuery] = useState("")
  // A Set, not one id: comparing two acquirers side by side is the whole
  // reason to group them, so several can be open at once.
  const [open, setOpen] = useState<Set<string>>(new Set())

  const q = query.trim().toLowerCase()
  const narrowed = q.length > 0

  const visible = books
    .filter((b) => book === ALL || b.name === book)
    .map((b) => ({
      ...b,
      orders: narrowed
        ? b.orders.filter(
            (r) =>
              r.merchant.name.toLowerCase().includes(q) ||
              r.merchant.location.toLowerCase().includes(q),
          )
        : b.orders,
    }))
    .filter((b) => b.orders.length > 0)

  const shown = visible.reduce((a, b) => a + b.orders.length, 0)

  function toggle(name: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-8">
      <header className="mb-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Deployments
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Orders by acquirer
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every acquirer is a client, and their merchants&apos; orders sit underneath. Expand a
          client to see their orders, then open one to follow its journey.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Chip active={book === ALL} onClick={() => setBook(ALL)}>
          All acquirers
          <Count>{rows.length}</Count>
        </Chip>
        {books.map((b) => (
          <Chip key={b.name} active={book === b.name} onClick={() => setBook(b.name)}>
            {b.name}
            <Count tone={b.breached > 0 ? "bad" : undefined}>{b.total}</Count>
          </Chip>
        ))}

        <label className="ml-auto flex items-center gap-2 rounded-full border border-border/70 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a merchant or city"
            spellCheck={false}
            aria-label="Find a merchant or city"
            className="w-44 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="glass rounded-2xl px-5 py-10 text-center text-sm text-muted-foreground">
          No merchant matches “{query}”
          {book !== ALL && <> at {book}</>}.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((b) => {
            // A search that hides most of a group should not leave the group
            // collapsed — the matches are the reason the group is still here.
            const expanded = open.has(b.name) || narrowed || book === b.name
            return (
              <section key={b.name} className="glass overflow-hidden rounded-2xl">
                <button
                  onClick={() => toggle(b.name)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-secondary/40"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{b.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {/* When filtered, the header states the count actually
                          listed below it, never the unfiltered total. */}
                      {b.orders.length}
                      {b.orders.length !== b.total && <> of {b.total}</>} order
                      {b.total === 1 ? "" : "s"} ·{" "}
                      {b.onUs === 0 ? "nothing waiting on us" : `${b.onUs} with us`}
                    </span>
                  </span>
                  {b.breached > 0 && (
                    <span className="shrink-0 rounded-full bg-destructive/12 px-2 py-0.5 text-[10.5px] font-semibold text-destructive">
                      {b.breached} past target
                    </span>
                  )}
                </button>

                {expanded && (
                  <ul className="divide-y divide-border/60 border-t border-border/60">
                    {b.orders.map((r) => (
                      <OrderRow
                        key={r.merchant.id}
                        row={r}
                        showBook={book === ALL}
                        onOpen={() => onOpenOrder(r.merchant)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      <p className="mt-4 text-[11px] text-muted-foreground">
        Showing {shown} of {rows.length} orders across {books.length} acquirers.
      </p>
    </main>
  )
}

function OrderRow({
  row,
  showBook,
  onOpen,
}: {
  row: EstateRow
  showBook: boolean
  onOpen: () => void
}) {
  const step = stepById(row.merchant.currentStep)
  const role = ingenicoRole(row.merchant.currentStep)
  const ours = laneOf(row) === "ingenico"

  return (
    <li>
      <button
        onClick={onOpen}
        className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-secondary/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {row.merchant.name}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {/* In the all-acquirers view every merchant names its acquirer, or
                a flat list of shops says nothing about who they belong to. */}
            {showBook && <span className="text-foreground/70">{row.acquirer} · </span>}
            {row.merchant.location} · {row.merchant.terminals}
          </span>
        </span>

        <span className="hidden w-56 shrink-0 sm:block">
          <span className="block text-[11px] text-muted-foreground">Step {step.id} of 9</span>
          <span className="block truncate text-[13px] text-foreground">{step.name}</span>
          <span className="mt-1 flex gap-0.5" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  i + 1 < step.id ? "bg-primary/50" : i + 1 === step.id ? "bg-primary" : "bg-border",
                )}
              />
            ))}
          </span>
        </span>

        <span className="w-28 shrink-0 text-right">
          <span
            className={cn(
              "text-[11px] font-medium",
              row.breached ? "text-destructive" : ours ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {ours ? (row.breached ? "Late with us" : "With us") : "Waiting elsewhere"}
          </span>
          <span className="block text-[10px] text-muted-foreground">
            {role === "inbound"
              ? "reported to us"
              : role === "field"
                ? "on site"
                : `${row.daysInStep}d in step`}
          </span>
        </span>

        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors",
        active
          ? "border-primary/50 bg-primary/10 font-medium text-foreground"
          : "border-border/70 text-muted-foreground hover:bg-secondary/60",
      )}
    >
      {children}
    </button>
  )
}

function Count({ children, tone }: { children: React.ReactNode; tone?: "bad" }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
        tone === "bad" ? "bg-destructive/12 text-destructive" : "bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}
