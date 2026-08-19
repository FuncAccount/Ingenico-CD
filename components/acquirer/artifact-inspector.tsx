"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import {
  Minus,
  Plus,
  MapPin,
  AlertTriangle,
  Check,
  CheckCircle2,
  FileText,
  Info,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { BrandStudio } from "@/components/acquirer/brand-studio"
import { EdgeCaseDesk, RiskBreakdown } from "@/components/acquirer/risk-desk"
import type { BrandTheme } from "@/lib/branding"
import type { EdgeResolution } from "@/lib/underwriting"
import type { Merchant } from "@/lib/acquirer-data"
import {
  type Artifact,
  type BasketLine,
  type Sku,
  CATALOGUE,
  SERVICE_LEVELS,
  RATE_CARD,
  checkStock,
  priceOrder,
  promiseDate,
  deliveryGeo,
  warehousesByDistance,
  fmtDate,
  isoDate,
  eur,
} from "@/lib/artifacts"

import type { MapPoint } from "@/components/acquirer/delivery-map"

// The map is client-only: Leaflet touches window on import.
const DeliveryMap = dynamic(
  () => import("@/components/acquirer/delivery-map").then((m) => m.DeliveryMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading map…
      </div>
    ),
  },
)

export interface OrderDraft {
  lines: BasketLine[]
  serviceId: "standard" | "express"
  /** Null until the user opens delivery — avoids rendering a date during SSR. */
  requestedIso: string | null
}

interface Props {
  artifact: Artifact | null
  merchant: Merchant
  draft: OrderDraft
  /** An updater, not a value: two quick taps on "+" both have to count. */
  onDraft: React.Dispatch<React.SetStateAction<OrderDraft>>
  /** Artefacts only exist once the agent has actually run the task. */
  produced: boolean
  /** Branding is a design surface, so its state lives with the journey and is
   *  read by the sign-off gate — not local to the panel that draws it. */
  theme: BrandTheme
  onTheme: (t: BrandTheme) => void
  /** The escalated underwriting item, and the acquirer's determination on it. */
  edge: EdgeResolution | undefined
  onEdge: (r: EdgeResolution) => void
}

/* ------------------------------------------------------------ small parts */

