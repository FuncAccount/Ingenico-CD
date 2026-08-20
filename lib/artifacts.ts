// Artefacts — the things the agent actually PRODUCES at each step.
//
// A task that says "priced the order" without showing a price is an
// unverifiable claim. Every task therefore resolves to an artefact the
// acquirer can open, read and (where it is theirs to decide) change.
//
// The order artefacts are deliberately ONE model, not four panels: the
// basket feeds stock coverage AND pricing, and the service level feeds
// both the promised date and the shipping line. Change a quantity and
// every downstream figure moves, because none of them are typed by hand.

import { MERCHANTS, type Merchant, type StepId } from "@/lib/acquirer-data"
import { bookPeersByDistance } from "@/lib/comparables"
import { ACQUIRER } from "@/lib/branding"
import { MODELS, configProfile, orderLines, type ModelId } from "@/lib/devices"
// Cyclic with `scheme-acceptance` (it imports `vatFor`/`licenceUnits` from
// here), but only ever used inside function bodies, so both modules are fully
// initialised by the time either call runs. Keep it that way: a top-level
// constant derived from these would evaluate mid-cycle and read `undefined`.
import { defaultAcceptance, liveSchemeLabel } from "@/lib/scheme-acceptance"
import { exceptionOnStep } from "@/lib/exceptions"
import { countryOf, distanceKm } from "@/lib/geo"
import { recordedScore, riskAssessment, SCORE_THE_RISK_TASK, UNDERWRITING_STEP } from "@/lib/underwriting"

/* ------------------------------------------------------------------ money */

// Minor units throughout, so totals are exact integers and never drift.
export type Money = number

export function eur(minor: Money): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(minor / 100)
}

/* --------------------------------------------------------------- catalogue */

export interface Sku {
  sku: string
  name: string
  kind: "terminal" | "accessory" | "licence"
  unit: Money
  portable: boolean
}

export const CATALOGUE: Record<string, Sku> = {
  A920: { sku: "ING-A920", name: "AXIUM A920", kind: "terminal", unit: 34900, portable: true },
  "Move 5000": { sku: "ING-MV5K", name: "Move 5000", kind: "terminal", unit: 29500, portable: true },
  "Desk 5000": { sku: "ING-DK5K", name: "Desk 5000", kind: "terminal", unit: 21900, portable: false },
  softPOS: { sku: "ING-SPOS", name: "softPOS licence (12 mo)", kind: "licence", unit: 4900, portable: false },
  Dock: { sku: "ING-DOCK", name: "Charging dock", kind: "accessory", unit: 4500, portable: false },
  Starter: { sku: "ING-STRT", name: "Starter pack — cables, rolls, SIM", kind: "accessory", unit: 2900, portable: false },
}

export interface BasketLine {
  sku: string
  name: string
  kind: Sku["kind"]
  unit: Money
  qty: number
}

/** Build the basket from the merchant's own device summary, so the order can
 *  never disagree with the record shown everywhere else in the portal. */
export function defaultBasket(merchant: Merchant): BasketLine[] {
  const lines: BasketLine[] = []
  let portableCount = 0

  for (const part of merchant.terminals.split("+")) {
    const text = part.trim()
    const m = text.match(/^(\d+)\s*[x×]\s*(.+)$/i)
    const qty = m ? Number(m[1]) : 1
    const key = (m ? m[2] : text).trim()
    const item = CATALOGUE[key]
    if (!item) continue
    if (item.portable) portableCount += qty
    lines.push({ sku: item.sku, name: item.name, kind: item.kind, unit: item.unit, qty })
  }

  if (portableCount > 0) {
    const d = CATALOGUE.Dock
    lines.push({ sku: d.sku, name: d.name, kind: d.kind, unit: d.unit, qty: portableCount })
  }
  const s = CATALOGUE.Starter
  lines.push({ sku: s.sku, name: s.name, kind: s.kind, unit: s.unit, qty: 1 })
  return lines
}

/* --------------------------------------------------------------- geography */

export interface Geo {
  label: string
  address: string
  lat: number
  lng: number
}

const CITY: Record<string, { lat: number; lng: number }> = {
  "m-atlas": { lat: 53.4808, lng: -2.2426 },
  "m-verde": { lat: 38.7223, lng: -9.1393 },
  "m-nordwind": { lat: 53.5511, lng: 9.9937 },
  "m-solmar": { lat: 36.7213, lng: -4.4214 },
  "m-brightline": { lat: 53.3498, lng: -6.2603 },
  "m-tavo": { lat: 45.4642, lng: 9.19 },
  "m-fjord": { lat: 60.3913, lng: 5.3221 },
  "m-lumen": { lat: 52.3676, lng: 4.9041 },
  "m-cedar": { lat: 55.9533, lng: -3.1883 },
  "m-havenport": { lat: 43.2965, lng: 5.3698 },
  "m-kessler": { lat: 48.7758, lng: 9.1829 },
  "m-marisol": { lat: 39.4699, lng: -0.3763 },
}

const STREET: Record<string, string> = {
  "m-atlas": "18 Tib Street, Northern Quarter",
  "m-verde": "Rua da Prata 62",
  "m-nordwind": "Eppendorfer Landstraße 77",
  "m-solmar": "Paseo Marítimo Pablo Ruiz Picasso 21",
  "m-brightline": "44 Dame Street",
  "m-tavo": "Via Tortona 27",
  "m-fjord": "Torgallmenningen 8",
  "m-lumen": "Overtoom 301",
  "m-cedar": "9 Victoria Street",
  "m-havenport": "Quai du Port 14",
  "m-kessler": "Königstraße 52",
  "m-marisol": "Carrer de Colón 18",
}

export function deliveryGeo(merchant: Merchant): Geo | null {
  const c = CITY[merchant.id]
  if (!c) return null
  return {
    label: merchant.name,
    address: `${STREET[merchant.id] ?? "Address on file"}, ${merchant.location}`,
    ...c,
  }
}

export interface Warehouse {
  id: string
  name: string
  city: string
  lat: number
  lng: number
  onHand: Record<string, number>
}

export const WAREHOUSES: Warehouse[] = [
  {
    id: "dc-rtm",
    name: "Rotterdam DC",
    city: "Rotterdam, NL",
    lat: 51.9244,
    lng: 4.4777,
    onHand: { "ING-A920": 240, "ING-MV5K": 180, "ING-DK5K": 310, "ING-SPOS": 9999, "ING-DOCK": 420, "ING-STRT": 800 },
  },
  {
    id: "dc-mil",
    name: "Milan DC",
    city: "Segrate, IT",
    // The distribution centre sits out by the freight terminal, not on the
    // Duomo — sharing the city coordinate rendered a nonsensical "0 km".
    lat: 45.5045,
    lng: 9.3,
    onHand: { "ING-A920": 6, "ING-MV5K": 44, "ING-DK5K": 90, "ING-SPOS": 9999, "ING-DOCK": 12, "ING-STRT": 210 },
  },
  {
    id: "dc-man",
    name: "Manchester DC",
    city: "Trafford Park, UK",
    lat: 53.4668,
    lng: -2.325,
    onHand: { "ING-A920": 75, "ING-MV5K": 20, "ING-DK5K": 140, "ING-SPOS": 9999, "ING-DOCK": 60, "ING-STRT": 300 },
  },
]

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2)
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

/** Warehouses ranked by real distance from the delivery point, not by a
 *  hand-kept preference list that could silently go stale. */
export function warehousesByDistance(geo: Geo): { wh: Warehouse; distanceKm: number }[] {
  return WAREHOUSES.map((wh) => ({ wh, distanceKm: km(geo, wh) })).sort(
    (a, b) => a.distanceKm - b.distanceKm,
  )
}

/* ------------------------------------------------------------ stock check */

export interface Allocation {
  warehouseId: string
  warehouseName: string
  qty: number
}

export interface StockLine {
  sku: string
  name: string
  need: number
  allocations: Allocation[]
  covered: number
  shortfall: number
}

export interface StockResult {
  lines: StockLine[]
  /** How many distinct sites the order would ship from. */
  sites: number
  shortLines: StockLine[]
}

export function checkStock(lines: BasketLine[], geo: Geo | null): StockResult {
  const ranked = geo ? warehousesByDistance(geo) : WAREHOUSES.map((wh) => ({ wh, distanceKm: 0 }))
  const used = new Set<string>()

  const out: StockLine[] = lines.map((line) => {
    let remaining = line.qty
    const allocations: Allocation[] = []
    for (const { wh } of ranked) {
      if (remaining <= 0) break
      const take = Math.min(remaining, wh.onHand[line.sku] ?? 0)
      if (take <= 0) continue
      allocations.push({ warehouseId: wh.id, warehouseName: wh.name, qty: take })
      used.add(wh.id)
      remaining -= take
    }
    const covered = line.qty - remaining
    return { sku: line.sku, name: line.name, need: line.qty, allocations, covered, shortfall: remaining }
  })

  return { lines: out, sites: used.size, shortLines: out.filter((l) => l.shortfall > 0) }
}

/* --------------------------------------------------------------- delivery */

export interface ServiceLevel {
  id: "standard" | "express"
  label: string
  workingDays: number
  shipping: Money
}

export const SERVICE_LEVELS: ServiceLevel[] = [
  { id: "standard", label: "Standard", workingDays: 3, shipping: 2400 },
  { id: "express", label: "Express", workingDays: 1, shipping: 7900 },
]

function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from)
  let left = days
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) left--
  }
  return d
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export interface DatePromise {
  earliest: Date
  requested: Date
  /** A requested date the network cannot hit is NAMED, never quietly honoured. */
  achievable: boolean
  note: string
  splitDelay: boolean
}

