"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import {
  Minus,
  Plus,
  MapPin,
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  Mail,
  Pencil,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { BrandStudio } from "@/components/acquirer/brand-studio"
import { EdgeCaseDesk, RiskBreakdown } from "@/components/acquirer/risk-desk"
import { SchemeDesk } from "@/components/acquirer/scheme-desk"
import type { AcceptanceState } from "@/lib/scheme-acceptance"
import type { BrandTheme } from "@/lib/branding"
import type { EdgeResolution } from "@/lib/underwriting"
import type { Merchant, StepId } from "@/lib/acquirer-data"
import { releaseKey, type ReleaseRecord, type Releases } from "@/lib/releases"
import { formatRate, projectSignUp, type Projection } from "@/lib/tariff-model"
import { fmtDateTime } from "@/lib/handoffs"
import {
  type Artifact,
  type ArtifactHandoff,
  type BasketLine,
  type PushReadiness,
  type Sku,
  pushReadiness,
  CATALOGUE,
  SERVICE_LEVELS,
  RATE_CARD,
  checkStock,
  priceOrder,
  promiseDate,
  deliveryGeo,
  warehousesByDistance,
  consignmentFacts,
  experimentReading,
  metricOverlap,
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
  /** Scheme acceptance: what is live, what the acquirer has asked for, and the
   *  instructions already sent. Lifted like `theme` because the requested set
   *  outlives the panel and has to survive stepping away and back. */
  acceptance: AcceptanceState
  onAcceptance: (s: AcceptanceState) => void
  /** Which artefact this is, so a release can be recorded against it. The
   *  record is held by the journey, not the footer: the step badge reads it,
   *  and it has to survive stepping away from the panel. */
  stepId: StepId
  taskIndex: number
  releases: Releases
  onReleases: React.Dispatch<React.SetStateAction<Releases>>
}

/** The release record plus the slot this artefact occupies in it. Bundled so a
 *  view that merely forwards it to the footer takes one prop, not three. */