function Shell({
  title,
  note,
  editable,
  action,
  children,
}: {
  title: string
  note: string
  editable?: boolean
  /** Sits on the title row, top right — for panels that can be added to. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground">{title}</h4>
              {editable && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Yours to change
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p>
          </div>
          {action}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  )
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1.5 text-sm", className)}>
      {children}
    </div>
  )
}

function Absent({ children }: { children: React.ReactNode }) {
  // A gap is named, never rendered as a blank or a zero.
  return <span className="text-xs italic text-muted-foreground">{children}</span>
}

/* ---------------------------------------------------------------- basket */

function BasketView({ draft, onDraft, note, title }: Props & { note: string; title: string }) {
  const [adding, setAdding] = useState(false)
  const pricing = useMemo(
    () => priceOrder(draft.lines, SERVICE_LEVELS.find((s) => s.id === draft.serviceId)!),
    [draft.lines, draft.serviceId],
  )
  const units = draft.lines.reduce((s, l) => s + l.qty, 0)
  const active = draft.lines.filter((l) => l.qty > 0).length

  /* Only catalogue items not already on the order. A line the agent proposed
     and the acquirer then zeroed still exists in the draft, so it is offered
     back through its own "+" rather than duplicated here. */
  const addable = useMemo(
    () => Object.values(CATALOGUE).filter((s) => !draft.lines.some((l) => l.sku === s.sku)),
    [draft.lines],
  )

  function bumpQty(sku: string, by: number) {
    onDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.sku === sku ? { ...l, qty: Math.max(0, l.qty + by) } : l)),
    }))
  }

  function addLine(sku: Sku) {
    onDraft((d) => ({
      ...d,
      lines: [...d.lines, { sku: sku.sku, name: sku.name, kind: sku.kind, unit: sku.unit, qty: 1 }],
    }))
    setAdding(false)
  }

  return (
    <Shell
      title={title}
      note={note}
      editable
      action={
        addable.length > 0 ? (
          <button
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-white/80 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <Plus className="h-3 w-3" />
            Add item
          </button>
        ) : null
      }
    >
      {adding && (
        <div className="mb-3 overflow-hidden rounded-xl border border-primary/30 bg-primary/[0.04]">
          <p className="border-b border-primary/20 px-3 py-2 text-[11px] text-muted-foreground">
            Catalogue items not on this order. Adding one puts it on the order at your rate card —
            it does not change what the agent recommended.
          </p>
          {addable.map((s, i) => (
            <button
              key={s.sku}
              onClick={() => addLine(s)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-primary/8",
                i > 0 && "border-t border-primary/15",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {s.sku} · {eur(s.unit)} each
                </p>
              </div>
              <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
        {pricing.lines.map((line, i) => (
          <div
            key={line.sku}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5",
              i > 0 && "border-t border-border/60",
              line.qty === 0 && "opacity-55",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{line.name}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {line.sku} · {eur(line.unit)} each
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => bumpQty(line.sku, -1)}
                disabled={line.qty === 0}
                aria-label={`Decrease ${line.name}`}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-white/80 text-foreground transition-colors hover:bg-secondary disabled:opacity-35"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-8 text-center font-mono text-sm tabular-nums text-foreground">
                {line.qty}
              </span>
              <button
                onClick={() => bumpQty(line.sku, 1)}
                aria-label={`Increase ${line.name}`}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-white/80 text-foreground transition-colors hover:bg-secondary"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="w-20 text-right font-mono text-sm tabular-nums text-foreground">
              {line.qty === 0 ? <Absent>not ordered</Absent> : eur(line.lineTotal)}
            </span>
          </div>
        ))}
      </div>
      <Row className="mt-3 border-t border-border/70 pt-3">
        <span className="text-xs text-muted-foreground">
          {active} lines · {units} units
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {eur(pricing.subtotal)} before discount
        </span>
      </Row>
    </Shell>
  )
}

/* ----------------------------------------------------------------- stock */

function StockView({ merchant, draft, note, title }: Props & { note: string; title: string }) {
  const geo = deliveryGeo(merchant)
  const stock = useMemo(() => checkStock(draft.lines.filter((l) => l.qty > 0), geo), [draft.lines, geo])

  return (
    <Shell title={title} note={note}>
      {/* Headline first: the acquirer's question is "can this be delivered",
          not "which shelf is it on". */}
      <div
        className={cn(
          "mb-3 flex gap-2 rounded-xl border p-3",
          stock.shortLines.length > 0
            ? "border-warning/40 bg-warning/8"
            : "border-success/30 bg-success/8",
        )}
      >
        {stock.shortLines.length > 0 ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        )}
        <p className="text-xs leading-relaxed text-foreground">
          {stock.shortLines.length === 0 ? (
            <>
              <span className="font-semibold">Every line is available.</span> Ingenico has confirmed
              the full order can ship on the committed date.
            </>
          ) : (
            <>
              <span className="font-semibold">
                {stock.shortLines.length}{" "}
                {stock.shortLines.length === 1 ? "line is" : "lines are"} not available in full.
              </span>{" "}
              The order can still be placed — the balance follows on backorder, so it is a later
              date, not a cancelled line.
            </>
          )}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
        {stock.lines.map((line, i) => (
          <div key={line.sku} className={cn("px-3 py-2.5", i > 0 && "border-t border-border/60")}>
            <Row className="py-0">
              <span className="truncate text-sm font-medium text-foreground">{line.name}</span>
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                  line.shortfall > 0
                    ? "bg-warning/15 text-warning-foreground"
                    : "bg-success/12 text-success",
                )}
              >
                {line.shortfall > 0 ? "Part now, part to follow" : "Available"}
              </span>
            </Row>
            {line.shortfall > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {`${line.covered} of ${line.need} ship with the main delivery; ${line.shortfall} follow${
                  line.shortfall === 1 ? "s" : ""
                } on backorder.`}
              </p>
            )}
          </div>
        ))}
        {stock.lines.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            Nothing is on the order, so there is nothing to check.
          </p>
        )}
      </div>

      {/* The warehouse split is Ingenico's to manage. Naming it as withheld is
          more honest than showing counts the acquirer cannot act on. */}
      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {stock.sites > 1
          ? `Ingenico is fulfilling this from ${stock.sites} of its sites, which is why part of the order can follow separately. Which warehouse holds what is theirs to manage, not yours.`
          : "Ingenico holds warehouse-level stock; you see availability and dates, not their inventory positions."}
      </p>
    </Shell>
  )
}

/* -------------------------------------------------------------- delivery */