export function promiseDate(
  requestedIso: string,
  service: ServiceLevel,
  stock: StockResult,
  today: Date,
): DatePromise {
  // A split shipment costs a day; a shortfall is not a date problem at all.
  const splitDelay = stock.sites > 1
  const earliest = addWorkingDays(today, service.workingDays + (splitDelay ? 1 : 0))
  const requested = new Date(`${requestedIso}T00:00:00`)
  const achievable = requested.getTime() >= earliest.getTime()
  return {
    earliest,
    requested,
    achievable,
    splitDelay,
    note: achievable
      ? splitDelay
        ? `Shipping from ${stock.sites} sites adds one working day; the requested date still holds.`
        : `${service.label} delivery from a single site.`
      : `${service.label} cannot reach the requested date. The earliest the network can commit to is ${fmtDate(earliest)}.`,
  }
}

/* ---------------------------------------------------------------- pricing */

export const RATE_CARD = { id: "NG-2024", hardwareDiscount: 0.12, vat: 0.2 }

export interface PricedLine extends BasketLine {
  lineTotal: Money
}

export interface Pricing {
  lines: PricedLine[]
  subtotal: Money
  discount: Money
  shipping: Money
  net: Money
  vat: Money
  total: Money
  /** The arithmetic, printed, so the total can be checked rather than trusted. */
  workings: string
}

export function priceOrder(lines: BasketLine[], service: ServiceLevel): Pricing {
  const priced: PricedLine[] = lines.map((l) => ({ ...l, lineTotal: l.unit * l.qty }))
  const subtotal = priced.reduce((s, l) => s + l.lineTotal, 0)
  // The contracted discount applies to hardware only, never to licences.
  const hardware = priced
    .filter((l) => l.kind === "terminal" || l.kind === "accessory")
    .reduce((s, l) => s + l.lineTotal, 0)
  const discount = Math.round(hardware * RATE_CARD.hardwareDiscount)
  const shipping = service.shipping
  const net = subtotal - discount + shipping
  const vat = Math.round(net * RATE_CARD.vat)
  const total = net + vat
  return {
    lines: priced,
    subtotal,
    discount,
    shipping,
    net,
    vat,
    total,
    workings: `${eur(subtotal)} − ${eur(discount)} + ${eur(shipping)} = ${eur(net)} net · VAT ${
      RATE_CARD.vat * 100
    }% ${eur(vat)} · total ${eur(total)}`,
  }
}

/* ------------------------------------------------------------ device units */

/**
 * The order expanded to individual units, because steps 5–9 act on DEVICES,
 * not on order lines: a profile, a test, a label and an activation each belong
 * to one unit. A quantity cannot carry a TID.
 *
 * `physical` is the load-bearing field. A softPOS licence gets a profile, a
 * configuration and an activation — it runs on the merchant's own handset —
 * but it has no parcel, no label and no peripherals. Artefacts that counted
 * every unit as a box were the reason the trace claimed "4 labels" for an
 * order carrying three terminals and one licence.
 */
export interface DeviceUnit {
  /** 1-based, in order-line order. */
  n: number
  model: ModelId
  label: string
  physical: boolean
  /** Deterministic from the merchant and position, so the same unit carries
   *  the same identifier on every screen rather than a fresh random one. */
  tid: string
}

function tidBase(merchantId: string): number {
  let h = 0
  for (let i = 0; i < merchantId.length; i++) h = (h * 31 + merchantId.charCodeAt(i)) % 90000
  return 10000 + h
}

export function deviceUnits(merchant: Merchant): DeviceUnit[] {
  const base = tidBase(merchant.id)
  const out: DeviceUnit[] = []
  for (const line of orderLines(merchant)) {
    const model = MODELS[line.model]
    if (!model) continue
    for (let i = 0; i < line.qty; i++) {
      const n = out.length + 1
      out.push({
        n,
        model: line.model,
        label: `${model.label} · unit ${n}`,
        physical: model.physical,
        tid: `T${base + n}`,
      })
    }
  }
  return out
}

export function physicalUnits(merchant: Merchant): DeviceUnit[] {
  return deviceUnits(merchant).filter((u) => u.physical)
}

export function licenceUnits(merchant: Merchant): DeviceUnit[] {
  return deviceUnits(merchant).filter((u) => !u.physical)
}

/** What Ingenico logistics booked. One source, because the carrier name and the
 *  collection reference are quoted by the booking artefact, the trace line AND
 *  the tracking view — three copies of one fact on a single step, which is
 *  exactly how the config record came to list a scheme the acceptance desk
 *  said was off. */
export function consignmentFacts(merchant: Merchant) {
  const geo = deliveryGeo(merchant)
  const nearest = geo ? warehousesByDistance(geo)[0] : null
  return {
    carrier: "DHL Freight",
    collectionRef: `DHL-${tidBase(merchant.id)}`,
    parcels: physicalUnits(merchant).length,
    geo,
    origin: nearest,
  }
}

/** One sentence naming what the licence lines are excluded FROM, used wherever
 *  a physical-only count would otherwise look like a missing device. */
function licenceNote(merchant: Merchant, excludedFrom: string): string {
  const lic = licenceUnits(merchant)
  if (lic.length === 0) return ""
  return ` ${lic.length} softPOS licence${lic.length > 1 ? "s" : ""} ${
    lic.length > 1 ? "are" : "is"
  } not counted here — software on the merchant's own handset has no ${excludedFrom}.`
}

/* --------------------------------------------------------------- artefacts */

export interface RecordRow {
  label: string
  value: string | null
  /** Where the value came from, so a figure is never orphaned from its source. */
  source?: string
  /**
   * For a row with no value: WHO closes the gap and WHEN.
   *
   * A named absence was still only half an answer — "not on file" told the
   * reader something was missing but not whether it was their problem, or
   * whether the pipeline would stall on it. Every gap either resolves later
   * in the flow (`blocking: false`) or needs someone to act now
   * (`blocking: true`), and saying which is the difference between a note
   * and a task.
   */
  resolution?: { owner: string; when: string; blocking: boolean }
}

/**
 * One simulated test transaction against the certification host.
 *
 * A `CheckRow` could not carry this: a failure needs the DECLINE CODE the host
 * actually returned, the cause that code implies, and who clears it. Collapsing
 * those into one `evidence` string is how a demo ends up saying "failed" with
 * no way to tell an operator what to do next — and a red row nobody can act on
 * reads as a broken build rather than a caught defect.
 */
export interface TxnRow {
  ref: string
  kind: string
  unit: string
  amount: string
  state: "pass" | "warn" | "fail"
  /** The host's own verdict — an auth code, or the decline code it returned. */
  result: string
  latencyMs: number
  /** Only on a failure: WHY it declined, distinct from WHAT the host said. */
  cause?: string
  /** Only on a failure: who clears it and what clearing it involves. */
  fix?: { owner: "Ingenico" | "Acquirer" | "Merchant"; action: string; blocking: boolean }
}

export interface CheckRow {
  label: string
  /** `running` is a FOURTH state, not a styling of pass. A check still out with
   *  a provider has no result, and rendering it as a tick would report a
   *  verdict nobody has returned — the whole point of the KYC panel is that the
   *  file progresses while individual checks are still open. */
  state: "pass" | "warn" | "fail" | "running"
  /** What was actually compared — a green tick with no comparison is
   *  decoration. For a `running` row, what is outstanding and with whom. */
  evidence: string
}

import type { Sensitivity } from "./tariff-model"

/** One line of a commercial tariff. */
export interface TariffRow {
  label: string
  value: string
  /** Why the agent landed on it. A rate with no rationale cannot be argued
   *  with, and this is a number the acquirer is expected to overrule. */
  basis: string
  /**
   * How this line moves sign-up, so an overridden card can be re-projected
   * with its arithmetic shown rather than a bare new number.
   *
   * OPTIONAL ON PURPOSE. A line with no fitted sensitivity yields "unmodelled",
   * never a 0-point contribution — reporting that a change had no effect is a
   * measurement, and one nobody took.
   */
  sensitivity?: Sensitivity
}

export interface TableArtifact {
  columns: string[]
  rows: string[][]
}