interface ReleaseSlot {
  slot: string
  releases: Releases
  onReleases: React.Dispatch<React.SetStateAction<Releases>>
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

/* ----------------------------------------------------------- consignment */

/** The ship-stage twin of `DeliveryView`. Same journey, no controls: the
 *  service level and the date were settled at step 03 and the goods are with
 *  the carrier, so everything here is REPORTED. It carries no `editable` flag,
 *  which is what keeps the "Yours to change" badge off a panel where nothing
 *  is. */
function ConsignmentView({ merchant, draft, note, title }: Props & { note: string; title: string }) {
  const f = consignmentFacts(merchant)
  const service = SERVICE_LEVELS.find((s) => s.id === draft.serviceId)!

  const points = useMemo(() => {
    if (!f.geo) return []
    const list: MapPoint[] = [{ lat: f.geo.lat, lng: f.geo.lng, label: f.geo.label, role: "destination" }]
    if (f.origin) {
      list.unshift({ lat: f.origin.wh.lat, lng: f.origin.wh.lng, label: f.origin.wh.name, role: "origin" })
    }
    return list
  }, [f.geo, f.origin])

  return (
    <Shell title={title} note={note}>
      {f.geo ? (
        <>
          <div className="h-52 overflow-hidden rounded-xl border border-border/70">
            <DeliveryMap points={points} />
          </div>
          <div className="mt-3 flex gap-2 rounded-xl border border-border/70 bg-white/60 p-3">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{f.geo.label}</p>
              <p className="text-xs text-muted-foreground">{f.geo.address}</p>
              {f.origin && (
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  from {f.origin.wh.name} · {f.origin.distanceKm} km
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

      <div className="mt-4 rounded-xl border border-border/70 bg-white/60 p-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Agreed at order
        </p>
        <Row>
          <span className="text-xs text-muted-foreground">Service level</span>
          <span className="text-sm font-medium text-foreground">
            {service.label} · {service.workingDays} working day{service.workingDays === 1 ? "" : "s"}
          </span>
        </Row>
        <Row>
          <span className="text-xs text-muted-foreground">Committed date</span>
          {/* Read straight off the order draft, NOT recomputed. The editor ran
              `promiseDate(..., new Date())`, so this line used to re-derive an
              "earliest" date from TODAY and drift a day at a time away from the
              thing the note says it is measured against. */}
          {draft.requestedIso ? (
            <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {fmtDate(new Date(`${draft.requestedIso}T00:00:00`))}
            </span>
          ) : (
            <Absent>No date was set at order</Absent>
          )}
        </Row>
      </div>

      <div className="mt-3 rounded-xl border border-border/70 bg-white/60 p-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Booked by Ingenico
        </p>
        <Row>
          <span className="text-xs text-muted-foreground">Carrier</span>
          <span className="text-sm font-medium text-foreground">{f.carrier}</span>
        </Row>
        <Row>
          <span className="text-xs text-muted-foreground">Collection reference</span>
          <span className="font-mono text-sm text-foreground">{f.collectionRef}</span>
        </Row>
        <Row>
          <span className="text-xs text-muted-foreground">Parcels in transit</span>
          <span className="font-mono text-sm tabular-nums text-foreground">{f.parcels}</span>
        </Row>
      </div>

      {/* A live carrier feed is not wired up. Saying "in transit" and stopping
          would let the reader assume the absence of an exception IS a clean
          run, so the gap is named rather than left to be inferred. */}
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Per-parcel scan events and a confirmed arrival time come from the carrier through Ingenico, and
        are not on this record yet. To move the date or the service level, raise it with Ingenico
        logistics in the handoff below — it cannot be changed here once the consignment is with the
        carrier.
      </p>
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

function RecordsView({
  artifact,
  release,
}: {
  artifact: Extract<Artifact, { kind: "records" }>
  release: ReleaseSlot
}) {
  // Where an edit is the acquirer's to make, the control must say WHERE the
  // change lands. A bare "Edit" on a panel that cannot write would be a
  // control that does nothing — worse than no control, because the reader
  // would believe acceptance had been changed here.
  const [showEdit, setShowEdit] = useState(false)
  // Held OUTSIDE the artefact, keyed by label: the artefact is the record of
  // what the AGENT drafted, and writing over it would destroy the evidence of
  // what was proposed the instant somebody disagreed with a line.
  const [edits, setEdits] = useState<Record<string, string>>({})
  const readiness = pushReadiness(artifact.rows, edits)
  const anyWritable = artifact.rows.some((r) => r.writable)

  return (
    <Shell title={artifact.title} note={artifact.note} editable={anyWritable}>
      {artifact.outcome && (
        <div
          className={cn(
            "mb-2.5 flex gap-2.5 rounded-xl border px-3 py-2.5",
            artifact.outcome.state === "ok" && "border-success/30 bg-success/[0.08]",
            artifact.outcome.state === "warn" && "border-warning/35 bg-warning/[0.10]",
            artifact.outcome.state === "fail" && "border-destructive/30 bg-destructive/[0.08]",
          )}
        >
          <span
            className={cn(
              "mt-0.5 shrink-0",
              artifact.outcome.state === "ok" && "text-success",
              artifact.outcome.state === "warn" && "text-warning",
              artifact.outcome.state === "fail" && "text-destructive",
            )}
          >
            {artifact.outcome.state === "ok" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{artifact.outcome.headline}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {artifact.outcome.detail}
            </p>
          </div>
        </div>
      )}
      {artifact.editable && (
        <div className="mb-2.5">
          <button
            type="button"
            onClick={() => setShowEdit((v) => !v)}
            aria-expanded={showEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/70 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
            {artifact.editable.label}
          </button>
          {showEdit && (
            <p className="mt-2 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2 text-[11px] leading-relaxed text-foreground">
              {artifact.editable.where}
            </p>
          )}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
        {artifact.rows.map((r, i) => {
          const typed = edits[r.label]
          const isChanged = typed !== undefined && typed.trim() !== (r.value ?? "").trim()
          return (
            <div key={r.label} className={cn("px-3 py-2.5", i > 0 && "border-t border-border/60")}>
              {/* Wraps rather than shrinking the field: a legal name is as long
                  as it is, and a right-aligned input too narrow for its value
                  clips the tail — which reads as a broken render on the one
                  panel whose whole job is to show you what is about to be
                  filed under your name. */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <label
                  htmlFor={r.writable ? `rec-${r.label}` : undefined}
                  className="shrink-0 text-sm text-muted-foreground"
                >
                  {r.label}
                </label>
                {r.writable ? (
                  <input
                    id={`rec-${r.label}`}
                    value={typed ?? r.value ?? ""}
                    onChange={(e) => setEdits((s) => ({ ...s, [r.label]: e.target.value }))}
                    spellCheck={false}
                    // A field the agent left empty gets a prompt rather than a
                    // blank box, so an absence still reads as an absence once
                    // it becomes typeable.
                    placeholder={r.value === null ? "not on file — key it in" : undefined}
                    className={cn(
                      "w-full min-w-[10rem] max-w-full flex-1 basis-40 rounded-lg border bg-white px-2 py-1 text-right text-sm font-medium text-foreground outline-none transition-colors placeholder:font-normal placeholder:italic focus:border-primary focus:ring-2 focus:ring-primary/20",
                      isChanged ? "border-primary/50" : "border-border",
                    )}
                  />
                ) : (
                  <span className="text-right text-sm font-medium text-foreground">
                    {r.value ?? <Absent>not on file</Absent>}
                  </span>
                )}
              </div>
              {r.source && (
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{r.source}</p>
              )}
              {isChanged && (
                <p className="mt-1 flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
                  {/* The agent's value survives the disagreement — the panel is
                      the record of what it proposed, and overwriting that would
                      destroy the evidence the moment someone corrected it. */}
                  <span>
                    Agent drafted{" "}
                    <span className="font-medium text-foreground">
                      {r.value === null || r.value === "" ? "nothing" : r.value}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setEdits((s) => {
                        const next = { ...s }
                        delete next[r.label]
                        return next
                      })
                    }
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Restore
                  </button>
                </p>
              )}
              {/* A gap that names who closes it and when is a scheduled step; a
                  gap that names nobody is an open question the reader has to
                  chase. The two must not look alike. */}
              {r.value === null && typed === undefined && r.resolution && (
                <p
                  className={cn(
                    "mt-1.5 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px]",
                    r.resolution.blocking
                      ? "bg-warning/15 text-warning-foreground"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  {r.resolution.blocking ? (
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                  ) : (
                    <Info className="h-3 w-3 shrink-0" />
                  )}
                  <span>
                    <span className="font-medium">{r.resolution.owner}</span> · {r.resolution.when}
                    {r.resolution.blocking ? " — needed before this step can clear" : ""}
                  </span>
                </p>
              )}
            </div>
          )
        })}
      </div>

      {artifact.handoff && (
        <HandoffFooter
          handoff={artifact.handoff}
          readiness={readiness}
          slot={release.slot}
          releases={release.releases}
          onReleases={release.onReleases}
          // Re-keyed on the merchant's own record so a push receipt cannot
          // follow the reader onto the next merchant's identical panel.
          signature={JSON.stringify(artifact.rows.map((r) => edits[r.label] ?? r.value))}
        />
      )}
    </Shell>
  )
}

/**
 * The commit at the end of a stage: the control that actually sends the record
 * on, and the receipt for having sent it.
 *
 * Everything it says is derived from the rows above it (`pushReadiness`), so
 * the footer cannot describe a record different from the one on screen. Three
 * states, and the third is the one worth the code:
 *
 *   blocked  — refuses, and names what is in the way rather than greying out
 *   ready    — offers the push, disclosing any gap that travels with it
 *   sent     — a receipt; and if the record is EDITED after being sent, the
 *              receipt goes stale rather than standing there asserting that
 *              the destination holds values it does not.
 */
function HandoffFooter({
  handoff,
  readiness,
  signature,
  slot,
  releases,
  onReleases,
}: {
  handoff: ArtifactHandoff
  readiness: PushReadiness
  /** The content that was sent. Compared against the live rows to notice an
   *  edit made after the push. */
  signature: string
  /** Where to record the release. Held by the journey rather than here: local
   *  state died on every task switch, so a commit already released came back
   *  looking unreleased, and the step badge could not see it at all. */
  slot: string
  releases: Releases
  onReleases: React.Dispatch<React.SetStateAction<Releases>>
}) {
  const sent: ReleaseRecord | null = releases[slot] ?? null
  const setSent = (rec: ReleaseRecord) => onReleases((r) => ({ ...r, [slot]: rec }))
  const blocked = readiness.blockers.length > 0
  const stale = sent !== null && sent.signature !== signature

  if (sent && !stale) {
    return (
      <div className="mt-3 rounded-xl border border-success/35 bg-success/[0.07] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          Sent to {handoff.system}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {fmtDateTime(sent.atIso)} · {handoff.delivers}
        </p>
        {/* Attribution, not decoration. A record that a person moved three
            fields in is not the agent's output, and whoever opens it in the
            destination is entitled to know that before they rely on it. */}
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {sent.edited > 0
            ? `${sent.edited} field${sent.edited === 1 ? "" : "s"} carried your correction rather than the agent's value.`
            : "Sent exactly as the agent drafted it."}
          {sent.gaps > 0 &&
            ` ${sent.gaps} field${sent.gaps === 1 ? " was" : "s were"} still empty and went over empty.`}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-white/70 px-3 py-2.5">
      {stale && (
        // The dangerous state. Without this the receipt above would go on
        // saying "sent" over fields that have since changed, and the acquirer
        // would believe the destination holds the value in front of them.
        <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-warning/15 px-2 py-1.5 text-[11px] leading-relaxed text-warning-foreground">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          {/* Reworded so the system name is never sentence-initial: `system`
              is sometimes a proper noun ("Northgate Acquiring CRM") and
              sometimes a noun phrase ("the merchant"), and starting a sentence
              with it produced "Edited after sending. the merchant still…". */}
          <span>
            Edited after sending — {handoff.system} still holds the version sent at{" "}
            {fmtDateTime(sent!.atIso)}. Send again to bring it up to date.
          </span>
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">{handoff.commits}</p>

      {blocked ? (
        <div className="mt-2">
          {/* Named, not merely disabled. A greyed-out button on a screen full
              of fields does not tell you which one it is waiting for. */}
          <p className="mb-1.5 text-[11px] font-semibold text-destructive">
            Cannot send yet:
          </p>
          <ul className="space-y-0.5">
            {readiness.blockers.map((b) => (
              <li key={b} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-destructive" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {readiness.gaps.length > 0 && (
            // The gap travels either way — the destination sees an empty field
            // whether or not this screen mentions it. Saying so before the
            // click is the difference between a disclosure and a surprise.
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Goes with {readiness.gaps.length} field
                {readiness.gaps.length === 1 ? "" : "s"} still empty: {readiness.gaps.join(", ")}.
              </span>
            </p>
          )}
          <button
            type="button"
            onClick={() =>
              setSent({
                // Stamped once, at the moment of the push. Formatting a fresh
                // Date at render would restate an old send with today's clock.
                atIso: new Date().toISOString(),
                signature,
                edited: readiness.edited.length,
                gaps: readiness.gaps.length,
              })
            }
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            {stale ? `Send again to ${handoff.system}` : handoff.action}
          </button>
        </>
      )}
    </div>
  )
}

/**
 * The test run, as a ledger of individual authorisations.
 *
 * The summary line is COUNTED from the rows rather than written, so a run that
 * gains or loses a failure cannot leave a stale headline behind. A failed row
 * is expanded by default: a decline the reader has to click to discover is a
 * decline the demo has hidden.
 */
function TxnsView({ artifact }: { artifact: Extract<Artifact, { kind: "txns" }> }) {
  const failed = artifact.rows.filter((r) => r.state === "fail")
  const warned = artifact.rows.filter((r) => r.state === "warn")
  const passed = artifact.rows.length - failed.length - warned.length
  const blocking = failed.some((r) => r.fix?.blocking)

  const tone = {
    pass: { text: "text-success", dot: "bg-success" },
    warn: { text: "text-warning", dot: "bg-warning" },
    fail: { text: "text-destructive", dot: "bg-destructive" },
  } as const

  return (
    <Shell title={artifact.title} note={artifact.note}>
      <div
        className={cn(
          "mb-2.5 flex gap-2.5 rounded-xl border px-3 py-2.5",
          failed.length
            ? "border-destructive/30 bg-destructive/[0.08]"
            : "border-success/30 bg-success/[0.08]",
        )}
      >
        <span className={cn("mt-0.5 shrink-0", failed.length ? "text-destructive" : "text-success")}>
          {failed.length ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {failed.length
              ? `${failed.length} of ${artifact.rows.length} declined`
              : `${artifact.rows.length} of ${artifact.rows.length} approved`}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {/* "approved" here would double-count against the headline: the
                above-target row WAS approved, just slowly, so the detail read
                "4 approved" under a headline reading "5 of 5 approved".
                Latency and outcome are different axes and are counted as such. */}
            {`${passed} within target · ${warned.length} above target · ${failed.length} declined.`}
            {blocking && " Dispatch is held until the declined transaction re-runs clean."}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {artifact.rows.map((r) => (
          <div
            key={r.ref}
            className={cn(
              "rounded-xl border bg-white/60 p-3",
              r.state === "fail" ? "border-destructive/35" : "border-border/70",
            )}
          >
            {/* Stacked, not a two-column row. A decline reason is a sentence
                ("58 — transaction not permitted to terminal"), and putting a
                sentence opposite a title in a ~390px panel made the two
                overlap and broke the mono reference onto one character per
                line. The verdict gets its own full-width line. */}
            <div className="flex items-baseline justify-between gap-3">
              <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone[r.state].dot)} />
                {r.kind}
              </p>
              {/* Seconds once a figure stops being a round-trip and starts
                  being a wait — 40200ms reads as noise. */}
              <p className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {r.latencyMs >= 10000
                  ? `${(r.latencyMs / 1000).toFixed(1)}s`
                  : `${(r.latencyMs / 1000).toFixed(2)}s`}
              </p>
            </div>
            <p className={cn("mt-1 text-xs font-medium", tone[r.state].text)}>{r.result}</p>
            <p className="mt-0.5 break-words font-mono text-[10px] text-muted-foreground">
              {r.ref} · {r.unit} · {r.amount}
            </p>

            {r.cause && (
              <p className="mt-2 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Root cause. </span>
                {r.cause}
              </p>
            )}

            {r.fix && (
              <div
                className={cn(
                  "mt-2 flex gap-2 rounded-lg px-2.5 py-2",
                  r.fix.blocking ? "bg-warning/15" : "bg-secondary",
                )}
              >
                <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-foreground" />
                <p className="text-[11px] leading-relaxed text-foreground">
                  <span className="font-semibold">{r.fix.owner} clears this. </span>
                  {r.fix.action}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </Shell>
  )
}

/**
 * The uploaded bundle, one row per file.
 *
 * An unclassified file is drawn as a WARNING, not as a weak classification: the
 * agent has no answer for it, and the row exists so that a human gives it one. A
 * greyed-out "unrecognised · low confidence" chip would sit quietly in a list of
 * ticks and get scrolled past, which is the one outcome this panel is here for.
 */
/** Section heading inside the dossier. The panel carries four distinct
 *  registers, and without labelled bands they read as one long list. */
function DossierSection({
  label,
  count,
  children,
}: {
  label: string
  count?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-3.5 first:mt-0">
      <p className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        {count && <span className="font-mono text-[11px] normal-case tracking-normal">{count}</span>}
      </p>
      {children}
    </section>
  )
}

/**
 * The whole document pass on one page.
 *
 * Replaces five panels. The order is deliberate and answers the acquirer's
 * questions in the order they ask them: what is MISSING (the only thing they
 * can act on), what ARRIVED, what we LEARNED. Status first, evidence after —
 * the reverse buried the one actionable fact under four screens of ticks.
 */
function DossierView({ artifact }: { artifact: Extract<Artifact, { kind: "dossier" }> }) {
  const [chased, setChased] = useState(false)

  const outstanding = artifact.required.filter((r) => r.received === null)
  const unclassified = artifact.files.filter((f) => f.classified === null)
  // Anything needing a human, from BOTH sources. An unrecognised file and a
  // never-delivered document are different problems with the same consequence,
  // and a panel that counted only one of them would report a file as ready
  // while a row on it still said "confirm what this is".
  const openItems = outstanding.length + unclassified.length

  return (
    <Shell title={artifact.title} note={artifact.note}>
      {/* WHAT IS OUTSTANDING, and the one button that resolves it. Placed first
          because it is the only part of this panel anyone can act on. */}
      {artifact.chase && (
        <div className="rounded-xl border border-warning/45 bg-warning/[0.07] p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            {artifact.chase.items.length} document
            {artifact.chase.items.length === 1 ? "" : "s"} outstanding
          </p>
          <ul className="mt-1.5 space-y-1">
            {artifact.chase.items.map((i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                <span aria-hidden className="text-warning">
                  •
                </span>
                {i}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {artifact.chase.note}
          </p>
          {chased ? (
            /* States what was sent, to whom and what happens next. A button
               that flips to a bare tick claims success without saying what
               actually left the building. */
            <p className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-white/70 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <span>
                <span className="font-semibold text-foreground">Request sent</span> — one message
                covering all {artifact.chase.items.length} via the {artifact.chase.channel}. The
                agent follows up automatically; the file stays blocked until they land.
              </span>
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setChased(true)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Mail className="h-3.5 w-3.5" />
              Chase all {artifact.chase.items.length} via {artifact.chase.channel}
            </button>
          )}
        </div>
      )}

      {/* REQUIRED SET. Received rows name the file that satisfied them, so this
          list and the file list below are provably the same set. */}
      <DossierSection
        label="Required documents"
        count={`${artifact.required.length - outstanding.length} of ${artifact.required.length}`}
      >
        <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
          {artifact.required.map((r) => (
            <div
              key={r.label}
              className="flex items-baseline justify-between gap-3 border-b border-border/40 px-3 py-2 last:border-0"
            >
              <span className="min-w-0 text-xs text-foreground">{r.label}</span>
              {r.received ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {r.received}
                  </span>
                  <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                </span>
              ) : (
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-warning-foreground">
                  Outstanding
                </span>
              )}
            </div>
          ))}
        </div>
      </DossierSection>

      {/* FILES RECEIVED, with the quality verdict on the same row as the type —
          two questions about one piece of paper. */}
      <DossierSection label="Files received" count={`${artifact.files.length}`}>
        <div className="space-y-1.5">
          {artifact.files.map((f) => (
            <div
              key={f.filename}
              className={cn(
                "flex gap-2.5 rounded-xl border p-2.5",
                f.classified === null
                  ? "border-warning/45 bg-warning/[0.07]"
                  : "border-border/70 bg-white/60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0",
                  f.classified === null ? "text-warning" : "text-muted-foreground",
                )}
              >
                {f.classified === null ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] text-muted-foreground">{f.filename}</p>
                {f.classified === null ? (
                  <>
                    <p className="mt-0.5 text-sm font-medium text-warning-foreground">
                      Unrecognised
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {f.review}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-0.5 text-sm font-medium text-foreground">{f.classified}</p>
                    {f.quality && (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {f.quality.evidence}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </DossierSection>

      {/* WHAT THE BUNDLE TOLD US — the part that survives once the paperwork is
          filed. Each row names its document; corroborated rows say so, because
          one source and two agreeing sources are different claims. */}
      <DossierSection label="Key findings" count={`${artifact.findings.length} fields`}>
        <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
          {artifact.findings.map((f) => (
            <div key={f.label} className="border-b border-border/40 px-3 py-2 last:border-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-xs text-muted-foreground">{f.label}</span>
                {f.value === null ? (
                  <span className="text-xs font-medium text-warning-foreground">Not on file</span>
                ) : (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {f.value}
                    {f.corroborated && (
                      <span
                        title="Confirmed by more than one document"
                        className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success"
                      >
                        2 sources
                      </span>
                    )}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{f.source}</p>
            </div>
          ))}
        </div>
      </DossierSection>

      {/* Counted off the sections above, so the summary cannot outlive them. */}
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {openItems === 0
          ? "Nothing outstanding. The bundle is complete and the file can be scored."
          : `${openItems} item${openItems === 1 ? "" : "s"} need${openItems === 1 ? "s" : ""} resolving before the file can be scored.`}
      </p>
    </Shell>
  )
}

function ChecksView({ artifact }: { artifact: Extract<Artifact, { kind: "checks" }> }) {
  const tone = {
    pass: "text-success",
    warn: "text-warning",
    fail: "text-destructive",
    running: "text-primary",
  } as const
  const open = artifact.rows.filter((r) => r.state === "running").length
  return (
    <Shell title={artifact.title} note={artifact.note}>
      <div className="space-y-2">
        {artifact.rows.map((r) => (
          <div
            key={r.label}
            className={cn(
              "flex gap-2.5 rounded-xl border p-3",
              r.state === "running"
                ? "border-primary/40 bg-primary/[0.05]"
                : "border-border/70 bg-white/60",
            )}
          >
            <span className={cn("mt-0.5 shrink-0", tone[r.state])}>
              {r.state === "pass" ? (
                <Check className="h-4 w-4" />
              ) : r.state === "running" ? (
                // A spinner, not a tick and not a warning: a check still out
                // with a provider has NO verdict, and borrowing either icon
                // would report one it has not returned.
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
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
      {/* The non-blocking claim, stated only when a check is ACTUALLY open. A
          fixed footer would keep asserting "still running" over a panel of
          ticks. */}
      {open > 0 && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {open} of {artifact.rows.length} still running. The build lane keeps moving while these
          resolve — only Ship waits on the outcome.
        </p>
      )}
    </Shell>
  )
}

/** The merchant's rate card. Every line carries its BASIS, because this is a
 *  recommendation the acquirer is expected to argue with — a bare rate can only
 *  be accepted or ignored, not corrected. */
/**
 * The projection panel. Four states, deliberately not collapsed into two:
 * a measurement, a model, a rate nobody could read, and a line the model was
 * never fitted on. The last two are different objections and lead to different
 * fixes — retype the box, versus this lever has no evidence behind it.
 */
function TariffProjection({
  artifact,
  projection,
}: {
  artifact: Extract<Artifact, { kind: "tariff" }>
  projection: Projection
}) {
  const label = artifact.projection.label

  if (projection.state === "measured") {
    return (
      <Frame label={label} tone="measured" value={`${projection.low}–${projection.high}%`}>
        {artifact.projection.basis}
      </Frame>
    )
  }

  if (projection.state === "unreadable") {
    return (
      <Frame label={label} tone="gap" value="Not modelled">
        {projection.labels.join(" and ")} could not be read as a rate. An empty or unparsable
        box is a figure nobody has stated, not a zero — so nothing is projected from it.
      </Frame>
    )
  }

  if (projection.state === "unmodelled") {
    return (
      <Frame label={label} tone="gap" value="Not modelled">
        No sensitivity has been fitted for {projection.labels.join(" or ")}, so the effect of
        changing it is unknown rather than nil. Reporting the anchor unchanged would claim your
        change made no difference — a measurement nobody took.
      </Frame>
    )
  }

  const extrapolating = projection.extrapolated.length > 0
  return (
    <Frame
      label={label}
      tone={extrapolating ? "extrapolated" : "modelled"}
      value={`${projection.low.toFixed(0)}–${projection.high.toFixed(0)}%`}
      badge={extrapolating ? "Extrapolated" : "Modelled"}
    >
      {/* Prints the arithmetic: anchor, net movement, and the widening — so the
          reader can reproduce the headline instead of taking it on trust. */}
      {artifact.projection.low}–{artifact.projection.high}% measured on the agent&apos;s bundle,{" "}
      {projection.netPoints >= 0 ? "+" : "−"}
      {Math.abs(projection.netPoints).toFixed(1)} pts from your changes, band widened{" "}
      {projection.widening.toFixed(1)} pts for distance from the rates comparables were priced at.
      {extrapolating &&
        // Starts a sentence, so the first label keeps its capital — the others
        // are lowercased mid-list.
        ` ${projection.extrapolated
          .map((d, i) => (i === 0 ? d.label : d.label.toLowerCase()))
          .join(" and ")} ${projection.extrapolated.length === 1 ? "sits" : "sit"} outside that set entirely, so this runs the curve past its last observation.`}
    </Frame>
  )
}

function Frame({
  label,
  value,
  tone,
  badge,
  children,
}: {
  label: string
  value: string
  tone: "measured" | "modelled" | "extrapolated" | "gap"
  badge?: string
  children: React.ReactNode
}) {
  const style = {
    measured: "border-primary/40 bg-primary/[0.05]",
    modelled: "border-primary/30 bg-primary/[0.03] border-dashed",
    extrapolated: "border-warning/45 bg-warning/[0.06] border-dashed",
    gap: "border-border border-dashed bg-muted/25",
  }[tone]
  return (
    <div className={cn("mt-2.5 rounded-xl border p-3", style)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
          {badge && (
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-normal",
                tone === "extrapolated"
                  ? "bg-warning/20 text-warning-foreground"
                  : "bg-primary/15 text-primary",
              )}
            >
              {badge}
            </span>
          )}
        </p>
        <p
          className={cn(
            "font-mono text-base font-semibold tabular-nums",
            tone === "gap" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {value}
        </p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}

function TariffView({ artifact }: { artifact: Extract<Artifact, { kind: "tariff" }> }) {
  // Real inputs, not a disclosure. Pricing is the one lane step with no external
  // authority behind it — the rate is the acquirer's own commercial call — so a
  // read-only box under the words "every line is yours to overrule" was a
  // capability claimed in prose and denied by the interface.
  //
  // Keyed by label and held OUTSIDE the artefact: the artefact is the record of
  // what the AGENT recommended, and overwriting it would destroy the evidence of
  // what was proposed the moment someone disagreed with it.
  const [rates, setRates] = useState<Record<string, string>>({})
  const valueOf = (r: { label: string; value: string }) => rates[r.label] ?? r.value
  const projection = projectSignUp(artifact.rows, rates, artifact.projection)

  return (
    <Shell title={artifact.title} note={artifact.note} editable={!!artifact.editable}>
      {artifact.editable && (
        <p className="mb-2.5 rounded-lg border border-border bg-white/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {artifact.editable.where}
        </p>
      )}

      <div className="space-y-1.5">
        {artifact.rows.map((r) => {
          const v = valueOf(r)
          const isChanged = v.trim() !== r.value.trim()
          return (
            <div
              key={r.label}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-3 transition-colors",
                isChanged ? "border-primary/45 bg-primary/[0.04]" : "border-border/70 bg-white/60",
              )}
            >
              <label
                htmlFor={`rate-${r.label}`}
                className="min-w-0 flex-1 text-sm font-medium text-foreground"
              >
                {r.label}
              </label>
              <input
                id={`rate-${r.label}`}
                value={v}
                onChange={(e) => setRates((s) => ({ ...s, [r.label]: e.target.value }))}
                inputMode="decimal"
                spellCheck={false}
                aria-label={`${r.label} rate`}
                // Free text, not a number field: the card mixes currency and
                // percentages, and forcing a unit model here would either strip
                // the acquirer's own notation or refuse a rate they can charge.
                className="w-24 rounded-lg border border-border bg-white px-2 py-1 text-right font-mono text-sm font-semibold tabular-nums text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <p className="w-full text-xs leading-relaxed text-muted-foreground">{r.basis}</p>
              {isChanged && (
                <p className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
                  {/* The agent's figure survives the disagreement. */}
                  <span>
                    Agent proposed{" "}
                    <span className="font-mono font-semibold text-foreground">{r.value}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setRates((s) => {
                        const next = { ...s }
                        delete next[r.label]
                        return next
                      })
                    }
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Restore
                  </button>
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* The consequence of the bundle. Recomputed live off the typed rates, but
          the MEASURED anchor and the MODELLED result are never rendered the same
          way: one is comparable merchants actually priced on this card, the other
          is that measurement pushed along a stated sensitivity. The arithmetic is
          printed so the figure can be checked rather than trusted. */}
      <TariffProjection artifact={artifact} projection={projection} />
      {projection.state === "modelled" && (
        <ul className="mt-1.5 space-y-1">
          {projection.deltas.map((d) => (
            <li
              key={d.label}
              className="flex flex-wrap items-baseline gap-x-2 text-[11px] leading-relaxed text-muted-foreground"
            >
              <span className="font-medium text-foreground">{d.label}</span>
              <span className="font-mono tabular-nums">
                {formatRate(d.from, d.unit)} → {formatRate(d.to, d.unit)}
              </span>
              <span
                className={cn(
                  "font-mono font-semibold tabular-nums",
                  d.points >= 0 ? "text-success" : "text-destructive",
                )}
              >
                {d.points >= 0 ? "+" : "−"}
                {Math.abs(d.points).toFixed(1)} pts
              </span>
              {d.extrapolated && (
                <span className="text-warning">
                  outside the comparable span ({formatRate(d.supported[0], d.unit)}–
                  {formatRate(d.supported[1], d.unit)})
                </span>
              )}
              <span className="w-full text-muted-foreground/80">{d.note}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">{artifact.illustrative}</p>
    </Shell>
  )
}

const expValue = (n: number, unit: "pct" | "gbp") =>
  unit === "gbp" ? `£${n.toLocaleString("en-GB")}` : `${n}%`
const expBand = (b: [number, number], unit: "pct" | "gbp") =>
  `${expValue(b[0], unit)}–${expValue(b[1], unit)}`

/**
 * A proposed test the acquirer can actually answer.
 *
 * This was a static table, and the objection was exactly right: the agent
 * proposed a test and there was nothing to click. A proposal with no way to
 * accept or decline it is not a recommendation, it is a remark.
 *
 * The three options are deliberately NOT "run / don't run". Declining a test
 * is not a decision — you still have to price the merchant — so the two ways
 * of declining are the two prices, stated as what they are.
 */
function ExperimentView({ artifact }: { artifact: Extract<Artifact, { kind: "experiment" }> }) {
  // Held outside the artefact, like the tariff rates: the artefact records what
  // the AGENT proposed, and a choice that overwrote it would erase the proposal
  // the moment someone disagreed with it.
  const [choice, setChoice] = useState<"A" | "B" | "test" | null>(null)
  const reading = useMemo(() => experimentReading(artifact), [artifact])

  const { separated, unresolved, earliestCallMonths } = reading
  const underTest = artifact.merchantsPerWeek * 52

  const options = [
    ...artifact.variants.map((v) => ({
      key: v.key as "A" | "B" | "test",
      title: `Ship ${v.key} — ${v.label.toLowerCase()}`,
      terms: v.terms.map((t) => `${t.label} ${t.value}`).join(" · "),
      recommended: false,
      // Naming the disagreement rather than letting two cards quietly hold
      // different rates for the same merchant.
      commits: v.matchesRecommendedTariff
        ? "Prices every merchant of this type on these rates. Matches the tariff recommended above, and leaves the revenue question unresolved."
        : `Prices every merchant of this type on these rates. Overrules the tariff recommended above — those rates become ${v.terms
            .map((t) => `${t.label.toLowerCase()} ${t.value}`)
            .join(" and ")} — and leaves the revenue question unresolved.`,
    })),
    {
      key: "test" as const,
      title: `Run the ${artifact.split} test`,
      terms: `Both tariffs live · ${artifact.merchantsPerWeek} merchants a week enter the split`,
      recommended: true,
      commits: earliestCallMonths
        ? `Resolves ${unresolved
            .map((m) => m.label.toLowerCase())
            .join(" and ")}, but cannot be read for ${earliestCallMonths} months — about ${underTest.toLocaleString(
            "en-GB",
          )} merchants priced under the split before the first reading (${artifact.merchantsPerWeek} a week × 52).`
        : // Not reachable on today's numbers, but a test that resolves nothing
          // should say so rather than render an empty consequence.
          "Buys nothing the model cannot already state — every metric below is already separated.",
    },
  ]

  const chosen = options.find((o) => o.key === choice)

  return (
    <Shell title={artifact.title} note={artifact.note}>
      {/* WHAT THE MODEL CAN AND CANNOT SAY, one card per metric.
      
          Built as a 4-column table first, and the screenshot killed it: the
          inspector is a ~380px column, so Metric / A / B / verdict got ~95px
          each and the verdict wrapped to one word per line. A comparison
          nobody can read is not a comparison. Cards give each metric the full
          width and stack the two bands, which also lets the verdict sit under
          the figures it is about rather than in a column beside them. */}
      <div className="space-y-1.5">
        {artifact.metrics.map((m) => {
          const ov = metricOverlap(m)
          // Only claim a leader where the bands are actually disjoint. Marking
          // one side ahead on an overlapping metric would assert exactly the
          // thing the test exists to find out.
          const leader = ov ? null : m.a[0] > m.b[0] ? "A" : "B"
          return (
            <div key={m.key} className="rounded-xl border border-border/70 bg-white/60 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-foreground">{m.label}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    ov ? "bg-warning/15 text-warning-foreground" : "bg-success/15 text-success",
                  )}
                >
                  {ov ? "Unresolved" : "Separated"}
                </span>
                <span className="w-full text-[11px] text-muted-foreground">
                  {m.horizonMonths === 0
                    ? "Observable at the point of sale"
                    : `Cannot be read for ${m.horizonMonths} months`}
                </span>
              </div>

              <div className="mt-2 space-y-1">
                {artifact.variants.map((v) => {
                  const band = v.key === "A" ? m.a : m.b
                  const ahead = leader === v.key
                  return (
                    <div
                      key={v.key}
                      className="flex items-baseline justify-between gap-3 border-t border-border/40 pt-1 first:border-0 first:pt-0"
                    >
                      <span className="min-w-0 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{v.key}</span> —{" "}
                        {v.label.toLowerCase()}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-1.5">
                        <span
                          className={cn(
                            "font-mono text-sm tabular-nums",
                            ahead ? "font-semibold text-foreground" : "text-foreground",
                          )}
                        >
                          {expBand(band, m.unit)}
                        </span>
                        {ahead && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-success">
                            ahead
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {ov ? (
                  <>
                    Bands overlap{" "}
                    <span className="font-mono tabular-nums text-foreground">
                      {expBand([ov.lo, ov.hi], m.unit)}
                    </span>{" "}
                    — {expValue(ov.width, m.unit)} wide, {Math.round(ov.shareOfA * 100)}% of A{"'"}s
                    range and {Math.round(ov.shareOfB * 100)}% of B{"'"}s. The model cannot separate
                    them.
                  </>
                ) : (
                  <>No overlap. Testing this re-measures something the model already states.</>
                )}
              </p>
            </div>
          )
        })}
      </div>

      {/* The asymmetry IS the argument, so it is stated once in plain words
          rather than left for the reader to assemble from two rows. */}
      {unresolved.length > 0 && separated.length > 0 && (
        <p className="mt-2.5 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Why the agent proposes a test.</span> The
          model already separates {separated.map((m) => m.label.toLowerCase()).join(" and ")}, so
          that question is answered. It cannot separate{" "}
          {unresolved.map((m) => m.label.toLowerCase()).join(" or ")} — and that is the figure the
          commercial case rests on.
        </p>
      )}

      <p className="mt-1.5 flex gap-2 rounded-lg border border-warning/35 bg-warning/[0.07] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <span>
          <span className="font-semibold text-foreground">Cohort not sized.</span>{" "}
          {artifact.cohortGap}
        </span>
      </p>

      {/* THE DECISION. Nothing preselected — a default here would be the app
          choosing the merchant's price and calling it the acquirer's call. */}
      <div className="mt-3.5" role="radiogroup" aria-label="Pricing decision">
        {/* Names the commit surface. Without this the radio reads as the
            decision itself, when the binding act is the Set pricing handoff
            below — and a control that looks like it has committed something it
            hasn't is worse than one that looks inert. */}
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your call{" "}
          <span className="font-normal normal-case tracking-normal text-muted-foreground/80">
            — committed at Set pricing below
          </span>
        </p>
        <div className="space-y-1.5">
          {options.map((o) => {
            const active = choice === o.key
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setChoice(o.key)}
                className={cn(
                  "w-full rounded-xl border p-3 text-left transition-colors",
                  active
                    ? "border-primary/55 bg-primary/[0.06]"
                    : "border-border/70 bg-white/60 hover:border-border hover:bg-white",
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors",
                      active ? "border-primary bg-primary" : "border-border bg-white",
                    )}
                  >
                    {active && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{o.title}</span>
                  {o.recommended && (
                    <span className="rounded bg-foreground/8 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
                      Agent{"'"}s proposal
                    </span>
                  )}
                </span>
                <span className="mt-1 block pl-6 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {o.terms}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* The consequence of the choice, and a way back out of it. */}
      {chosen && (
        <div className="mt-2 rounded-xl border border-primary/40 bg-primary/[0.04] p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">{chosen.title}.</span> {chosen.commits}
          </p>
          <p className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              The agent proposed{" "}
              <span className="font-semibold text-foreground">running the test</span>
            </span>
            <button
              type="button"
              onClick={() => setChoice(null)}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </p>
        </div>
      )}

      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {artifact.illustrative}
      </p>
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

function DocumentView({
  artifact,
  release,
}: {
  artifact: Extract<Artifact, { kind: "document" }>
  release: ReleaseSlot
}) {
  const drafted = artifact.lines.join("\n")
  // Only a document that GOES somewhere is editable. A certificate or a
  // retained file is a record of what happened, and letting someone retype it
  // would turn evidence into a notepad.
  const sendable = artifact.handoff !== undefined
  const [body, setBody] = useState<string | null>(null)
  const current = body ?? drafted
  const isChanged = current.trim() !== drafted.trim()
  const readiness: PushReadiness = {
    edited: isChanged ? ["Notice text"] : [],
    gaps: [],
    // An empty notice is not a short notice. Sending one would tell the
    // merchant nothing while recording that they had been told.
    blockers: current.trim() === "" ? ["The notice is empty — write it, or restore the draft"] : [],
  }

  return (
    <Shell title={artifact.title} note={artifact.note} editable={sendable}>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {artifact.filename}
            </span>
          </span>
          {isChanged && (
            <button
              type="button"
              onClick={() => setBody(null)}
              className="shrink-0 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
            >
              Restore the agent&apos;s draft
            </button>
          )}
        </div>
        {sendable ? (
          <textarea
            value={current}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            rows={Math.max(10, current.split("\n").length + 1)}
            aria-label={`${artifact.title} text`}
            className="w-full resize-y bg-transparent px-3 py-3 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:bg-white"
          />
        ) : (
          <pre className="whitespace-pre-wrap px-3 py-3 font-mono text-[11px] leading-relaxed text-foreground">
            {drafted}
          </pre>
        )}
      </div>

      {artifact.handoff && (
        <HandoffFooter
          handoff={artifact.handoff}
          readiness={readiness}
          signature={current}
          slot={release.slot}
          releases={release.releases}
          onReleases={release.onReleases}
        />
      )}
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

  const release: ReleaseSlot = {
    slot: releaseKey(props.stepId, props.taskIndex),
    releases: props.releases,
    onReleases: props.onReleases,
  }

  switch (artifact.kind) {
    case "basket":
      return <BasketView {...props} title={artifact.title} note={artifact.note} />
    case "stock":
      return <StockView {...props} title={artifact.title} note={artifact.note} />
    case "delivery":
      return <DeliveryView {...props} title={artifact.title} note={artifact.note} />
    case "consignment":
      return <ConsignmentView {...props} title={artifact.title} note={artifact.note} />
    case "pricing":
      return <PricingView {...props} title={artifact.title} note={artifact.note} />
    case "tariff":
      return <TariffView artifact={artifact} />
    case "records":
      return <RecordsView artifact={artifact} release={release} />
    case "dossier":
      return <DossierView artifact={artifact} />
    case "checks":
      return <ChecksView artifact={artifact} />
    case "txns":
      return <TxnsView artifact={artifact} />
    case "table":
      return <TableView artifact={artifact} />
    case "experiment":
      return <ExperimentView artifact={artifact} />
    case "document":
      return <DocumentView artifact={artifact} release={release} />
    case "acceptance":
      return (
        <Shell title={artifact.title} note={artifact.note}>
          <SchemeDesk
            merchant={props.merchant}
            state={props.acceptance}
            onState={props.onAcceptance}
          />
        </Shell>
      )
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
          <BrandStudio
            merchant={props.merchant}
            theme={props.theme}
            onTheme={props.onTheme}
            focus={artifact.focus}
          />
        </Shell>
      )
  }
}