function DeliveryView({ merchant, draft, onDraft, note, title }: Props & { note: string; title: string }) {
  const geo = deliveryGeo(merchant)
  const service = SERVICE_LEVELS.find((s) => s.id === draft.serviceId)!
  const stock = useMemo(() => checkStock(draft.lines.filter((l) => l.qty > 0), geo), [draft.lines, geo])
  const origin = geo ? warehousesByDistance(geo)[0] : null

  // Default the requested date on first open, so no date is rendered server-side.
  useEffect(() => {
    onDraft((d) => {
      if (d.requestedIso) return d
      const next = new Date()
      next.setDate(next.getDate() + 7)
      return { ...d, requestedIso: isoDate(next) }
    })
  }, [onDraft])

  const promise = useMemo(() => {
    if (!draft.requestedIso) return null
    return promiseDate(draft.requestedIso, service, stock, new Date())
  }, [draft.requestedIso, service, stock])

  const points = useMemo(() => {
    if (!geo) return []
    const list: MapPoint[] = [
      { lat: geo.lat, lng: geo.lng, label: geo.label, role: "destination" },
    ]
    if (origin) {
      list.unshift({
        lat: origin.wh.lat,
        lng: origin.wh.lng,
        label: origin.wh.name,
        role: "origin",
      })
    }
    return list
  }, [geo, origin])

  return (
    <Shell title={title} note={note} editable>
      {geo ? (
        <>
          <div className="h-52 overflow-hidden rounded-xl border border-border/70">
            <DeliveryMap points={points} />
          </div>
          <div className="mt-3 flex gap-2 rounded-xl border border-border/70 bg-white/60 p-3">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{geo.label}</p>
              <p className="text-xs text-muted-foreground">{geo.address}</p>
              {origin && (
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  from {origin.wh.name} · {origin.distanceKm} km
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-border/70 bg-white/60 p-4">
          <Absent>No delivery point on file for this merchant, so no route can be drawn.</Absent>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Service level
          </label>
          <div className="flex gap-1.5">
            {SERVICE_LEVELS.map((s) => (
              <button
                key={s.id}
                onClick={() => onDraft((d) => ({ ...d, serviceId: s.id }))}
                className={cn(
                  "flex-1 rounded-xl border px-2.5 py-2 text-left transition-colors",
                  draft.serviceId === s.id
                    ? "border-primary/50 bg-primary/10"
                    : "border-border bg-white/70 hover:bg-secondary",
                )}
              >
                <span className="block text-xs font-semibold text-foreground">{s.label}</span>
                <span className="block font-mono text-[10px] text-muted-foreground">
                  {s.workingDays}d · {eur(s.shipping)}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label
            htmlFor="requested-date"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Requested date
          </label>
          <input
            id="requested-date"
            type="date"
            value={draft.requestedIso ?? ""}
            onChange={(e) => {
              const v = e.target.value
              onDraft((d) => ({ ...d, requestedIso: v }))
            }}
            className="input-base"
          />
        </div>
      </div>

      {promise && (
        <div
          className={cn(
            "mt-3 rounded-xl border p-3",
            promise.achievable
              ? "border-success/30 bg-success/8"
              : "border-warning/40 bg-warning/10",
          )}
        >
          <Row className="py-0">
            <span className="text-xs text-muted-foreground">Earliest committed date</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {fmtDate(promise.earliest)}
            </span>
          </Row>
          <p className="mt-1.5 text-xs leading-relaxed text-foreground">{promise.note}</p>
        </div>
      )}
    </Shell>
  )
}

/* --------------------------------------------------------------- pricing */

function PricingView({ draft, note, title }: Props & { note: string; title: string }) {
  const service = SERVICE_LEVELS.find((s) => s.id === draft.serviceId)!
  const p = useMemo(() => priceOrder(draft.lines, service), [draft.lines, service])

  return (
    <Shell title={title} note={note}>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
        {p.lines
          .filter((l) => l.qty > 0)
          .map((line, i) => (
            <Row key={line.sku} className={cn("px-3", i > 0 && "border-t border-border/60")}>
              <span className="min-w-0 truncate text-sm text-foreground">
                {line.qty}× {line.name}
              </span>
              <span className="font-mono text-sm tabular-nums text-foreground">{eur(line.lineTotal)}</span>
            </Row>
          ))}
      </div>

      <div className="mt-3 space-y-0.5">
        <Row>
          <span className="text-sm text-muted-foreground">Subtotal</span>
          <span className="font-mono text-sm tabular-nums text-foreground">{eur(p.subtotal)}</span>
        </Row>
        <Row>
          <span className="text-sm text-muted-foreground">
            Rate card {RATE_CARD.id} · {RATE_CARD.hardwareDiscount * 100}% hardware
          </span>
          <span className="font-mono text-sm tabular-nums text-success">−{eur(p.discount)}</span>
        </Row>
        <Row>
          <span className="text-sm text-muted-foreground">Shipping — {service.label}</span>
          <span className="font-mono text-sm tabular-nums text-foreground">{eur(p.shipping)}</span>
        </Row>
        <Row className="border-t border-border/70 pt-2">
          <span className="text-sm text-muted-foreground">Net</span>
          <span className="font-mono text-sm tabular-nums text-foreground">{eur(p.net)}</span>
        </Row>
        <Row>
          <span className="text-sm text-muted-foreground">VAT {RATE_CARD.vat * 100}%</span>
          <span className="font-mono text-sm tabular-nums text-foreground">{eur(p.vat)}</span>
        </Row>
        <Row className="border-t border-border/70 pt-2">
          <span className="text-sm font-semibold text-foreground">Total</span>
          <span className="font-mono text-lg font-bold tabular-nums text-foreground">{eur(p.total)}</span>
        </Row>
      </div>

      {/* The arithmetic is printed so the total can be checked, not trusted. */}
      <p className="mt-3 rounded-lg border border-border/60 bg-secondary/50 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {p.workings}
      </p>
      <p className="mt-2 flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
        Derived from the basket and service level — change those and this moves. All figures EUR,
        excluding any cross-border FX applied at invoice.
      </p>
    </Shell>
  )
}

/* ------------------------------------------------------- generic artefacts */

function RecordsView({ artifact }: { artifact: Extract<Artifact, { kind: "records" }> }) {
  return (
    <Shell title={artifact.title} note={artifact.note}>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
        {artifact.rows.map((r, i) => (
          <div key={r.label} className={cn("px-3 py-2.5", i > 0 && "border-t border-border/60")}>
            <Row className="py-0">
              <span className="text-sm text-muted-foreground">{r.label}</span>
              <span className="text-right text-sm font-medium text-foreground">
                {r.value ?? <Absent>not on file</Absent>}
              </span>
            </Row>
            {r.source && (
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{r.source}</p>
            )}
          </div>
        ))}
      </div>
    </Shell>
  )
}

function ChecksView({ artifact }: { artifact: Extract<Artifact, { kind: "checks" }> }) {
  const tone = {
    pass: "text-success",
    warn: "text-warning",
    fail: "text-destructive",
  } as const
  return (
    <Shell title={artifact.title} note={artifact.note}>
      <div className="space-y-2">
        {artifact.rows.map((r) => (
          <div key={r.label} className="flex gap-2.5 rounded-xl border border-border/70 bg-white/60 p-3">
            <span className={cn("mt-0.5 shrink-0", tone[r.state])}>
              {r.state === "pass" ? (
                <Check className="h-4 w-4" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{r.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{r.evidence}</p>
            </div>
          </div>
        ))}
      </div>
    </Shell>
  )
}

function TableView({ artifact }: { artifact: Extract<Artifact, { kind: "table" }> }) {
  return (
    <Shell title={artifact.title} note={artifact.note}>
      <div className="overflow-x-auto rounded-xl border border-border/70 bg-white/60">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border/60">
              {artifact.table.columns.map((c) => (
                <th
                  key={c}
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifact.table.rows.map((row, i) => (
              <tr key={i} className={cn(i > 0 && "border-t border-border/60")}>
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 text-foreground">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  )
}

function DocumentView({ artifact }: { artifact: Extract<Artifact, { kind: "document" }> }) {
  return (
    <Shell title={artifact.title} note={artifact.note}>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <FileText className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono text-[11px] text-muted-foreground">{artifact.filename}</span>
        </div>
        <pre className="whitespace-pre-wrap px-3 py-3 font-mono text-[11px] leading-relaxed text-foreground">
          {artifact.lines.join("\n")}
        </pre>
      </div>
    </Shell>
  )
}

/* -------------------------------------------------------------- inspector */

export function ArtifactInspector(props: Props) {
  const { artifact, produced } = props

  if (!produced) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          This task has not run yet. Play the agent to produce its artefact — nothing is shown here
          before there is something real to show.
        </p>
      </div>
    )
  }

  if (!artifact) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          This task wrote to the trace but produced no inspectable artefact.
        </p>
      </div>
    )
  }

  switch (artifact.kind) {
    case "basket":
      return <BasketView {...props} title={artifact.title} note={artifact.note} />
    case "stock":
      return <StockView {...props} title={artifact.title} note={artifact.note} />
    case "delivery":
      return <DeliveryView {...props} title={artifact.title} note={artifact.note} />
    case "pricing":
      return <PricingView {...props} title={artifact.title} note={artifact.note} />
    case "records":
      return <RecordsView artifact={artifact} />
    case "checks":
      return <ChecksView artifact={artifact} />
    case "table":
      return <TableView artifact={artifact} />
    case "document":
      return <DocumentView artifact={artifact} />
    case "risk":
      return (
        <Shell title={artifact.title} note={artifact.note}>
          <RiskBreakdown merchant={props.merchant} />
        </Shell>
      )
    case "edge":
      return (
        <Shell title={artifact.title} note={artifact.note}>
          <EdgeCaseDesk
            merchant={props.merchant}
            resolution={props.edge}
            onResolution={props.onEdge}
          />
        </Shell>
      )
    case "brand":
      return (
        <Shell title={artifact.title} note={artifact.note}>
          <BrandStudio merchant={props.merchant} theme={props.theme} onTheme={props.onTheme} />
        </Shell>
      )
  }
}