export type Artifact =
  | { kind: "basket"; title: string; note: string }
  | { kind: "stock"; title: string; note: string }
  | { kind: "delivery"; title: string; note: string }
  /** The ship-stage view of the SAME journey the `delivery` artefact planned —
   *  read-only, because by then the decision is spent and the goods are moving.
   *  A separate kind rather than a flag on `delivery`: the two answer different
   *  questions ("what shall we ask for?" vs "what is Ingenico doing?"), and a
   *  boolean would have left the order-time editor one prop away from
   *  reappearing on a consignment already in transit. */
  | { kind: "consignment"; title: string; note: string }
  | { kind: "pricing"; title: string; note: string }
  /** The MERCHANT's commercial tariff — what they pay to accept payments.
   *
   *  Deliberately NOT the `pricing` kind above, which is the price of the
   *  terminal ORDER. Two different bills to two different payers; sharing a
   *  kind would have put the hardware invoice and the merchant's rate card
   *  behind the same renderer and invited exactly that confusion.
   *
   *  `illustrative` is required, not optional: every figure here is modelled,
   *  and a projection that forgets to say so is read as a quote. */
  | {
      kind: "tariff"
      title: string
      note: string
      rows: TariffRow[]
      /**
       * Pricing is a COMMERCIAL DECISION the acquirer owns outright — unlike a
       * sanctions hit, there is no external authority behind it, so the agent's
       * rate card is a proposal and nothing more. The panel's own note promised
       * "every line is yours to overrule" while offering no way to overrule it:
       * a claim in prose that the interface contradicted.
       *
       * Unlike `records`, this is NOT a pointer at some other system — the rows
       * are genuinely typeable here, and `where` explains what happens to the
       * agent's own figure when you do.
       */
      editable?: { label: string; where: string }
      /**
       * The consequence of the bundle, stated as a RANGE — a single conversion
       * number would imply a precision the model does not have.
       *
       * `low`/`high` are the MEASURED anchor: comparable merchants priced on the
       * agent's own card. They are held as numbers so an overridden card can be
       * re-projected off them, and the result kept visibly distinct from this
       * measurement rather than overwriting it.
       */
      projection: { label: string; low: number; high: number; basis: string }
      illustrative: string
    }
  | {
      kind: "records"
      title: string
      note: string
      rows: RecordRow[]
      /**
       * A record set the acquirer may still change, and the system that owns
       * the change. Scheme acceptance is a COMMERCIAL PERMISSION the acquirer
       * grants — rendering it as a flat read-only list made a decision that is
       * theirs look like something already settled elsewhere. The label names
       * where the edit lands rather than implying this screen writes it.
       */
      editable?: { label: string; where: string }
      /**
       * The verdict the record supports, stated above it.
       *
       * A parameter dump answers "what was sent" but not "did it land" —
       * the two are different claims, and a reader scanning a config list has
       * no way to tell a successful load from a queued one. `detail` must be
       * DERIVED from the rows it summarises, never typed, or the headline can
       * outlive the record beneath it.
       */
      outcome?: { state: "ok" | "warn" | "fail"; headline: string; detail: string }
    }
  | { kind: "checks"; title: string; note: string; rows: CheckRow[] }
  | { kind: "txns"; title: string; note: string; rows: TxnRow[] }
  | { kind: "table"; title: string; note: string; table: TableArtifact }
  | { kind: "document"; title: string; note: string; filename: string; lines: string[] }
  // The three below are decision surfaces rather than read-outs: the acquirer
  // changes something here, and the change is what the sign-off then rests on.
  | { kind: "risk"; title: string; note: string }
  | { kind: "edge"; title: string; note: string }
  /** Scheme acceptance. A decision surface, not a read-out: the acquirer
   *  changes what the merchant may accept, and the change leaves here as an
   *  instruction to Ingenico rather than as configuration. */
  | { kind: "acceptance"; title: string; note: string }
  /** `focus` says WHICH part of the brand studio this task produced. Without
   *  it all three branding tasks rendered the identical studio — same
   *  controls, same mockups — so the journey looked like it had stalled on one
   *  screen and there was no way to tell what any individual task had done. */
  | { kind: "brand"; title: string; note: string; focus: BrandFocus }

/**
 * Which face of the brand studio a task is answerable for.
 *
 *  - `assets` — what the merchant actually supplied, and what is missing.
 *  - `theme`  — the editable design and its live proof on the device.
 *  - `checks` — the rules the design must pass before it can ship.
 */
export type BrandFocus = "assets" | "theme" | "checks"

/** The console line for a task, derived from the same numbers the artefact
 *  renders. Hand-written trace text drifts: the stock line claimed "4× dock"
 *  while the basket beneath it showed 2. Returning null falls back to the
 *  static line, which is correct for steps with no live figures. */
export function traceFor(
  stepId: StepId,
  taskIndex: number,
  merchant: Merchant,
  lines: BasketLine[],
  serviceId: ServiceLevel["id"],
): string | null {
  const service = SERVICE_LEVELS.find((s) => s.id === serviceId)!
  const active = lines.filter((l) => l.qty > 0)
  const geo = deliveryGeo(merchant)

  switch (`${stepId}.${taskIndex}`) {
    case "1.0":
      return `intake.parse → sector=${merchant.sector} region=${merchant.location.split(", ").pop()} volume_band=${merchant.size}`
    case "1.1": {
      // Reads the SAME selection the table renders. Counting every merchant of
      // this sector in any country made the trace contradict the table above
      // it — and a trace line exists to let someone check the result, so a
      // trace that disagrees with its own artifact is worse than none.
      const { peers, home, crossBorderOnly } = bookPeersByDistance(
        merchant.location,
        merchant.sector,
        distanceKm,
      )
      const counts = peers.map((p) => p.m.terminalCount).sort((a, b) => a - b)
      const median = counts.length
        ? counts.length % 2
          ? counts[(counts.length - 1) / 2]
          : (counts[counts.length / 2 - 1] + counts[counts.length / 2]) / 2
        : null
      // `crossBorderOnly` is also true when there are no peers AT ALL, so
      // reading it directly printed "0 merchants, cross-border" — naming a
      // scope for rows that do not exist. No peers is its own state.
      const scope =
        peers.length === 0
          ? "no comparator in any market"
          : crossBorderOnly
            ? "cross-border"
            : `geo=${home}`
      return `match.similar → ${peers.length} live ${merchant.sector.toLowerCase()} merchants, ${scope}${
        median === null ? ", no median available" : `, median ${median} terminals`
      }`
    }
    // Derived for the same reason as the risk line below: the pipeline default
    // reads "6 docs, 18 fields, 0 inconsistencies ok" — a clean bill of health
    // for a file that is two documents short, printed one line above the halt.
    case "2.2": {
      const missing = merchant.underwriting?.documentsOutstanding?.length ?? 0
      if (missing === 0) return null
      const parsed = Number(merchant.underwriting?.documents.match(/^(\d+)/)?.[1] ?? NaN)
      const total = Number(merchant.underwriting?.documents.match(/of (\d+)/)?.[1] ?? NaN)
      const counts = Number.isFinite(parsed) && Number.isFinite(total) ? `${parsed}/${total}` : "partial"
      return `docai.parse → ${counts} docs parsed, ${missing} missing — set incomplete`
    }
    // Derived, not typed. The static line said "18 / 100" and would have gone
    // on saying it regardless of what the factor table underneath computed.
    case "2.3": {
      const a = riskAssessment(merchant)
      // A refusal is a real result and belongs in the trace as one. Printing
      // "0 / 100 band=ELEVATED" from the placeholder fields would be the
      // console inventing the very score the model declined to produce.
      if (a.blocked) {
        return `risk.score → HALTED  ${a.blocked.missing.length} mandatory document(s) outstanding`
      }
      return `risk.score → ${a.score} / 100  band=${a.band.toUpperCase()}  factors=${a.factors.length}`
    }
    case "2.4":
      return merchant.underwriting?.edgeCase
        ? "policy.flag → 1 item escalated, awaiting your determination"
        : "policy.flag → no items outside policy"
    /* Counted off the artefact this task actually produces. The typed line
     * said "14/14 fields populated, 0 gaps" while the record beneath it
     * carried two deliberate gaps — the trace was contradicting its own
     * artefact, and claiming completeness is the worst thing to be wrong
     * about on a form somebody is about to sign. */
    case "1.3": {
      const art = artifactFor(1, 3, merchant)
      if (art?.kind !== "records") return null
      const filled = art.rows.filter((r) => r.value !== null).length
      const gaps = art.rows.length - filled
      return `application.draft → ${filled}/${art.rows.length} fields populated, ${gaps} awaiting downstream`
    }
    case "1.2":
    case "3.0":
      return `order.build → ${active.map((l) => `${l.qty}× ${l.name}`).join(", ")}`
    case "3.1": {
      const stock = checkStock(active, geo)
      return stock.shortLines.length
        ? `availability.confirm → ${stock.shortLines.length} line(s) part-supplied, balance to follow`
        : `availability.confirm → all ${active.length} line(s) available in full`
    }
    case "3.2":
      return geo
        ? `logistics.validate → ${geo.address} serviceable, ${service.label.toLowerCase()} ${service.workingDays}d`
        : `logistics.validate → no delivery point on file`
    case "3.3": {
      const p = priceOrder(lines, service)
      return `pricing.apply → rate card ${RATE_CARD.id}, total ${eur(p.total)}`
    }

    /* Steps 5-9 act on units, and the static lines all quoted a single count
     * for both. An order of three terminals plus a softPOS licence carries
     * four profiles but only three parcels, so a hard-coded "4 labels" was
     * shipping a box that does not exist. */
    case "5.0":
      return `profile.generate → ${deviceUnits(merchant).length} profiles created`
    case "5.1":
      // Was `scheme.enable → Visa, MC, Amex…`, which claimed the agent had
      // switched acceptance on. It reads the current position; widening it is
      // a commercial decision the acquirer instructs Ingenico to action.
      return `scheme.read → live acceptance listed, ${
        licenceUnits(merchant).length ? "softPOS licensed" : "no softPOS licence"
      }`
    case "5.2": {
      const art = artifactFor(5, 2, merchant)
      if (art?.kind !== "records") return null
      // Quote the artefact's own verdict. A trace that says "loaded" while the
      // record beneath it reports gaps is the contradiction this step is most
      // prone to, since the trace is what scrolls past during the run.
      const settled = art.rows.filter((r) => r.value !== null && r.value !== "").length
      return `config.load → ${settled}/${art.rows.length} parameters accepted on ${deviceUnits(merchant).length} profiles`
    }
    case "5.3": {
      // Was the literal `build.sign → bundle signed, checksum verified ok`,
      // which attested to a checksum it never named — and would have gone on
      // saying "ok" whatever the bundle contained. Quote the real digest.
      const art = artifactFor(5, 3, merchant)
      if (art?.kind !== "records") return null
      const sum = art.rows.find((r) => r.label === "Checksum")?.value
      return `build.sign → ${deviceUnits(merchant).length} profiles sealed, ${sum ?? "checksum not recorded"}`
    }
    case "6.0": {
      const n = physicalUnits(merchant).length
      // "0/0 online" reads as a completed check. There was no check.
      return n === 0 ? "test.connect → skipped, no hardware on this order" : `test.connect → ${n}/${n} terminals online`
    }
    // Counted off the run, not typed. The old lines said "refund ok" and
    // "certificates written" — both would now contradict the artefact directly
    // beneath them, which carries a declined refund and withheld certificates.
    case "6.1": {
      const art = artifactFor(6, 1, merchant)
      if (art?.kind !== "txns") return null
      const failed = art.rows.filter((r) => r.state === "fail")
      const warned = art.rows.filter((r) => r.state === "warn").length
      return failed.length
        ? `test.txn → ${art.rows.length} run, ${failed.length} declined (${failed[0].ref} code 58), ${warned} above target`
        : `test.txn → ${art.rows.length} run, all approved, ${warned} above target`
    }
    case "6.3": {
      const txns = artifactFor(6, 1, merchant)
      const blocked = txns?.kind === "txns" && txns.rows.some((r) => r.state === "fail")
      const n = deviceUnits(merchant).length
      return blocked
        ? `cert.issue → withheld, 0/${n} certified while TXN-0003 is open`
        : `cert.issue → ${n} certificates written`
    }
    case "7.0":
    case "7.1":
    case "7.2":
    case "7.3": {
      const n = physicalUnits(merchant).length
      if (n === 0) return "ship.skip → software-only order, nothing to despatch"
      if (taskIndex === 0)
        return `ship.book → carrier=${consignmentFacts(merchant).carrier}, ${n} parcel(s), pickup booked`
      if (taskIndex === 1) return `label.print → ${n} labels, 1 manifest`
      if (taskIndex === 2) return `dispatch.confirm → ${n} parcels in transit`
      return `track.notify → merchant emailed tracking for ${n} parcel(s)`
    }
    case "8.0":
      // "delivery confirmed" is a carrier event, and no carrier was involved
      // on a software-only order. The trigger has to be named for what it was.
      return physicalUnits(merchant).length === 0
        ? "install.detect → licence issued, guide sent"
        : "install.detect → delivery confirmed, guide sent"
    case "8.1":
      return `guide.run → locale=${localeFor(merchant) ?? "not in the rules table"}, ${
        deviceUnits(merchant).length
      } devices paired`
    case "8.2": {
      const n = deviceUnits(merchant).length
      const live = merchant.currentStep > 8 || merchant.status === "Live"
      return live ? `activate.device → ${n}/${n} active` : `activate.device → 1/${n} active, ${n - 1} pending`
    }
    case "9.0":
      return merchant.status === "Live"
        ? "stream.watch → first live payment €48.00 detected ok"
        : "stream.watch → no live payment observed yet"

    default:
      return null
  }
}

