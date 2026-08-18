"use client"

import { useMemo, useState } from "react"
import { ChevronRight, TriangleAlert } from "lucide-react"
import {
  automationCensus,
  estateRows,
  estateSummary,
  LANES,
  laneOf,
  type EstateRow,
  type Lane,
} from "@/lib/estate"
import { stepById, type Merchant } from "@/lib/acquirer-data"
import { useDecisions } from "@/components/acquirer/decisions-provider"
import { cn } from "@/lib/utils"

const ALL = "All"

export function EstateView({ onOpen }: { onOpen: (m: Merchant) => void }) {
  const { decisions } = useDecisions()
  // Reads the same decisions store the acquirer writes to, so signing off over
  // there clears the row from the "on the acquirer" lane here. The two seats
  // are one system, not two fixtures that happen to look alike.
  const rows = useMemo(() => estateRows(decisions), [decisions])
  const [book, setBook] = useState<string>(ALL)
  const [lane, setLane] = useState<Lane | typeof ALL>(ALL)

  const summary = estateSummary(rows)
  const census = automationCensus(rows)
  const books = useMemo(
    () => [ALL, ...Array.from(new Set(rows.map((r) => r.acquirer))).sort()],
    [rows],
  )

  const shown = rows.filter(
    (r) => (book === ALL || r.acquirer === book) && (lane === ALL || laneOf(r) === lane),
  )
  const breaches = shown.filter((r) => r.breached).length

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          Deployment &amp; Operations
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Estate
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every onboarding Ingenico is running, across {summary.acquirers}{" "}
          acquirers. The book is a column here, not a folder — an SLA breach
          matters the same whoever owns the merchant.
        </p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Journeys in flight" value={String(summary.journeys)} sub={`across ${summary.acquirers} acquirers`} />
        <Stat
          label="Waiting on us"
          value={String(summary.onUs)}
          sub={summary.breaches > 0 ? `${summary.breaches} past target` : "all inside target"}
          tone={summary.breaches > 0 ? "warn" : undefined}
        />
        <Stat
          label="Waiting on someone else"
          value={String(summary.elsewhere)}
          sub="acquirer or merchant — not ours to action"
        />
        <Stat
          label="Steps cleared without a person"
          value={`${census.unattended} of ${census.stepsCleared}`}
          sub={census.basis}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Filter label="Book" value={book} options={books} onChange={setBook} />
        <Filter
          label="Waiting on"
          value={lane}
          options={[ALL, ...LANES.map((l) => l.id)]}
          onChange={(v) => setLane(v as Lane | typeof ALL)}
          render={(v) => (v === ALL ? ALL : LANES.find((l) => l.id === v)!.label)}
        />
      </div>

      <div className="glass overflow-hidden rounded-2xl">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/60 text-left">
              <Th>Merchant</Th>
              <Th>Book</Th>
              <Th>Step</Th>
              <Th>Waiting on</Th>
              <Th right>Age</Th>
              <Th right> </Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <Row key={r.merchant.id} row={r} onOpen={() => onOpen(r.merchant)} />
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No journeys match this filter. {rows.length} in the estate overall.
          </p>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Showing {shown.length} of {rows.length} journeys
        {breaches > 0 && ` · ${breaches} past their Ingenico target`}. A target
        is only shown on steps Ingenico owns — an acquirer holding a decision is
        not late against our clock.
      </p>
    </main>
  )
}

function Row({ row, onOpen }: { row: EstateRow; onOpen: () => void }) {
  const lane = laneOf(row)
  const meta = LANES.find((l) => l.id === lane)!
  const step = stepById(row.merchant.currentStep)
  return (
    <tr className="border-b border-border/40 transition-colors last:border-0 hover:bg-secondary/50">
      <Td>
        <button onClick={onOpen} className="text-left">
          <span className="block text-[13px] font-medium text-foreground">
            {row.merchant.name}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {row.merchant.sector} · {row.merchant.location}
          </span>
        </button>
      </Td>
      <Td>
        <span className="text-[12px] text-muted-foreground">{row.acquirer}</span>
      </Td>
      <Td>
        <span className="text-[12px] text-foreground">
          {step.id}. {step.name}
        </span>
      </Td>
      <Td>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            lane === "ingenico"
              ? "bg-primary/12 text-primary"
              : "bg-secondary text-muted-foreground",
          )}
        >
          {meta.label}
        </span>
      </Td>
      <Td right>
        {/* Age is always measured; only Ingenico-owned steps get a verdict on
            it. And sitting exactly ON the target is not the same as being past
            it, so the two are worded differently rather than split by colour. */}
        <span
          className={cn(
            "text-[12px] tabular-nums",
            row.breached ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {row.daysInStep}d
        </span>
        {row.slaDays !== null && (
          <span
            className={cn(
              "ml-1.5 text-[11px]",
              row.breached ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {row.breached
              ? `past ${row.slaDays}d`
              : row.daysInStep === row.slaDays
                ? "due today"
                : `/ ${row.slaDays}d`}
          </span>
        )}
      </Td>
      <Td right>
        <button
          onClick={onOpen}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
        >
          {row.breached && <TriangleAlert className="h-3.5 w-3.5" />}
          Open
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </Td>
    </tr>
  )
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: "warn"
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  )
}

function Filter({
  label,
  value,
  options,
  onChange,
  render,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
  render?: (v: string) => string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="glass-pill flex flex-wrap items-center gap-1 rounded-full p-1">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            aria-pressed={value === o}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
              value === o
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {render ? render(o) : o}
          </button>
        ))}
      </div>
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
        right && "text-right",
      )}
    >
      {children}
    </th>
  )
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={cn("px-4 py-3 align-middle", right && "text-right")}>{children}</td>
}