/* Localisation follows the merchant's country, so it is derived from the
 * address rather than typed per merchant — a hard-coded "de-DE, VAT 19%" was
 * being shown for merchants in Ireland and Norway. */
/* Keyed on the ISO code the addresses actually end in ("Berlin, DE"), not on
 * full country names. The table was written against "Germany" and every
 * merchant location ends in a code, so EVERY lookup missed and all 24
 * merchants silently rendered a blank locale and VAT treatment. A missing
 * entry is meant to be the rare honest gap, not the universal case. */
const COUNTRY_RULES: Record<string, { locale: string; vat: string }> = {
  UK: { locale: "en-GB", vat: "VAT 20%" },
  IE: { locale: "en-IE", vat: "VAT 23%" },
  DE: { locale: "de-DE", vat: "VAT 19% (USt.)" },
  FR: { locale: "fr-FR", vat: "TVA 20%" },
  ES: { locale: "es-ES", vat: "IVA 21%" },
  IT: { locale: "it-IT", vat: "IVA 22%" },
  PT: { locale: "pt-PT", vat: "IVA 23%" },
  NL: { locale: "nl-NL", vat: "BTW 21%" },
  NO: { locale: "nb-NO", vat: "MVA 25%" },
  AT: { locale: "de-AT", vat: "USt. 20%" },
  EE: { locale: "et-EE", vat: "KM 22%" },
  CZ: { locale: "cs-CZ", vat: "DPH 21%" },
}

export function localeFor(merchant: Merchant): string | null {
  return COUNTRY_RULES[countryOf(merchant.location)]?.locale ?? null
}

/**
 * The verdict an artefact reached, if it reached one.
 *
 * Exists so the task row and the open panel read the SAME sentence: the row
 * used to name the artefact and nothing else, so "did the load work?" could
 * only be answered by opening it — which is what prompted this. Centralised
 * because "which artefact kinds carry a verdict" is one fact, and a second
 * copy of that list in the row renderer would drift the first time a kind
 * gained an outcome.
 */
export function artifactOutcome(
  a: Artifact | null | undefined,
): { state: "ok" | "warn" | "fail"; headline: string; detail: string } | undefined {
  return a?.kind === "records" ? a.outcome : undefined
}

export function vatFor(merchant: Merchant): string | null {
  return COUNTRY_RULES[countryOf(merchant.location)]?.vat ?? null
}

/**
 * The artefact for a task that CANNOT have run, on an order with no hardware.
 *
 * This is not the same as a task that failed, and it is emphatically not the
 * same as a task that passed: "0 of 0 parcels scanned" is a green tick over a
 * check that never took place, which is the worst of the three to be wrong
 * about. The absence is named, the reason is a standing property of the order
 * rather than a fault, and the work that DID happen is pointed at.
 */
function softwareOnly(merchant: Merchant, subject: "connectivity" | "peripherals" | "shipment"): Artifact {
  const lic = licenceUnits(merchant)
  const where =
    subject === "shipment"
      ? "There is nothing to pack, label, collect or track."
      : subject === "connectivity"
        ? "The link belongs to the merchant's own handset and its mobile network — it is not ours to test."
        : "There is no printer, reader or PIN pad on this order."
  return {
    kind: "records",
    title: subject === "shipment" ? "No shipment on this order" : `No ${subject} to report`,
    note: `${merchant.name} ordered software only. ${where} This step is skipped by construction, not pending.`,
    rows: [
      { label: "Physical units", value: "0", source: "counted from the order" },
      { label: "softPOS licences", value: String(lic.length), source: "licence lines on this order" },
      {
        label: subject === "shipment" ? "Parcels" : subject === "connectivity" ? "Terminals on our network" : "Peripherals",
        value: null,
        source: "none exist — this is an absence, not a zero result",
      },
      {
        label: "Where the work happened instead",
        value:
          subject === "shipment"
            ? "Step 08 — the merchant installs the app on their own device"
            : "Step 06 · Test transactions — the licence still transacts and is tested",
        source: "pipeline",
      },
    ],
  }
}

/**
 * Tasks that cannot run for this merchant at all.
 *
 * A skipped task is not a completed one. Marking "Print labels" done, with a
 * green tick, on an order that has nothing to label contradicts the artefact
 * sitting immediately beside it — and a tick is the strongest claim the row
 * can make. The step still shows every task, because hiding them would leave
 * the reader unable to tell a skipped step from an unbuilt one.
 */
export function taskSkipped(stepId: StepId, taskIndex: number, merchant: Merchant): boolean {
  if (physicalUnits(merchant).length > 0) return false
  if (stepId === 7) return true
  // Connectivity and peripherals are hardware checks; the transaction tests
  // and the certificate are not, and a softPOS licence takes both.
  if (stepId === 6) return taskIndex === 0 || taskIndex === 2
  return false
}

/**
 * The step-08 task descriptions for an order with no hardware.
 *
 * The pipeline copy is written for the common case and says "terminals" three
 * times. On a software-only order those sentences describe work on objects the
 * merchant never received �� and unlike the ship step these tasks DO run, so
 * they cannot simply be skipped. Only the wording is wrong, so only the
 * wording is replaced.
 */
const SOFTWARE_ONLY_DETAIL: Partial<Record<string, string>> = {
  "8.0": "Notices the licence issued and reaches out to the merchant.",
  "8.1": "Walks the merchant through install and sign-in step by step.",
  "8.2": "Activates the licence against the live host.",
  "8.3": "Runs a €0.01 auth to prove the merchant's phone can transact.",
}

/** The task description for a task ON A GIVEN ORDER. Falls back to the
 *  pipeline's own copy, which is right for every hardware order. */
export function taskDetail(stepId: StepId, taskIndex: number, merchant: Merchant, fallback: string): string {
  if (physicalUnits(merchant).length > 0) return fallback
  return SOFTWARE_ONLY_DETAIL[`${stepId}.${taskIndex}`] ?? fallback
}

/**
 * A finding in a step's own artefacts that stops the step being complete.
 *
 * Running every task is not the same claim as passing. Without this, the Test
 * step reported "Complete · 4/4" directly above a record reading "1 of 5
 * declined — dispatch is held": the badge asserted an outcome its own evidence
 * denied, which is the failure this whole product is meant to prevent. Derived
 * from the artefacts rather than flagged by hand, so a step cannot be marked
 * clean while carrying a blocking decline.
 */
export function blockingFinding(
  stepId: StepId,
  merchant: Merchant,
): { headline: string; detail: string; taskIndex?: number } | null {
  // Underwriting halts at "Score the risk" when a mandatory document is
  // missing. `taskIndex` is carried so the row that REFUSED shows the halt
  // rather than a green tick — running a task and producing its output are
  // different claims, and the tick makes the stronger one.
  if (stepId === UNDERWRITING_STEP) {
    const missing = merchant.underwriting?.documentsOutstanding ?? []
    if (missing.length > 0) {
      return {
        headline: `Risk not scored — ${missing.length} document${missing.length === 1 ? "" : "s"} outstanding`,
        detail:
          "The agent parsed what was supplied and stopped before scoring. It has drafted the request to the merchant; underwriting resumes when the documents land.",
        taskIndex: SCORE_THE_RISK_TASK,
      }
    }
  }
  // Task indices are small and contiguous; 8 covers the longest step.
  for (let t = 0; t < 8; t++) {
    const a = artifactFor(stepId, t, merchant)
    if (a?.kind !== "txns") continue
    const blocking = a.rows.filter((r) => r.state === "fail" && r.fix?.blocking)
    if (blocking.length === 0) continue
    const first = blocking[0]
    return {
      headline: `${blocking.length} of ${a.rows.length} declined`,
      detail: `${first.ref} on ${first.unit} — ${first.result}. ${first.fix!.owner} clears it before this step can pass.`,
    }
  }
  return null
}

/** Resolve the artefact a given task produced. Returning null is a real
 *  answer — some tasks only write to the trace — and the UI says so rather
 *  than rendering an empty panel that looks broken. */
export function artifactFor(
  stepId: StepId,
  taskIndex: number,
  merchant: Merchant,
): Artifact | null {
  const key = `${stepId}.${taskIndex}`
  const uw = merchant.underwriting

  switch (key) {
    /* 01 Submit */
    case "1.0":
      return {
        kind: "records",
        title: "Parsed intake",
        note: "What the agent read out of your submission, before any enrichment.",
        rows: [
          { label: "Legal name", value: merchant.name, source: "your submission" },
          { label: "Sector", value: merchant.sector, source: "normalised from free text" },
          { label: "Location", value: merchant.location, source: "your submission" },
          { label: "Annual card volume", value: merchant.size, source: "banded" },
          { label: "Devices requested", value: merchant.terminals, source: "your submission" },
          {
            label: "Company number",
            value: null,
            source: "not supplied at intake",
            resolution: {
              owner: "Agent",
              when: "looked up at KYC from the registry",
              blocking: false,
            },
          },
        ],
      }
    /* Look-alikes are ranked by SECTOR THEN GEOGRAPHY, not sector alone.
     * Sector-only matching surfaced Málaga and Milan as the closest
     * comparators for a Manchester applicant — same trade, but nothing an
     * underwriter can read across, because acquiring economics, scheme mix
     * and regulator all track the country.
     *
     * Sorting home-first was NOT enough on its own. A fixed `.slice(0, 5)` is
     * a target COUNT, so once the two UK peers were listed it kept taking the
     * next-nearest merchant regardless of country and padded the table out
     * with Galway, Bergen and Innsbruck — 1,390 km from an Edinburgh
     * applicant. The note then rationalised that as "your book holds no
     * closer match", which was false: the closer matches were sitting in the
     * rows above. Cross-border is a FALLBACK for an empty home market, never
     * filler to reach a row count. Same rule as `comparablesFor` in
     * lib/comparables.ts, which the submit screen uses.
     *
     * And the ranking still could not save it while the POPULATION was wrong.
     * This searched `MERCHANTS` — the 19 in-flight applications — where 14 of
     * the 19 were the only merchant of their sector in their country, so a
     * Bergen retailer had no Norwegian peer to find. It now searches
     * `LIVE_BOOK`, the acquirer's live estate, which is both deep enough to
     * answer locally and the population actually being described: merchants
     * running this kit TODAY, which an unapproved application is not. */
    case "1.1": {
      const { home, local, peers, crossBorderOnly } = bookPeersByDistance(
        merchant.location,
        merchant.sector,
        distanceKm,
      )

      /* Three merchants are the only one of their sector in the whole book
       * (Health & Fitness, Leisure, Automotive). They used to render an EMPTY
       * table under a note asserting "every comparator here is cross-border" —
       * a description of rows that do not exist. An absence is not a result:
       * name it instead of drawing an empty frame. */
      if (peers.length === 0) {
        return {
          kind: "records",
          title: "Look-alike merchants in your book",
          note: `Nothing to compare against — this is the only ${merchant.sector.toLowerCase()} merchant in your book. Size the kit from the site survey rather than from a comparator.`,
          rows: [
            {
              label: `Other ${merchant.sector.toLowerCase()} merchants`,
              value: null,
              source: `none in ${home} or any other market you hold`,
            },
          ],
        }
      }

      return {
        kind: "table",
        title: `Look-alike merchants in your book (${peers.length})`,
        note: crossBorderOnly
          ? `Live ${merchant.sector.toLowerCase()} merchants, ranked by distance from ${merchant.location}. Your book holds none in ${home}, so every comparator here is cross-border — read the figures with that in mind.`
          : // State the size of the home-market pool, so a short list reads as
            // "this is all your book holds" rather than a broken filter.
            `Live ${merchant.sector.toLowerCase()} merchants in ${home}, ranked by distance from ${merchant.location}. ${
              local.length > peers.length
                ? `Closest ${peers.length} of ${local.length}.`
                : `Your book holds ${local.length}.`
            } Cross-border merchants are excluded — interchange, scheme mix and regulator all differ, so they do not read across.`,
        table: {
          columns: ["Merchant", "Location", "Distance", "Volume", "Devices"],
          rows: peers.map(({ m, km }) => [
            m.name,
            m.location,
            crossBorderOnly ? `${km} km · cross-border` : `${km} km`,
            m.size,
            m.terminals,
          ]),
        },
      }
    }
    case "1.2":
      return { kind: "basket", title: "Recommended kit", note: "The proposed device mix, priced. Adjust it before it becomes an order." }
    /* The drafted application record. This task used to produce nothing, and
     * the panel said so — but "wrote to the trace" is exactly the claim an
     * acquirer cannot check, on the one task whose whole point is that the
     * agent filled your form for you. Each row names WHERE the value came
     * from, so pre-filled is distinguishable from asserted, and the two fields
     * the agent could not source are carried as named gaps rather than left
     * out (an omission reads as a complete form). */
    case "1.3": {
      const vat = vatFor(merchant)
      return {
        kind: "records",
        title: "Drafted application",
        note: "Written into your CRM, ready for underwriting. Every field is editable — the agent fills it in, it does not commit it.",
        rows: [
          { label: "Legal name", value: merchant.name, source: "your submission" },
          { label: "Trading sector", value: merchant.sector, source: "normalised from free text" },
          { label: "Registered address", value: merchant.location, source: "your submission" },
          { label: "Expected annual volume", value: merchant.size, source: "banded from your submission" },
          { label: "Device count", value: `${merchant.terminalCount}`, source: "derived from the recommended kit" },
          { label: "Tax treatment", value: vat, source: vat ? "derived from country" : "country not in the rules table" },
          {
            label: "Company number",
            value: null,
            source: "retrieved at underwriting, not at intake",
            resolution: {
              owner: "Agent",
              when: "at KYC · Verify the entity",
              blocking: false,
            },
          },
          {
            label: "Settlement account",
            value: null,
            source: "collected from the merchant with the KYB documents",
            resolution: {
              owner: "Merchant",
              // Underwriting owns the single document chase — see the handoff
              // comment on step 2. Pointing this at KYC would name a second,
              // competing request for the same pile of paperwork.
              when: "with the document request at Underwriting",
              blocking: false,
            },
          },
        ],
      }
    }

    /* R1 KYC (id 10) — compliance. Split out of Underwrite, and these two
       screening artefacts came with it: they were always answering "is this
       entity legitimate", never "can we carry the exposure". */
    case "10.0":
      return {
        kind: "checks",
        title: "Entity verification",
        note: "Each check names what it compared, so a pass can be re-run rather than taken on trust.",
        rows: [
          { label: "Registry match", state: uw?.identity ? "pass" : "warn", evidence: uw?.identity ?? "No registry response on file" },
          { label: "Directors", state: "pass", evidence: "All listed directors matched to the filing" },
          { label: "Beneficial ownership", state: uw?.edgeCase ? "warn" : "pass", evidence: uw?.edgeCase ?? "All owners above 25% identified" },
        ],
      }
    case "10.1":
      return {
        kind: "checks",
        title: "Sanctions and PEP screening",
        note: "Run against every beneficial owner above 25%, not just the applicant.",
        rows: [
          { label: "Sanctions", state: "pass", evidence: "EU, OFAC and UK HMT consolidated lists — no match" },
          { label: "PEP", state: "pass", evidence: "No politically exposed person among the named owners" },
        ],
      }
    case "10.2":
      return {
        kind: "checks",
        title: "Identity verification",
        note: "Document-to-person matching for each named owner.",
        rows: [
          { label: "Photo ID", state: "pass", evidence: "2 of 2 owners matched to a valid document" },
          { label: "Address", state: "pass", evidence: "Residential address confirmed against the credit file" },
          {
            label: "Liveness",
            // The one row left OPEN, and the reason this panel exists: the
            // build lane is still moving behind it. A tick here would make the
            // parallel design invisible by showing a lane with nothing left
            // running.
            state: "running",
            evidence: "Second owner's selfie check is with the provider — typically clears within the hour",
          },
        ],
      }
    case "10.3":
      return {
        kind: "checks",
        title: "Adverse media",
        note: "Five-year window. Only material findings are escalated — volume is not evidence.",
        rows: [
          {
            label: "Media scan",
            state: uw?.edgeCase ? "warn" : "pass",
            evidence: uw?.edgeCase ?? "No adverse media returned in the 5-year window",
          },
        ],
      }

    /* R2 Pricing (id 11) — the commercial model. */
    case "11.0":
      return {
        kind: "table",
        title: "Modelled economics",
        note: "Revenue by method at the merchant's expected mix. Modelled from sector benchmarks, not a quote.",
        table: {
          columns: ["Method", "Share of volume", "Rate", "Revenue / yr"],
          rows: [
            ["Card present", "62%", "1.40%", "£20,832"],
            ["Card not present", "9%", "1.75%", "£3,780"],
            ["Wallet", "26%", "0.90%", "£5,616"],
            ["Account-to-account", "3%", "0.35%", "£252"],
            ["Blended", "100%", "1.27%", "£30,480"],
          ],
        },
      }
    case "11.1":
      return {
        kind: "tariff",
        title: "Recommended tariff",
        note: "The bundle the agent would offer this merchant type. Every line is yours to overrule.",
        editable: {
          label: "Set your own rates",
          where:
            "Type over any rate to set your own. The agent proposes from the merchant profile; your figure wins, and its proposal stays on the line so you can see what you moved away from.",
        },
        // Each `supported` span is the range of that rate ACROSS THE COMPARABLE
        // SET, not a policy limit. It is what lets an override say whether it is
        // interpolating between observations or running past the last one.
        rows: [
          {
            label: "Monthly fee",
            value: "£19",
            basis: "Median for single-site hospitality on your book",
            sensitivity: {
              unit: "gbp",
              pointsPerUnit: -0.45,
              supported: [0, 49],
              note: "Recurring fees are discounted against expected turnover, so they bite less per pound than the upfront charge",
            },
          },
          {
            label: "Setup fee",
            value: "£0",
            basis: "Waived — the upfront fee is the sharpest lever on sign-up",
            sensitivity: {
              unit: "gbp",
              pointsPerUnit: -0.55,
              supported: [0, 99],
              note: "The sharpest lever per pound: it lands before the merchant has taken a payment",
            },
          },
          {
            label: "Card present",
            value: "1.40%",
            basis: "Your standard band for this risk category",
            sensitivity: {
              unit: "pct",
              pointsPerUnit: -34,
              supported: [1.1, 1.95],
              note: "Carries most of this segment's volume, so it dominates the headline rate a merchant compares on",
            },
          },
          {
            label: "Card not present",
            value: "1.75%",
            basis: "Higher chargeback exposure on remote sales",
            sensitivity: {
              unit: "pct",
              pointsPerUnit: -12,
              supported: [1.4, 2.4],
              note: "A minority of hospitality volume, and merchants expect a premium on remote sales",
            },
          },
          {
            label: "Wallet",
            value: "0.90%",
            basis: "Lower scheme cost passes through to the merchant",
            sensitivity: {
              unit: "pct",
              pointsPerUnit: -8,
              supported: [0.6, 1.3],
              note: "Rarely quoted in a competitive comparison at this size",
            },
          },
        ],
        projection: {
          label: "Modelled sign-up rate",
          low: 58,
          high: 71,
          basis: "Measured on the rates above, from comparable merchants priced on this bundle. A range, not a point: conversion moves sharply by merchant type.",
        },
        illustrative: "Illustrative. Modelled from comparable merchants — not an offer, and not a commitment to a rate.",
      }
    case "11.2":
      return {
        kind: "table",
        title: "Proposed A/B test",
        note: "Pricing is a speed-versus-risk trade. The agent proposes a test rather than asserting one right answer.",
        table: {
          columns: ["Variant", "Setup fee", "Monthly", "Modelled sign-up", "Modelled 12m revenue"],
          rows: [
            ["A — waive setup", "£0", "£19", "58–71%", "£28,400–£34,700"],
            ["B — charge setup", "£99", "£15", "41–56%", "£24,100–£32,900"],
          ],
        },
      }

    /* R3 Underwriting (id 2) — credit risk. Keeps id 2 through the split, so
       these cases keep their keys; only the TASK INDEXES moved, because the two
       screening tasks left for KYC. */
    case "2.0": {
      const missing = uw?.documentsOutstanding ?? []
      return {
        kind: "records",
        title: "Documents",
        note: "Collected from the merchant and checked for legibility, consistency and expiry.",
        outcome: missing.length
          ? {
              state: "fail",
              headline: `${missing.length} mandatory document${missing.length === 1 ? "" : "s"} outstanding`,
              detail:
                "Underwriting is halted at Score the risk until these arrive. The agent has drafted the request to the merchant — review it below the run.",
            }
          : undefined,
        rows: [
          { label: "Documents received", value: uw?.documents ?? null, source: "merchant upload" },
          // Each named on its own row. A count cannot be chased, and a reader
          // cannot tell from "2 outstanding" whether the gap is clerical or
          // the reason the ownership chain is unknown.
          // The DOCUMENT is the label. Rows are keyed by label, so a shared
          // "Outstanding" label collided in React and, worse, buried the one
          // thing the reader needs — which document — in the source note.
          ...missing.map((d) => ({
            label: d,
            value: null,
            source: "not supplied by the merchant",
          })),
          {
            label: "Cross-field consistency",
            // A consistency check across an incomplete set has not been run,
            // it has been run on a subset — saying "no inconsistencies found"
            // would claim the whole file agreed with itself.
            value: !uw ? null : missing.length ? null : "No inconsistencies found",
            source: missing.length
              ? "document AI — cannot complete on a partial file"
              : "document AI",
          },
          { label: "Expiry", value: "All documents in date", source: "document AI" },
        ],
      }
    }
    // The score is what the regulated sign-off rests on, so it is decomposed
    // rather than quoted. The old prose memo that restated the score and the
    // edge case is deleted: it was a second copy of both claims, free to drift.
    case "2.1":
      return {
        kind: "risk",
        title: "Risk score",
        note: "Every factor behind the number, and what each was measured against.",
      }
    case "2.2": {
      // The exposure the acquirer would actually carry. Rendered as a record
      // rather than a new kind, because that is what it is: a small set of
      // stated values, each with a source, plus a named place the decision can
      // be taken instead. The `editable` slot carries the externalise
      // affordance — this step plugs into an acquirer's own underwriting tool
      // where they run one, and saying so is the difference between an offer
      // and a replacement.
      const scored = recordedScore(merchant) !== null
      return {
        kind: "records",
        title: "Exposure and acceptance limit",
        note: "What the acquirer would be left carrying if this merchant took payment and disappeared.",
        editable: {
          label: "Integrate your own model",
          where: "Your underwriting service, over API — this recommendation is replaced by yours",
        },
        rows: [
          {
            label: "Risk category",
            value: scored ? "Standard retail" : null,
            source: scored ? "your credit policy — category rules" : "cannot be assigned on an unscored file",
          },
          {
            label: "Recommended daily limit",
            // Withheld, not zeroed. A limit of £0 reads as a decision to accept
            // nothing, which is a rejection nobody made.
            value: scored ? "£14,000 / day" : null,
            source: scored ? "modelled on expected volume ÷ settlement cycle" : "no limit can be set until the file is scored",
          },
          {
            label: "Settlement exposure window",
            value: "2 working days",
            source: "your settlement cycle for this merchant type",
          },
          {
            label: "Fuller review required",
            value: "No — not a deferred-delivery category",
            source: "your credit policy — high-risk category list",
          },
        ],
      }
    }
    case "2.3":
      return {
        kind: "edge",
        title: "Escalated for your judgement",
        note: "What the agent deliberately would not decide on its own.",
      }

    /* 03 Order — the connected set */
    case "3.0":
      return { kind: "basket", title: "Order basket", note: "The concrete order. Quantities are yours to change; everything downstream follows." }
    case "3.1":
      // The acquirer is not Ingenico's inventory controller. The question here
      // is "can this order be met, and when" — not which shelf it sits on.
      return {
        kind: "stock",
        title: "Availability",
        note: "Confirmed by the Ingenico order desk against this basket.",
      }
    case "3.2":
      return { kind: "delivery", title: "Delivery", note: "Where it ships to, from where, and the earliest date the network can commit to." }
    case "3.3":
      return { kind: "pricing", title: "Order pricing", note: "Derived from the basket and the service level above — no figure here is typed by hand." }

    /* 04 Branding — the one step where the acquirer designs.
       Both tasks previously rendered as text: rows of asset names, and an
       ASCII "preview" that was not a preview of anything. Both now open the
       same studio, because the design and its proof are one object. */
    case "4.0":
      return {
        kind: "brand",
        focus: "assets",
        title: "Brand assets received",
        note: "What the merchant supplied and where each item came from. Anything they did not send is named, not defaulted silently.",
      }
    case "4.1":
      return {
        kind: "brand",
        focus: "theme",
        title: "Device theme",
        note: "The editable design and its live proof. PIN entry is excluded by the hardware, so the theme cannot reach it.",
      }
    case "4.2":
      return {
        kind: "records",
        title: "Receipt localisation",
        note: "Country-driven. These follow the merchant's registered address, not your preference.",
        rows: [
          { label: "Locale", value: localeFor(merchant), source: "merchant registered address" },
          { label: "VAT line", value: vatFor(merchant), source: "national rate table" },
          { label: "Return policy", value: "14-day statutory right of withdrawal", source: "EU consumer directive" },
        ],
      }
    case "4.3":
      return {
        kind: "brand",
        focus: "checks",
        title: "Brand checks",
        note: "Every rule the design must pass before it can ship, with the proof beside it so a failure can be seen and not just read.",
      }

    /* 05 Configure — one artefact per task. Every task here writes something
       to a device, so "wrote to the trace" was never an honest answer: the
       acquirer is being asked to accept a build they cannot see. */
    case "5.0": {
      const units = deviceUnits(merchant)
      return {
        kind: "table",
        title: `Device profiles (${units.length})`,
        note: "One profile per unit, not per order line — a quantity cannot carry a TID. The softPOS licence gets a profile too: it never ships, but it does transact.",
        table: {
          columns: ["Unit", "Model", "TID", "Kind"],
          rows: units.map((u) => [
            `Unit ${u.n}`,
            MODELS[u.model].label,
            u.tid,
            u.physical ? MODELS[u.model].form : "Software on merchant device",
          ]),
        },
      }
    }
    case "5.1":
      // Was a flat "records" list where every line already read "Enabled" and
      // the only control expanded a sentence. That put the one commercial
      // decision on this step behind a button that changed nothing, and
      // presented acceptance as configuration that had already happened.
      return {
        kind: "acceptance",
        title: "Schemes and payment methods",
        note: "What this merchant may accept. Each line names who decided it — an acquirer permission and a scheme mandate are different kinds of claim.",
      }
    case "5.2": {
      // The same parameter set Ingenico's own deployment workspace renders.
      // Typed a second time here, the two personas would be free to disagree
      // about what was actually loaded onto the merchant's terminals.
      const params = configProfile(
        merchant,
        ACQUIRER.name,
        liveSchemeLabel(merchant, defaultAcceptance(merchant)),
      )
      const units = deviceUnits(merchant)
      // Counted, not asserted. A "load successful" banner typed as a literal
      // would go on claiming success over a record that had lost a parameter.
      const settled = params.filter((p) => p.value !== null && p.value !== "").length
      const pending = params.length - settled
      return {
        kind: "records",
        title: "Loaded configuration",
        note: "The parameter set pushed to every profile above. This is the identical record Ingenico works from — not a summary of it.",
        outcome:
          pending === 0
            ? {
                state: "ok",
                headline: "Load successful",
                detail: `All ${params.length} parameters accepted on ${units.length} of ${units.length} profiles. No profile is running a partial set.`,
              }
            : {
                state: "warn",
                headline: "Loaded with gaps",
                detail: `${settled} of ${params.length} parameters accepted across ${units.length} profiles. ${pending} still unset — named in the record below.`,
              },
        rows: params.map((item) => ({
          label: item.label,
          value: item.value,
          source: item.source.toLowerCase(),
        })),
      }
    }
    case "5.3": {
      const units = deviceUnits(merchant)
      // Derived from the content it signs, so changing the order changes the
      // checksum. A fixed string would go on attesting to a build that moved.
      const digest = (tidBase(merchant.id) * 7919 + units.length * 104729)
        .toString(16)
        .toUpperCase()
        .padStart(8, "0")
      return {
        kind: "records",
        title: "Signed build",
        note: "What was sealed, and what would break the seal.",
        outcome: {
          state: "ok",
          headline: "Build sealed",
          // Counted off the same unit list the rows below report, so the
          // headline cannot claim a coverage the record does not show.
          detail: `${units.length} of ${units.length} profiles are inside the bundle and the checksum verifies. Any change to a profile after this point invalidates the signature and forces a rebuild.`,
        },
        rows: [
          { label: "Bundle", value: `BLD-${merchant.id.replace("m-", "").toUpperCase()}-01`, source: "config store" },
          { label: "Profiles included", value: `${units.length} of ${units.length}`, source: "counted from the profiles above" },
          { label: "Checksum", value: `SHA-256 …${digest}`, source: "derived from the bundle contents" },
          { label: "Signing certificate", value: "INGP2PE-4, valid to 2027-04", source: "Ingenico key management" },
          { label: "Countersigned by acquirer", value: null, source: "not required — this build carries no acquirer key material" },
        ],
      }
    }

    /* 06 Test */
    case "6.0": {
      const phys = physicalUnits(merchant)
      // A software-only order has no hardware of ours on the network. An empty
      // table would read as a failed lookup, and the row-count wording below
      // ("0 of 0 units") is the shape of a check that never ran.
      if (phys.length === 0) return softwareOnly(merchant, "connectivity")
      return {
        kind: "table",
        title: `Connectivity (${phys.length} unit${phys.length === 1 ? "" : "s"})`,
        note: `Each unit's own link to the gateway, because a fleet figure hides the one that cannot reach it.${licenceNote(merchant, "link of ours to test")}`,
        table: {
          columns: ["Unit", "TID", "Link", "Gateway"],
          rows: phys.map((u, i) => [
            `Unit ${u.n} · ${MODELS[u.model].label}`,
            u.tid,
            MODELS[u.model].battery ? "Wi-Fi, 4G fallback" : "Ethernet",
            i === phys.length - 1 && phys.length > 3 ? "Reachable — 1.9s, slowest of the set" : "Reachable",
          ]),
        },
      }
    }
    case "6.1": {
      // NOT gated on physical units. Unlike connectivity or peripherals, a
      // software-only order genuinely transacts — the licence runs on the
      // merchant's own handset — so falling back to the software-only notice
      // would claim there was nothing to test when there plainly was.
      const phys = physicalUnits(merchant)
      const on = phys.length ? phys : deviceUnits(merchant)
      if (on.length === 0) return null
      // Spread across real units, so a failure names a device someone can pick
      // up rather than an anonymous "terminal 2".
      const at = (i: number) => on[Math.min(i, on.length - 1)]
      const u1 = at(0)
      const u2 = at(1)
      const u3 = at(2)
      const name = (u: DeviceUnit) => `Unit ${u.n} · ${u.tid}`

      // A blocking decline holds dispatch, so only a merchant whose exception
      // IS this decline may carry one. Showing it on an order already at Ship
      // would have the record claiming dispatch is held while the pipeline
      // shows it shipped. Read off the exception register rather than
      // re-deriving "stuck at Test": two independent derivations of the same
      // fact can drift apart, and the register is what the rest of the app
      // already narrates from.
      const stuckHere = exceptionOnStep(merchant, 6) !== null
      return {
        kind: "txns",
        title: "Test transactions",
        note: "Run end to end against the acquirer's certification host, not a simulator. Every line is a real authorisation attempt with the host's own response.",
        rows: [
          {
            ref: "TXN-0001",
            kind: "Contactless sale",
            unit: name(u1),
            amount: "EUR 1.00",
            state: "pass",
            result: "Approved · auth 0X41B9",
            latencyMs: 1240,
          },
          {
            ref: "TXN-0002",
            kind: "Chip and PIN sale",
            unit: name(u2),
            amount: "EUR 1.00",
            state: "pass",
            result: "Approved · auth 0X41C0",
            latencyMs: 1580,
          },
          {
            // The deliberate failure. A decline code the reader can look up,
            // a cause that is NOT a restatement of the code, and an owner.
            ref: "TXN-0003",
            kind: "Refund",
            unit: name(u3),
            amount: "EUR 1.00",
            ...(stuckHere
              ? {
                  state: "fail" as const,
                  result: "Declined · 58 — transaction not permitted to terminal",
                  latencyMs: 890,
                  cause:
                    "Refund is not in the merchant category profile loaded at step 05. The terminal asked the host for a credit it has no permission to send, so the host rejected it before reaching the card. Nothing is wrong with the device or the card.",
                  fix: {
                    owner: "Ingenico" as const,
                    action:
                      "Deployment adds the refund permission to the acceptance profile and re-signs the bundle, then this transaction is re-run. The re-signed bundle invalidates the existing pass certificates, so step 06 restarts rather than resumes.",
                    blocking: true,
                  },
                }
              : {
                  state: "pass" as const,
                  result: "Approved · refund of 0X41B9",
                  latencyMs: 1320,
                }),
          },
          {
            ref: "TXN-0004",
            kind: "Reversal",
            unit: name(u1),
            amount: "EUR 1.00",
            state: "pass",
            result: "Approved · reversal of 0X41B9",
            latencyMs: 1110,
          },
          {
            ref: "TXN-0005",
            kind: "Offline / store-and-forward",
            unit: name(u2),
            amount: "EUR 1.00",
            state: "warn",
            result: "Approved on reconnect",
            latencyMs: 40200,
            cause:
              "Forwarded 40.2s after the link returned, against a 30s target. Within scheme rules, so this does not block dispatch — but it is the slowest path in the set and worth watching once the merchant is live.",
          },
        ],
      }
    }
    case "6.2": {
      const phys = physicalUnits(merchant)
      const battery = phys.filter((u) => MODELS[u.model].battery)
      if (phys.length === 0) return softwareOnly(merchant, "peripherals")
      return {
        kind: "checks",
        title: "Peripherals",
        note: `Hardware only.${licenceNote(merchant, "printer, reader or PIN pad")}`,
        rows: [
          { label: "Printer", state: "pass", evidence: `Test slip printed on ${phys.length} of ${phys.length} units` },
          { label: "Contactless reader", state: "pass", evidence: `Field strength within tolerance on ${phys.length} of ${phys.length} units` },
          { label: "PIN pad", state: "pass", evidence: "Tamper seal intact, all keys registering" },
          {
            label: "Battery",
            // Mains-powered units have no battery to test. Reporting a pass
            // would attest to a check that could not have run.
            state: battery.length > 0 ? "pass" : "warn",
            evidence:
              battery.length > 0
                ? `Charged above 80% on ${battery.length} portable unit${battery.length === 1 ? "" : "s"}`
                : "Not applicable — every unit on this order is mains-powered",
          },
        ],
      }
    }
    case "6.3": {
      const units = deviceUnits(merchant)
      // The refund decline at 6.1 is a PROFILE fault, not a device fault, so
      // it withholds certification from the whole set rather than from one
      // unit. Certifying every unit PASS underneath a failed transaction
      // would be the certificate contradicting the evidence it rests on —
      // and this document is what the dispatch gate reads.
      //
      // Read back off the transaction artefact rather than re-deriving which
      // unit failed: two independent derivations of the same fact are two
      // things that can disagree, and this one would disagree silently.
      const txns = artifactFor(6, 1, merchant)
      const failedTxn =
        txns?.kind === "txns" ? txns.rows.find((r) => r.state === "fail") : undefined
      return {
        kind: "document",
        title: "Pass certificates",
        note: failedTxn
          ? "One certificate per unit. Withheld while a test transaction is open — this document is what the dispatch gate reads, so it cannot certify ahead of the evidence."
          : "One certificate per unit. This is what the dispatch gate checks for, so a unit missing here cannot ship.",
        filename: `certificates-${merchant.id.replace("m-", "")}.pdf`,
        lines: failedTxn
          ? [
              `PRE-DISPATCH TEST CERTIFICATE — NOT ISSUED`,
              `Merchant   ${merchant.name}, ${merchant.location}`,
              `Acquirer   ${ACQUIRER.name}`,
              ``,
              ...units.map(
                (u) => `  ${u.tid}  ${MODELS[u.model].label.padEnd(12)}  WITHHELD`,
              ),
              ``,
              `0 of ${units.length} units certified.`,
              ``,
              `${failedTxn.ref} declined 58 on ${failedTxn.unit} — refund is absent from`,
              `the acceptance profile. The fault is in the profile, not the`,
              `hardware, so it is withheld across the set: every unit carries`,
              `the same bundle. Ingenico deployment re-signs, step 06 re-runs,`,
              `and certificates issue on a clean pass.`,
            ]
          : [
              `PRE-DISPATCH TEST CERTIFICATE`,
              `Merchant   ${merchant.name}, ${merchant.location}`,
              `Acquirer   ${ACQUIRER.name}`,
              ``,
              ...units.map((u) => `  ${u.tid}  ${MODELS[u.model].label.padEnd(12)}  PASS`),
              ``,
              `${units.length} of ${units.length} units certified. Certificates expire if the`,
              `configuration bundle is re-signed.`,
            ],
      }
    }

    /* 07 Ship — the step where the physical/licence split first bites. */
    case "7.0": {
      const f = consignmentFacts(merchant)
      const nearest = f.origin
      const phys = physicalUnits(merchant)
      if (phys.length === 0) return softwareOnly(merchant, "shipment")
      return {
        kind: "records",
        title: "Carrier booking",
        note: "The collection, not the promise. The date this has to meet is on the Delivery artefact at step 03 — restating it here would give it a second place to drift.",
        rows: [
          { label: "Carrier", value: f.carrier, source: "framework agreement, road lane" },
          {
            label: "Collection from",
            value: nearest ? `${nearest.wh.name}, ${nearest.wh.city}` : null,
            source: nearest ? `nearest stocked site, ${nearest.distanceKm} km` : "no delivery point on file",
          },
          { label: "Parcels booked", value: String(phys.length), source: "one per physical unit" },
          {
            label: "Collection reference",
            value: f.collectionRef,
            source: "carrier API",
          },
          { label: "Collection window", value: null, source: "carrier confirms the slot the evening before" },
        ],
      }
    }
    case "7.1": {
      const geo = deliveryGeo(merchant)
      const nearest = geo ? warehousesByDistance(geo)[0] : null
      const phys = physicalUnits(merchant)
      if (phys.length === 0) return softwareOnly(merchant, "shipment")
      return {
        kind: "table",
        title: `Labels and manifest (${phys.length} parcel${phys.length === 1 ? "" : "s"})`,
        // Every parcel carries the same destination, so printing it on each row
        // is three copies of one fact crowding out the three that differ.
        note: `All parcels ship to ${geo ? geo.address : "the delivery point on file"}. A label is a physical object, so the count follows the hardware and not the order.${licenceNote(merchant, "parcel to label")}`,
        table: {
          columns: ["Parcel", "Contents", "Ships from"],
          rows: phys.map((u) => [
            `${tidBase(merchant.id)}-${String(u.n).padStart(2, "0")}`,
            `${MODELS[u.model].label} · ${u.tid}`,
            nearest ? `${nearest.wh.name} · ${nearest.distanceKm} km` : "Site not resolved",
          ]),
        },
      }
    }
    case "7.2": {
      const phys = physicalUnits(merchant)
      if (phys.length === 0) return softwareOnly(merchant, "shipment")
      return {
        kind: "checks",
        title: "Dispatch hand-off",
        note: "What the carrier actually took, against what was labelled.",
        rows: [
          { label: "Parcels scanned by carrier", state: "pass", evidence: `${phys.length} of ${phys.length} labels scanned at collection` },
          { label: "Manifest signed", state: "pass", evidence: "Driver signature captured against the collection reference" },
          { label: "Seals intact", state: "pass", evidence: "Tamper-evident seals photographed at hand-off" },
        ],
      }
    }
    case "7.3":
      if (physicalUnits(merchant).length === 0) return softwareOnly(merchant, "shipment")
      return {
        kind: "consignment",
        title: "Tracking",
        // Was `kind: "delivery"`, which rendered the ORDER-TIME EDITOR here:
        // service-level buttons and a date picker, on a step whose own trace
        // reads `dispatch.confirm → parcels in transit`. Shipping is Ingenico's
        // to execute and the choice was spent at step 03, so offering it again
        // was a control that could not act on anything in front of it.
        note: "What Ingenico has done with the consignment, against the date committed at order. Shipping is theirs to execute — nothing here is yours to change.",
      }

    /* 08 Install */
    case "8.0": {
      const shipped = physicalUnits(merchant).length > 0
      return {
        kind: "records",
        title: shipped ? "Arrival" : "Licence issued",
        note: shipped
          ? "How we know it landed, and who we then contacted."
          : "There was no delivery to detect. The trigger for a software-only order is the licence going live, not a carrier scan.",
        rows: [
          {
            label: shipped ? "Delivery confirmed" : "Licence activated",
            value: shipped ? "Carrier reported delivered" : "Entitlement issued to the merchant account",
            source: shipped ? "carrier tracking webhook" : "licence service",
          },
          {
            label: "Signed for by",
            value: null,
            source: shipped ? "carrier did not return a signatory name" : "no delivery — nothing to sign for",
          },
          {
            label: "Setup guide sent to",
            value: merchant.name,
            source: `in ${localeFor(merchant) ?? "the merchant's country locale, which is not in the rules table"}`,
          },
          { label: "Merchant opened the guide", value: "Yes", source: "guide telemetry" },
        ],
      }
    }
    case "8.1": {
      const units = deviceUnits(merchant)
      return {
        kind: "table",
        title: "Guided setup",
        note: "Where each unit got to. A unit that stalled is named rather than averaged into a completion rate.",
        table: {
          columns: ["Unit", "TID", "Step reached", "Paired"],
          rows: units.map((u) => [
            `Unit ${u.n} · ${MODELS[u.model].label}`,
            u.tid,
            u.physical ? "Powered, network joined, paired" : "Installed on merchant handset",
            "Yes",
          ]),
        },
      }
    }
    case "8.2": {
      const units = deviceUnits(merchant)
      const live = merchant.currentStep > 8 || merchant.status === "Live"
      return {
        kind: "table",
        title: "Activation",
        note: live
          ? "Each unit bound to its TID on the live host."
          : "Activation is written here as each unit comes up. Units still to activate are shown as pending, not as failures.",
        table: {
          columns: ["Unit", "TID", "Host", "State"],
          rows: units.map((u, i) => [
            `Unit ${u.n} · ${MODELS[u.model].label}`,
            u.tid,
            "Live acquiring host",
            live ? "Active" : i === 0 ? "Active" : "Pending",
          ]),
        },
      }
    }
    case "8.3": {
      const units = deviceUnits(merchant)
      return {
        kind: "checks",
        title: "Ready to trade",
        note: "A €0.01 authorisation per unit, reversed immediately. Nothing here is a simulation.",
        rows: [
          { label: "Authorisation test", state: "pass", evidence: `Approved on ${units.length} of ${units.length} units, including the softPOS licence` },
          { label: "Reversal", state: "pass", evidence: "Every test authorisation reversed; no residue on the merchant statement" },
          { label: "Staff walkthrough", state: "pass", evidence: "Completed with the duty manager" },
        ],
      }
    }

    /* 09 Go-live */
    case "9.0": {
      const live = merchant.status === "Live"
      return {
        kind: "records",
        title: "First live payment",
        note: live
          ? "The transaction that proves the merchant is trading, not that the plumbing works."
          : "Nothing observed yet. This is an empty watch, not a failure — the record fills the moment a real customer pays.",
        rows: [
          { label: "First live payment", value: live ? "€48.00" : null, source: live ? "transaction stream" : "not yet observed" },
          { label: "Observed on", value: live ? deviceUnits(merchant)[0]?.tid ?? null : null, source: live ? "terminal that took the payment" : "no payment to attribute" },
          { label: "Authorisation", value: live ? "0X5A20, approved" : null, source: live ? "acquiring host" : "no payment to authorise" },
          { label: "Test transactions excluded", value: "Yes", source: "the €0.01 activation authorisations are filtered out" },
        ],
      }
    }
    case "9.1": {
      const units = deviceUnits(merchant)
      const mid = merchant.id.replace("m-", "MID-").toUpperCase()
      return {
        kind: "table",
        title: "Ledger reconciliation",
        note: `Every TID matched against ${ACQUIRER.name}'s own ledger. An orphan would be a terminal taking money that your ledger cannot attribute.`,
        table: {
          columns: ["TID", "Bound to MID", "In your ledger", "Orphan"],
          rows: units.map((u) => [u.tid, mid, "Matched", "No"]),
        },
      }
    }
    case "9.2":
      return {
        kind: "records",
        title: "Write-back",
        note: "What went into your systems, and where. The agent writes the record; it does not keep a second copy of it.",
        rows: [
          { label: "Destination", value: `${ACQUIRER.name} CRM — merchant record`, source: "your system of record" },
          { label: "Merchant ID", value: merchant.id.replace("m-", "MID-").toUpperCase(), source: "acquirer host" },
          { label: "Devices written", value: String(deviceUnits(merchant).length), source: "counted from the activation table" },
          { label: "Onboarding duration", value: null, source: "submission timestamp not carried on this record" },
          { label: "Underwriting decision", value: "Attached, with the signatory", source: "step 02 sign-off" },
        ],
      }
    case "9.3":
      return {
        kind: "document",
        title: "Go-live notice",
        note: "Sent to you and to the merchant. The same text to both, so neither is told something the other is not.",
        filename: `go-live-${merchant.id.replace("m-", "")}.pdf`,
        lines: [
          `${merchant.name} is live.`,
          ``,
          `Merchant ID   ${merchant.id.replace("m-", "MID-").toUpperCase()}`,
          `Devices       ${deviceUnits(merchant).length} active`,
          `Acquirer      ${ACQUIRER.name}`,
          `Settlement    Daily, 23:00 local — first settlement one working day`,
          `              after the first live payment.`,
          ``,
          `The onboarding record has been written back to your CRM. Fleet`,
          `monitoring passes to Ingenico operations from this point; the`,
          `merchant relationship does not.`,
        ],
      }

    default:
      return null
  }
}
