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

import {
  laneState,
  MERCHANTS,
  NO_HALTS,
  NO_SESSION_PROGRESS,
  PIPELINE,
  stepById,
  stepEvidenced,
  type Merchant,
  type StepId,
} from "@/lib/acquirer-data"
import { bookPeersByDistance } from "@/lib/comparables"
import { ACQUIRER } from "@/lib/branding"
import { MODELS, configProfile, orderLines, type ModelId } from "@/lib/devices"
// Cyclic with `scheme-acceptance` (it imports `vatFor`/`licenceUnits` from
// here), but only ever used inside function bodies, so both modules are fully
// initialised by the time either call runs. Keep it that way: a top-level
// constant derived from these would evaluate mid-cycle and read `undefined`.
import { defaultAcceptance, liveSchemeLabel } from "@/lib/scheme-acceptance"
import { exceptionOnStep, locatedException } from "@/lib/exceptions"
// No cycle: `handoffs` imports only types from `acquirer-data`.
import { statusPossibleAt } from "@/lib/handoffs"
import { streetFor } from "@/lib/addresses"
import { countryOf, distanceKm } from "@/lib/geo"
// No cycle: `underwriting` only reaches back to `acquirer-data`.
import { outstandingDocuments } from "@/lib/underwriting"
import {
  CAPTURE_STEP,
  DOCUMENT_PASS_TASK,
  recordedScore,
  riskAssessment,
  SCORE_THE_RISK_TASK,
  UNDERWRITING_STEP,
} from "@/lib/underwriting"

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

/** Catalogue key by sku, so a summary can be written in the same vocabulary
 *  `defaultBasket` reads. The keys ("A920") are NOT the display names
 *  ("AXIUM A920"), so a summary built from names would parse back to an empty
 *  basket — silently, since an empty basket renders as a merchant who ordered
 *  nothing rather than as an error. */
const CATALOGUE_KEY_BY_SKU: Record<string, string> = Object.fromEntries(
  Object.entries(CATALOGUE).map(([key, item]) => [item.sku, key]),
)

/**
 * The inverse of `defaultBasket`: collapse an order back into the one-line
 * device summary the rest of the portal reads.
 *
 * `defaultBasket` promises the order "can never disagree with the record shown
 * everywhere else in the portal" — but that only held while the basket was
 * read-only. The moment a line is edited, the merchant's own `terminals`
 * string is stale, and every surface quoting it (portfolio row, sign-off
 * header, agent bar, Ingenico licence counts) goes on reporting the kit as it
 * was before the edit. Deriving the summary back out keeps the promise in both
 * directions, which is what lets ONE store serve every screen.
 *
 * Accessories are excluded deliberately. They are DERIVED, not chosen —
 * `defaultBasket` adds a dock per portable and one starter pack — so listing
 * them here would make the count grow every round trip. It also matches the
 * fixtures: Atlas is "3× A920 + softPOS" = 4, and the three docks its basket
 * carries are not terminals anyone was sold.
 */
export function summariseOrder(lines: BasketLine[]): {
  terminals: string
  terminalCount: number
} {
  const chosen = lines.filter((l) => l.qty > 0 && l.kind !== "accessory")
  return {
    terminals:
      chosen
        .map((l) => {
          const key = CATALOGUE_KEY_BY_SKU[l.sku] ?? l.name
          // "softPOS" not "1× softPOS", matching how the fixtures are written.
          return l.qty === 1 ? key : `${l.qty}× ${key}`
        })
        .join(" + ") ||
      // A zeroed basket is a real state the editor permits, and it is not the
      // same claim as an unknown one — so it is named rather than left blank.
      "No devices ordered",
    terminalCount: chosen.reduce((n, l) => n + l.qty, 0),
  }
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

/** Whether the address on file resolves to a route the carrier will run.
 *
 *  A union rather than a boolean: an unserviceable address is only actionable
 *  if it says WHY and on whose authority, and a bare `false` would have left
 *  the panel showing a red state with nothing to correct. */
export type DeliveryVerdict =
  | { state: "serviceable" }
  | { state: "unserviceable"; reason: string; source: string }

/** Read from the logistics exception, which is where the failure is actually
 *  recorded. Deriving it here rather than in each renderer is what stops the
 *  trace, the panel and the task tick from disagreeing about one address. */
export function deliveryVerdict(merchant: Merchant): DeliveryVerdict {
  const blocked = exceptionOnStep(merchant, 3)
  // Scoped to the delivery task specifically: a step-3 exception raised against
  // the basket or the pricing says nothing about whether the carrier can reach
  // the door, and marking the address unserviceable on its account would invent
  // a second failure out of the first.
  if (blocked && blocked.taskIndex === 2) {
    return { state: "unserviceable", reason: blocked.found, source: blocked.source }
  }
  return { state: "serviceable" }
}

export function deliveryGeo(merchant: Merchant): Geo | null {
  const c = CITY[merchant.id]
  if (!c) return null
  return {
    label: merchant.name,
    // From `lib/addresses.ts`, which the logistics exception reads too, so the
    // map and the failure it describes can never name different streets.
    address: `${streetFor(merchant.id)}, ${merchant.location}`,
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
   * Whether the acquirer may retype this before it is pushed.
   *
   * Per row, not per artefact, because the two kinds genuinely differ: a
   * drafted application is the agent's proposal and every line of it is the
   * acquirer's to correct, whereas a write-back receipt quotes ids read back
   * off the host — typing over those would not change the host, it would just
   * make the screen disagree with it.
   *
   * The default is read-only. An editable field is a claim that the edit goes
   * somewhere, and that claim has to be made deliberately.
   */
  writable?: boolean
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

/**
 * The last act of a stage: the point where the agent's work leaves this app and
 * lands in a system that keeps it.
 *
 * Two artefacts used to report that write in the PAST TENSE — "Written into
 * your CRM", "What went into your systems" — with no control anywhere that
 * performed it. That is the worst version of an automation claim: the acquirer
 * is told a record now exists under their name in their own system of record,
 * by a screen that never asked them and cannot show them when it happened. The
 * agent drafts; a person commits. This type is that commit.
 *
 * `action` names the destination, never a bare "Submit" or "Approve" — the
 * whole question at a handoff is *where is this going*, and a verb with no
 * object does not answer it.
 */
export interface ArtifactHandoff {
  /** The system of record that receives it. */
  system: string
  /** The button label. Names the system and the act. */
  action: string
  /** What the acquirer takes responsibility for by pushing. */
  commits: string
  /** What actually lands over there, so the push is not a black box. */
  delivers: string
}

/** What a push would carry, and what stands in its way. All three lists are
 *  DERIVED from the rows on screen and the acquirer's own edits — none is
 *  typed, so the footer cannot describe a record different from the one
 *  above it. */
export interface PushReadiness {
  /** Rows the acquirer retyped. Named so the receipt can say the record is
   *  not purely the agent's work — a CRM entry that looks machine-written
   *  when a human moved three fields misattributes the judgement. */
  edited: string[]
  /** Empty rows the agent never filled, which travel with the record. A gap
   *  the agent declared is honest; the destination sees it as empty either
   *  way, so hiding it here would only surprise whoever opens it there. */
  gaps: string[]
  /** Why the push is refused. Empty means it can go. */
  blockers: string[]
}

export function pushReadiness(
  rows: RecordRow[],
  edits: Record<string, string>,
): PushReadiness {
  const edited: string[] = []
  const gaps: string[] = []
  const blockers: string[] = []

  for (const r of rows) {
    const typed = edits[r.label]
    const current = typed ?? r.value ?? ""
    const isEmpty = current.trim() === ""

    if (typed !== undefined && typed.trim() !== (r.value ?? "").trim()) {
      edited.push(r.label)
    }

    if (!isEmpty) continue

    // An empty field the acquirer CREATED is a different thing from one the
    // agent reported. The agent's gap is a known unknown that the destination
    // is entitled to see; clearing a value the agent read off a document is a
    // deletion, and pushing it would overwrite evidence with nothing.
    if (r.value !== null && r.value.trim() !== "") {
      blockers.push(`${r.label} was cleared — restore it or type a replacement`)
    } else if (r.resolution?.blocking) {
      blockers.push(`${r.label} — ${r.resolution.when}`)
    } else {
      gaps.push(r.label)
    }
  }

  return { edited, gaps, blockers }
}

export interface CheckRow {
  label: string
  /** `running` is a FOURTH state, not a styling of pass. A check still out with
   *  a provider has no result, and rendering it as a tick would report a
   *  verdict nobody has returned — the whole point of the KYC panel is that the
   *  file progresses while individual checks are still open. */
  /**
   * `running` is a FOURTH state, not a styling of pass — see above.
   *
   * `n/a` is a FIFTH, and it exists because two rows were wearing `warn` while
   * describing something that is permanently true rather than pending: a
   * battery check on an order of mains-powered terminals, and registry
   * corroboration in a country with no register wired up. Once a warning
   * correctly holds the lane, that misfiling stops being cosmetic — it holds
   * the file behind a question nobody can ever answer, and offers a
   * "simulate the answer" lever for a reply that will never come.
   *
   * The distinction is whether WAITING WOULD HELP. `warn` = unresolved, an
   * answer is owed. `n/a` = out of scope, no answer is owed and none is
   * missing. It is emphatically not `pass`: nothing was checked, and a tick
   * would claim a comparison that never happened.
   */
  state: "pass" | "warn" | "fail" | "running" | "n/a"
  /** What was actually compared — a green tick with no comparison is
   *  decoration. For a `running` row, what is outstanding and with whom; for
   *  `n/a`, why the check does not apply. */
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

/**
 * One file in the merchant's uploaded bundle, and what the agent made of it.
 *
 * `classified` is `string | null` and the null branch REQUIRES a `review`
 * reason, because "the agent could not tell what this is" is not a low-confidence
 * classification — it is no classification at all. Modelling it as a confidence
 * score would have let an unrecognised file render as a typed document with a
 * weak tag, which is the one row on this panel a human has to act on.
 *
 * The `confidence` field this type used to carry is GONE with that reasoning
 * followed through: every classified row was "high", so the tag distinguished
 * nothing while implying a scale the data never populated.
 *
 * Classification and quality are one row rather than two panels. They are two
 * questions about the same piece of paper, and reading them apart is what let a
 * legible, in-date, WRONG-TYPE document look fine on both screens.
 */
export type DossierFile = {
  filename: string
} & (
  | {
      classified: string
      /** Quality verdict, REQUIRED once the type is known: a document can be
       *  cleanly classified and still be out of date, and that is precisely
       *  the failure a separate quality panel used to let through. */
      quality: { state: "pass" | "warn"; evidence: string }
      review?: never
    }
  | {
      classified: null
      /** No quality verdict is possible before the type is known — judging
       *  whether a document is "in date" means nothing until you know what
       *  document it is, and a tick here would report a check that never ran. */
      quality?: never
      review: string
    }
)

export type DossierRequirement = {
  label: string
  /** `received` names the file that satisfied it, so this list and the file
   *  list above are provably the same set rather than two hand-kept ones. */
  received: string | null
}

export type DossierFinding = {
  label: string
  value: string | null
  /** Which document the value came out of, or which documents agreed. This is
   *  what an underwriter re-checks first — it separates a figure the applicant
   *  asserted from one their bank printed. */
  source: string
  /** True where the value was confirmed by more than one document. A single
   *  source and a corroborated one are different claims about the same field. */
  corroborated?: boolean
}

export type Artifact =
  | { kind: "basket"; title: string; note: string }
  | { kind: "stock"; title: string; note: string }
  /** `verdict` is REQUIRED, and that is the whole point of it.
   *
   *  This artefact used to carry only a title and a note — no result at all —
   *  so the task that "verifies the delivery address resolves to a serviceable
   *  route" had nothing to record the answer in. Every surface therefore
   *  defaulted to success: the trace printed "… serviceable, standard 3d" for a
   *  merchant whose order was held precisely because the address does not
   *  resolve, and the step badge read Complete over it. The Test step never had
   *  this problem because its `txns` artefact carries real fail rows to derive
   *  from — so the fix is to give this one a verdict too, rather than to teach
   *  each surface about the exception separately.
   *
   *  Optional would have reinstated the bug: an artefact that forgot to state
   *  its verdict would read as a pass. */
  | { kind: "delivery"; title: string; note: string; verdict: DeliveryVerdict }
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
       * WHOSE SYSTEM RULED THIS, AND WHY IT IS NOT OURS TO MOVE.
       *
       * `records` used to carry an `editable` slot — a button naming where an
       * edit would land — and underwriting was its last user, as "Integrate
       * your own model / this recommendation is replaced by yours". That was
       * incoherent twice over: the figures ALREADY come from the acquirer's own
       * risk engine, so it offered to integrate something already integrated;
       * and calling them a "recommendation" implied Ingenico had formed a view
       * the acquirer could accept or decline. The portal cannot decline. It
       * reads the engine's output and applies it. `editable` is now gone from
       * this kind rather than left unused, because a dead edit-slot on a
       * read-out is an invitation to put the same affordance back.
       *
       * Note the direction of travel: `tariff` keeps real typed inputs because
       * pricing has NO external authority — the rate is the acquirer's own to
       * set. Underwriting is the mirror image, and the two must never be given
       * the same treatment just because both are "the acquirer's".
       *
       * So this is deliberately NOT a control, NOT a disabled control, and not
       * mere absence. A flat read-only list leaves the reader unable to tell
       * whether the numbers are Ingenico's or theirs — the one question that
       * matters here — while a disabled button implies the edit is possible and
       * merely blocked. It renders as a named, non-interactive provenance
       * statement. `change` is required so the statement is not a dead end: the
       * limit is entirely changeable, just not from this screen.
       */
      governed?: { system: string; why: string; change: string }
      /**
       * Present only on a record that leaves for another system. Absent means
       * this panel is a read-out and nothing here is dispatched — which is the
       * case for most of them, so the slot is optional rather than a footer
       * that renders disabled on eleven panels with nowhere to send anything.
       */
      handoff?: ArtifactHandoff
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
  /** The uploaded bundle and the type the agent assigned each file. A separate
   *  kind from `records` (a field and its value) and `checks` (a test and its
   *  verdict): this answers "what did we receive, and does the agent know what
   *  it is" — a classification, which can legitimately come back empty. */

  | { kind: "checks"; title: string; note: string; rows: CheckRow[] }
  | { kind: "txns"; title: string; note: string; rows: TxnRow[] }
  /** The whole document pass on one page: what arrived, what is required and
   *  still missing, what the agent learned, and the chase.
   *
   *  Replaces five separate panels (intake / extracted / quality / checklist /
   *  reconciliation). Those were five views of one bundle, and splitting them
   *  put "what is missing" on a different screen from "what arrived" — so the
   *  reader had to assemble the file's actual status themselves. */
  | {
      kind: "dossier"
      title: string
      note: string
      /** Every file received, with the type assigned and its quality verdict.
       *  Classification and legibility are merged per row on purpose: they are
       *  two questions about the same piece of paper, and a document can be
       *  cleanly classified yet out of date. */
      files: DossierFile[]
      /** The required set. `received` rows name the file that satisfied them,
       *  so the checklist and the file list cannot disagree. */
      required: DossierRequirement[]
      /** What the bundle actually TOLD us — the extracted fields and the
       *  cross-document agreement, which is the part that survives once the
       *  paperwork is filed. */
      findings: DossierFinding[]
      /** Present only when something is outstanding. Absent means there is
       *  nothing to chase, which is why this is optional rather than a chase
       *  block that renders disabled — a dead button on a complete file
       *  invites the reader to look for a problem that is not there. */
      chase?: {
        items: string[]
        channel: string
        note: string
      }
    }
  | { kind: "table"; title: string; note: string; table: TableArtifact }
  | {
      kind: "document"
      title: string
      note: string
      filename: string
      lines: string[]
      /**
       * Present when the document is an outbound communication rather than a
       * file to keep. A notice that goes to the merchant is a statement made
       * under the acquirer's name, so the body is editable and the send is
       * theirs — the same rule as the drafted application, applied to prose
       * instead of fields.
       */
      handoff?: ArtifactHandoff
    }
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
    /* Capture. Each line is derived from the same call its panel renders — a
       trace exists to let someone check a result, so one that disagrees with
       its own artefact is worse than none. */
    /* The whole document pass in one line, matching the one panel it now
       produces. Counts the files and the required set off the same call the
       dossier renders. */
    case "1.0": {
      const missing = outstandingDocuments(merchant)
      const art = artifactFor(1, 0, merchant)
      const files = art?.kind === "dossier" ? art.files.length : 0
      const unclassified =
        art?.kind === "dossier" ? art.files.filter((f) => f.classified === null).length : 0
      return `doc.process → ${files} files, ${unclassified} unrecognised, 4 of ${4 + missing.length} required received${
        missing.length ? `, outstanding: ${missing.join(", ")}` : ", none outstanding"
      }`
    }
    case "1.1": {
      const reg = registryFor(merchant)
      return reg
        ? `registry.enrich → ${reg.name} ${reg.number} confirmed, directors matched, tax id ok`
        : `registry.enrich → no register on file for ${countryOf(merchant.location)}, nothing corroborated`
    }
    case "1.2":
      return `web.research → ${websiteFor(merchant)} read, sector=${merchant.sector} corroborated, 0 restricted categories`
    case "1.3": {
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
      return `recommend.kit → ${peers.length} live ${merchant.sector.toLowerCase()} merchants, ${scope}${
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
    /* The drafted record. This was a SECOND `case "1.3"` in the same switch —
       unreachable behind the checklist case above it — and `case "1.2"` fell
       through to `order.build`, so capture's quality task printed an
       order-build trace. Renumbering surfaced both: the draft is now 1.4 and
       reachable, and 1.2 belongs to web research above. */
    case "1.4": {
      const art = artifactFor(1, 4, merchant)
      if (art?.kind !== "records") return null
      const filled = art.rows.filter((r) => r.value !== null).length
      const gaps = art.rows.length - filled
      // Ends on "held for your release", not "0 awaiting downstream". The old
      // tail described a record already gone: it reported the draft as
      // finished business at the exact moment the panel above it started
      // waiting for a human to press send. A trace that contradicts the
      // control beside it is the more believable of the two, because it looks
      // like machine output.
      return `application.draft → ${filled}/${art.rows.length} fields populated, ${
        gaps === 0 ? "no gaps" : `${gaps} gap${gaps === 1 ? "" : "s"} named`
      }, held for your release`
    }
    case "3.0":
      return `order.build → ${active.map((l) => `${l.qty}× ${l.name}`).join(", ")}`
    case "3.1": {
      const stock = checkStock(active, geo)
      // `.check`, not `.confirm` — the agent reads a published position; the
      // order desk is what confirms, after the order is placed.
      return stock.shortLines.length
        ? `availability.check → ${stock.shortLines.length} line(s) short, balance to follow`
        : `availability.check → all ${active.length} line(s) showing in stock`
    }
    case "3.2": {
      if (!geo) return `logistics.validate → no delivery point on file`
      // Derived from the artefact's own verdict, like 6.1 reads its fail rows.
      // This line used to print "serviceable" unconditionally, so the merchant
      // whose order was held for an unresolvable address had a machine trace
      // asserting the opposite two panels above the exception explaining it —
      // and a trace looks like tool output, so it is the more believable of the
      // two.
      const v = deliveryVerdict(merchant)
      return v.state === "unserviceable"
        ? `logistics.validate → ${geo.address} NOT serviceable, no route resolved, order held`
        : `logistics.validate → ${geo.address} serviceable, ${service.label.toLowerCase()} ${service.workingDays}d`
    }
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
      return `build.sign �� ${deviceUnits(merchant).length} profiles sealed, ${sum ?? "checksum not recorded"}`
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
 * The companies register for the merchant's country, and their number in it.
 *
 * Keyed by country because the register is NOT the same institution everywhere:
 * quoting "Companies House" against an Innsbruck applicant would name a body
 * that has never heard of them, and the acquirer's whole reason for reading this
 * panel is to know which authority stands behind the number.
 *
 * Returns null for a country with no rule rather than guessing a format, so the
 * enrichment step reports a gap it can name instead of a plausible fake.
 */
export function registryFor(merchant: Merchant): { name: string; number: string } | null {
  const cc = countryOf(merchant.location)
  const rule = REGISTRY_RULES[cc]
  if (!rule) return null
  // Deterministic per merchant: the same applicant must not be shown a
  // different registration on every render.
  let h = 0
  for (const ch of merchant.id) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000
  return { name: rule.name, number: rule.format(String(h).padStart(6, "0")) }
}

const REGISTRY_RULES: Record<string, { name: string; format: (n: string) => string }> = {
  UK: { name: "Companies House", format: (n) => `0${n}` },
  IE: { name: "Companies Registration Office", format: (n) => n },
  DE: { name: "Handelsregister", format: (n) => `HRB ${n}` },
  AT: { name: "Firmenbuch", format: (n) => `FN ${n} x` },
  FR: { name: "Registre du commerce", format: (n) => `${n} R.C.S.` },
  ES: { name: "Registro Mercantil", format: (n) => `B-${n}` },
  IT: { name: "Registro Imprese", format: (n) => `IT-${n}` },
  PT: { name: "Registo Comercial", format: (n) => n },
  NL: { name: "Kamer van Koophandel", format: (n) => `KvK ${n}` },
  NO: { name: "Brønnøysund register", format: (n) => `NO ${n}` },
  EE: { name: "Äriregister", format: (n) => n },
  CZ: { name: "Obchodní rejstřík", format: (n) => `C ${n}` },
}

/** The site the agent read. `.example` is reserved for exactly this: a domain
 *  that cannot resolve, so a demo can show which site was reviewed without
 *  pointing a reader at somebody's real business. */
export function websiteFor(merchant: Merchant): string {
  const slug = merchant.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24)
  return `${slug}.example`
}

/**
 * What the agent concluded the business actually does, in its own words.
 *
 * Keyed off the sector rather than restating it: an "inference" that repeats
 * the applicant's own answer back corroborates nothing, and this row exists to
 * be compared against the stated sector, not to echo it.
 */
export function inferredBusinessFor(merchant: Merchant): string {
  const BY_SECTOR: Record<string, string> = {
    Hospitality: "Coffee roasting and sit-in service across a small number of sites",
    Retail: "Retail of outdoor and ski equipment, in store and online",
    "Health & Fitness": "Membership gym and personal training",
    Leisure: "Ticketed visitor attraction with on-site food and retail",
    Automotive: "Vehicle servicing and parts retail",
    Grocery: "Convenience grocery with extended opening hours",
    Professional: "Professional services billed on appointment",
  }
  return BY_SECTOR[merchant.sector] ?? `${merchant.sector} trading from ${merchant.location}`
}

/** A masked settlement account, country-correct and stable per merchant. The
 *  full number is deliberately never rendered: it is read off the statement to
 *  prove it was captured, not to be displayed back on a review screen. */
export function maskedAccountFor(merchant: Merchant): string {
  const cc = countryOf(merchant.location)
  let h = 0
  for (const ch of merchant.id) h = (h * 17 + ch.charCodeAt(0)) % 10_000
  return `${cc} ** **** **** **** ${String(h).padStart(4, "0")}`
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

import { blockers, checkBrand, type BrandRule, type BrandTheme } from "./branding"

/**
 * A failure recorded inside a COMPLETED task's own artefact.
 *
 * Distinct from a halt, and the two must not merge. A halted task produced
 * nothing — the agent reached it and refused. An exception is the opposite
 * shape: the task ran, produced its output, and that output records something
 * that fails. Both are wrong to render as a green tick, but for different
 * reasons, and a reader needs to know which they are looking at.
 *
 * This exists because the tick was the only thing on the row making a claim
 * about the RESULT, and it was hard-wired to "the agent got this far". Branding
 * showed it plainest: `4/4 tasks`, four green ticks, and the panel beside them
 * badged `1 blocking` — the row asserting a pass while its own evidence denied
 * it. Derived per artefact kind rather than flagged by hand, so no step can
 * report clean over a failure it is itself displaying.
 *
 * Advisories are deliberately NOT exceptions. A `warn` is information; if every
 * shade of imperfection turned the tick red, red would stop meaning anything.
 */
export interface TaskException {
  headline: string
  detail: string
  /**
   * How bad it is, in the artefact's OWN vocabulary.
   *
   * The census used to record failures only, so a `warn` row returned null and
   * the task above it kept its green tick: "Registry match — no registry
   * response on file" sat under a ticked "Verify the entity". A parent that
   * reports a clean pass over an unresolved child is the same false all-clear
   * this file keeps fixing, one register lower.
   *
   * But a warning is NOT a failure, and promoting it to one would be a
   * different wrong claim — an unreturned registry response is an ABSENCE, not
   * a mismatch. So the severity travels with the exception and the parent
   * mirrors the child's own register: amber stays amber, red stays red. This
   * is also what keeps `blockingFinding` honest, since it can now escalate the
   * failures and leave the warnings alone.
   */
  severity: "warn" | "fail"
}

/**
 * Inputs an artefact cannot supply for itself.
 *
 * REQUIRED, not optional, and that is the point: the brand rules are computed
 * from the live editable theme, so if this were optional a caller could omit it
 * and every branding task would silently come back clean — a false all-clear is
 * worse than the bug being fixed. Making it required turns the omission into a
 * compile error.
 */
export interface ExceptionContext {
  brandRules: BrandRule[]
}

/**
 * Whether this merchant's branding is already settled on physical hardware.
 *
 * THE "AS AT" THE BRAND CHECK NEVER HAD. `checkBrand(theme)` takes a theme and
 * nothing else — no merchant, no date — so it can only ever answer "does this
 * design comply *now*". That is the right question while a design is being
 * chosen and the wrong one afterwards: a terminal on a shop counter was branded
 * under the standard in force when it was approved, and editing a swatch today
 * does not reach into the field and un-approve it.
 *
 * Without this, one colour change put six merchants into breach on a Branding
 * step they had passed weeks earlier, three of them already installed and taking
 * payments — and the remedy on offer was "approve the branding", which is not
 * something you can do to a terminal that has already shipped.
 *
 * What a mismatch actually creates is a REFRESH BACKLOG, reported as drift by
 * `estateDrift` rather than as a halt. Two different claims, two different
 * remedies: one needs an approval, the other needs a visit.
 */
export function brandingSettled(merchant: Merchant): boolean {
  return merchant.brandingApprovedAgainst !== null
}

export function taskException(
  stepId: StepId,
  taskIndex: number,
  merchant: Merchant,
  ctx: ExceptionContext,
): TaskException | null {
  // A task that cannot run here has no result to fail. Left out, a skipped
  // task would inherit the verdict of an artefact describing work nobody did.
  if (taskSkipped(stepId, taskIndex, merchant)) return null
  const a = artifactFor(stepId, taskIndex, merchant)
  if (!a) return null

  switch (a.kind) {
    case "checks": {
      // `running` is not counted: a check still out with a provider has no
      // verdict, and treating silence as a failure invents one. The rail
      // reports that wait separately, as a wait.
      const failed = a.rows.filter((r) => r.state === "fail")
      if (failed.length > 0) {
        return {
          headline: `${failed.length} of ${a.rows.length} checks failed`,
          detail: `${failed[0].label} — ${failed[0].evidence}`,
          severity: "fail",
        }
      }
      /* A check that came back UNRESOLVED. Ranked below a failure and reported
         in its own register, because the two are different findings: a failed
         registry match means the filing contradicts what was submitted, while
         an unresolved one means nothing came back to compare against. Reading
         the second as the first would condemn a merchant on missing evidence;
         reading it as a pass — which is what happened — credits a comparison
         that was never made. */
      const unresolved = a.rows.filter((r) => r.state === "warn")
      if (unresolved.length === 0) return null
      return {
        headline: `${unresolved.length} of ${a.rows.length} checks unresolved`,
        detail: `${unresolved[0].label} — ${unresolved[0].evidence}`,
        severity: "warn",
      }
    }
    case "txns": {
      const blocking = a.rows.filter((r) => r.state === "fail" && r.fix?.blocking)
      if (blocking.length === 0) return null
      const first = blocking[0]
      return {
        headline: `${blocking.length} of ${a.rows.length} declined`,
        detail: `${first.ref} on ${first.unit} — ${first.result}. ${first.fix!.owner} clears it before this step can pass.`,
        // Already filtered to `fix.blocking`, so these genuinely stop the step.
        severity: "fail",
      }
    }
    case "records": {
      // Same widening as `checks` above, and the same reason: a records
      // artefact that reports its own outcome as `warn` was rendering that
      // sentence in amber directly beneath a green tick.
      if (a.outcome?.state !== "fail" && a.outcome?.state !== "warn") return null
      return {
        headline: a.outcome.headline,
        detail: a.outcome.detail,
        severity: a.outcome.state,
      }
    }
    case "brand": {
      // The `assets` face renders the inventory and no rules at all, so it
      // reports nothing to fail. The other two both display the gate, which is
      // why the theme task carries the exception as well as the checks task:
      // the blocking rule is on screen under both of their ticks.
      if (a.focus === "assets") return null
      // A design already on hardware in the field cannot be stopped by a rule
      // applied afterwards — see `brandingSettled`.
      if (brandingSettled(merchant)) return null
      const failed = blockers(ctx.brandRules)
      if (failed.length === 0) return null
      return {
        headline: `${failed.length} blocking brand rule${failed.length === 1 ? "" : "s"}`,
        // `problem` states what is WRONG; `label` states the condition that
        // would satisfy the rule, so falling back to it would describe the
        // passing case in a sentence reporting a failure.
        detail: `${failed[0].label} — ${failed[0].problem ?? failed[0].detail}`,
        // `blockers()` returns rules that BLOCK, so this is a stop, not a note.
        severity: "fail",
      }
    }
    default:
      return null
  }
}

/** Every exception in a step, keyed by the task whose artefact records it.
 *  One census, read by the row icons, the counter and the step badge, so the
 *  three cannot disagree about how many there are. */
/**
 * Whether a step carries an unresolved check the reader has not seen answered.
 *
 * Deliberately NOT folded into `haltedSteps`: that set feeds `laneState`, so
 * adding warnings there would move the file's POSITION backwards over a
 * registry that simply did not reply. Position and verdict are different
 * claims, and this one is only ever read by the rail marker.
 */
export function stepUnresolved(
  stepId: StepId,
  merchant: Merchant,
  ctx: ExceptionContext,
  /** REQUIRED, as everywhere else here: a default would answer for files it
   *  knows nothing about. */
  played: ReadonlySet<StepId>,
): boolean {
  // Nothing ran, so nothing came back unresolved — the same gate every other
  // artefact-derived verdict in this file sits behind.
  if (!stepHasRun(merchant, stepId, played)) return false
  for (const e of taskExceptions(stepId, merchant, 8, ctx).values()) {
    if (e.severity === "warn") return true
  }
  return false
}

export function taskExceptions(
  stepId: StepId,
  merchant: Merchant,
  taskCount: number,
  ctx: ExceptionContext,
): Map<number, TaskException> {
  const out = new Map<number, TaskException>()
  for (let i = 0; i < taskCount; i++) {
    const e = taskException(stepId, i, merchant, ctx)
    if (e) out.set(i, e)
  }
  return out
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
  ctx: ExceptionContext,
  /**
   * Steps whose agent run has been played this session.
   *
   * REQUIRED, and for the reason `laneState`'s arguments are: a default of
   * "none" is not a neutral omission, it is the claim that nothing has run, and
   * it would silently withhold findings on files that have plainly moved.
   * Surfaces with no session pass `NO_SESSION_PROGRESS`, which says so.
   */
  played: ReadonlySet<StepId>,
): { headline: string; detail: string; taskIndex?: number } | null {
  /* A recorded exception outranks everything below it, and until now this
   * function could not see one at all. `MerchantException` is the most
   * explicit "this step is stopped" object in the codebase — it names the
   * attempt, the finding, the source, the consequence and who owns the fix —
   * and it reached exactly one surface: a red line on the failing task row.
   * The step badge, the rail marker and the commit gate all read THIS
   * function, so all three carried on as though the step were clean, and
   * "Place the order" stayed live over a delivery address that does not
   * resolve.
   *
   * `taskIndex` IS carried here, unlike the census below. These tasks really
   * did stop: the merchant sits ON this step rather than past it, and the
   * named task attempted its job and could not complete it. */
  const stopped = exceptionOnStep(merchant, stepId)
  if (stopped) {
    return {
      headline: stopped.summary,
      detail: stopped.consequence,
      taskIndex: stopped.taskIndex,
    }
  }

  /* THE SIXTH REGISTER: an exception the fixture asserts, with no authored
     entry, whose only account of itself is a line in the timeline.
  
     Sits here — beside the authored exception, ABOVE the evidence gate — for
     the same reason that one does. An "Agent" line reading "Second shipment
     held in transit — commercial invoice rejected at the border" IS the record
     of a run: the agent could not have written it without having gone. Gating
     it on a second signal would suppress the only detail the file holds, which
     is precisely the failure being fixed: Glasswing showed "flagged as an
     exception, but no detail was recorded" while that sentence sat in its own
     timeline, unread by anything that renders an exception.
  
     Deliberately thinner than the authored branch. There is no `taskIndex`,
     because the timeline says which STEP stopped and not which task, and
     guessing one would put a red mark on a task chosen at random. */
  const located = locatedException(merchant)
  if (located && located.step === stepId) {
    return {
      headline: located.summary,
      /* Names the source instead of inventing a consequence. The authored
         exceptions carry a real `consequence`; this one has a sentence and an
         author, and padding the rest out to match would be fabricating the
         investigation rather than reporting it. Saying the record is
         incomplete is the honest version, and it is still far more than the
         "no detail was recorded" it replaces. */
      detail: `Recorded by ${located.actor} ${located.time}. This is the only detail on file for this step — the full exception record was never completed.`,
    }
  }

  /* NOTHING RAN, SO NOTHING WAS FOUND.
  
     Every rule below reads the step's own artefacts, and artefacts only exist
     once the agent has produced them. Without this line the rules were pure
     functions of the fixture, so they returned verdicts for steps the agent had
     never touched — Nordwind carried an Exception in the header while its B2
     panel read "Ready · 0/4 tasks", offered "Play agent run", and told you in
     the artefact pane that the task had not run yet. Four statements about one
     step, and the loudest of them was the only one that was wrong.
  
     It sits BELOW the authored exception on purpose. A `MerchantException`
     names the attempt, the finding and the source: it IS the record of a run,
     the most explicit one in the codebase, so gating it on a second signal
     would suppress the very findings that are best evidenced. Above it, and
     Tavo's unroutable address would vanish from a file that is stopped
     precisely because the agent went looking and could not resolve it.
  
     What this does NOT do is let the step read clean. It reads NOT STARTED,
     which is true, and the finding appears the moment the run is played — the
     agent finding it in front of you, rather than the app having known all
     along and said nothing about how. */
  if (!stepHasRun(merchant, stepId, played)) return null

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
  /* Capture stops on the SAME documents, and until now only underwriting said
   * so — capture's header read "Complete · 5/5 tasks" directly above its own
   * dossier saying the file could not be scored. The step where the bundle is
   * assembled is the first place the gap is visible and the only one with the
   * chase on it, so it has to report the block rather than let a downstream
   * step carry the news.
   *
   * `taskIndex` points at the document pass: that is the task that ran and came
   * up short, and a green tick on it would make the stronger claim. Same
   * `outstandingDocuments` call as the dossier and the chase, so the badge, the
   * panel and the request cannot disagree about what is missing. */
  if (stepId === CAPTURE_STEP) {
    const missing = outstandingDocuments(merchant)
    if (missing.length > 0) {
      return {
        headline: `Bundle incomplete — ${missing.length} document${missing.length === 1 ? "" : "s"} outstanding`,
        detail:
          "The agent classified, read and reconciled everything supplied, then stopped: the required set is short. The rest of capture ran on what is here, and the file cannot be scored until the remainder lands.",
        taskIndex: DOCUMENT_PASS_TASK,
      }
    }
  }
  /* Everything else comes from the per-task census, so the badge and the ticks
   * beneath it are reading one source. This used to inspect `txns` alone,
   * which is why a failing brand rule or a failed check left the step reporting
   * "Complete" — the step-level statement could only see one of the four ways
   * an artefact records a failure. Task indices are small and contiguous; 8
   * covers the longest step.
   *
   * NO `taskIndex` is carried: that field means "the agent stopped here", and
   * these tasks ran to completion and produced their artefacts. Passing it
   * would redraw them as halted and claim the step never got past them. */
  /* ONLY THE FAILURES BLOCK.
  
     The census now also records unresolved checks, which is what makes the
     tick above them honest — but this function is read by the step badge, the
     rail marker and the ship gate, so anything returned here is treated as
     "this step is stopped". Letting a `warn` through would hold a shipment
     because a registry did not answer, which is a heavier consequence than the
     evidence supports and would make the amber state unusable: every absence
     would become a halt.
  
     So the two split here, and only here. A warning still changes how the step
     LOOKS — the task row and the badge both read it off the same census — but
     it does not claim the step stopped. */
  const first = [...taskExceptions(stepId, merchant, 8, ctx).values()].find(
    (e) => e.severity === "fail",
  )
  return first ?? null
}

/**
 * Checks this step DISPATCHED that have not come back yet.
 *
 * "Every task ran" and "every answer arrived" are different claims, and the
 * parallel lanes make the gap between them routine: KYC sends a liveness check
 * out to a provider and the file legitimately carries on without it. The
 * merchant is presumed legitimate and is simply waiting on a third party — so
 * the wait has to be VISIBLE. A step that renders as finished leaves nobody
 * aware anything is outstanding, and the merchant sits waiting on a check no
 * one on this side can see is still open.
 *
 * Derived here, once, because three surfaces need it — the rail marker, the
 * step badge and the panel footer. Each counting for itself is how a badge
 * comes to read "Complete" over a spinner saying otherwise.
 *
 * Task indices are scanned to a fixed upper bound, exactly as `blockingFinding`
 * does: `artifactFor` returns null past the end of a step, so no task count has
 * to be passed in and two callers cannot disagree about how many there are.
 */
/**
 * `stepEvidenced`, plus the one thing the positional rule cannot see.
 *
 * An authored `MerchantException` names the attempt, the finding, the task that
 * produced it and its source. It IS a record of a run — the most explicit one
 * in the codebase — so a step carrying one has unambiguously been executed,
 * even though the file is still standing on it and the positional rule
 * therefore reports "not reached yet".
 *
 * Without this the app contradicted itself out loud: Tavo's B1 raised an
 * unroutable-address exception while the same panel offered "Play agent run"
 * over 0/4 tasks. Either the agent found the bad address or it never ran; both
 * could not be true.
 *
 * THE ONE definition of "has this step run", used by every rule below and by
 * the cockpit that renders the tasks, so the badge, the finding and the task
 * count cannot disagree about it.
 */
export function stepHasRun(
  merchant: Merchant,
  stepId: StepId,
  played: ReadonlySet<StepId>,
): boolean {
  if (exceptionOnStep(merchant, stepId)) return true

  /* The SECOND self-evidencing register, listed here for exactly the reason it
     sits above the gate in `blockingFinding`: an "Agent" timeline line reading
     "Second shipment held in transit — commercial invoice rejected at the
     border" could not have been written without the agent having gone. It is a
     weaker record than an authored exception — no task index, no consequence —
     but it is still a record OF A RUN, which is the only question asked here.
  
     Omitting it put the two functions into disagreement about one step:
     `blockingFinding` reported Glasswing's held shipment while this said the
     step had never run, so the cockpit would draw "Play agent run · 0/4 tasks"
     above the finding. That is the original contradiction moved one function to
     the left. THESE TWO LISTS MUST MATCH. */
  const located = locatedException(merchant)
  if (located?.step === stepId) return true

  /* The THIRD self-evidencing register: AN OUTSTANDING SIGN-OFF.
  
     "Needs sign-off" is an authored claim that a decision is still the
     acquirer's to take — and a decision is always ABOUT something. The agent
     drafts the theme, prices the tariff, shapes the application; you approve
     it. So the status cannot be true unless the run happened, exactly as an
     exception cannot be true unless the run happened.
  
     Missing it produced the same contradiction the two registers above exist to
     prevent, on four files: Nordwind Apotheke opened on B2 Branding badged
     "Needs sign-off" over "0/4 tasks", four un-run tasks, "This task has not run
     yet", and "Run the agent first — there is nothing to approve yet". The pill
     demanded a decision and the panel showed nothing to decide on.
  
     `statusPossibleAt` is the gate rather than a bare status check, and it is
     borrowed rather than restated: it already owns which statuses a step can
     legitimately carry, and its docstring names this very failure one level up
     — a sign-off on a step with no acquirer handoff is "a decision nobody can
     take, on a screen with no control to take it". Deferring to it means an
     impossible authored combination stays visible as the fixture bug it is,
     rather than being laundered into a claim that the agent ran.
  
     Scoped to `currentStep`: the status describes where the file is NOW. An
     earlier step whose sign-off was already given is covered by `stepEvidenced`
     below, on lane position. Deliberately NOT extended to "With merchant",
     where the wait can be on a physical act — a merchant installing terminals
     is no evidence that the agent produced anything. */
  if (
    merchant.status === "Needs sign-off" &&
    stepId === merchant.currentStep &&
    statusPossibleAt(stepId, merchant.status)
  ) {
    return true
  }

  return stepEvidenced(merchant, stepById(stepId), played)
}

export function outstandingChecks(
  stepId: StepId,
  merchant: Merchant,
  /** Runs played this session. REQUIRED, for the same reason as everywhere
   *  else: defaulting it would make the count answer confidently on files it
   *  knows nothing about. */
  played: ReadonlySet<StepId>,
): number {
  /* A CHECK CANNOT BE IN FLIGHT BEFORE ANYTHING DISPATCHED IT.
  
     These rows are read straight out of the fixture, so KYC reported a selfie
     check "in progress" on a step whose agent had never run — you opened R1,
     nothing had happened, and the rail was already showing a spinner for a
     provider nobody had called. That is the same defect as an exception with no
     run behind it: a state asserted from static data rather than derived from
     what actually took place.
  
     Before the run there is no wait, because there was no request. The step is
     NOT STARTED, which is both true and actionable — it tells you to press
     Play, where "in progress" told you to wait for something that was never
     going to arrive. */
  if (!stepHasRun(merchant, stepId, played)) return 0

  let n = 0
  for (let i = 0; i < 8; i++) {
    // A task that cannot run here dispatched nothing, so it can have nothing
    // outstanding — counting it would report a wait nobody is serving.
    if (taskSkipped(stepId, i, merchant)) continue
    const a = artifactFor(stepId, i, merchant)
    if (a?.kind === "checks") n += a.rows.filter((r) => r.state === "running").length
  }
  return n
}

/** The KYC step. Named, because the liveness rule below is about THIS step and
 *  a bare `10` beside the risk lane's 10 → 11 → 2 ordering reads as a rank. */
const KYC_STEP: StepId = 10

/**
 * Whether the second owner's liveness check is genuinely still out.
 *
 * Two conditions, and both are about the LANE, not the build:
 *
 *  - the lane must still be in flight — a `cleared` verdict means underwriting
 *    signed off, which it could not have done on an unreturned identity check;
 *  - and it must still be sitting ON KYC. `laneState` treats the steps ahead of
 *    the open one as finished, so a file parked at Underwriting has KYC behind
 *    it and its checks have all reported.
 *
 * A `referred` file is not open either: the referral IS the answer that came
 * back, and showing it as still waiting would offer a wait instead of the
 * decision someone has to make.
 */
function livenessOpen(merchant: Merchant): boolean {
  const lane = merchant.riskLane
  return lane.verdict === "in-flight" && lane.at === KYC_STEP
}

/**
 * Every step with checks still out, for the portfolio list.
 *
 * Returns the STEP as well as the count, and that is the whole point of the
 * shape: on the portfolio a file sits at its current step — SolMar reads "03
 * Install" — while the open check belongs to KYC, several steps back on the
 * other lane. A bare count beside the step pill would say "Install is in
 * progress", naming the wrong step and pointing anyone chasing it at the wrong
 * provider.
 *
 * A list, not a first match: the two lanes can each be waiting, and reporting
 * one would silently hide the other.
 *
 * Reached-ness comes from `laneState` — the same function the rail uses — and
 * NOT from a PIPELINE-index comparison against `currentStep`. `currentStep`
 * tracks the build/spine path only, so measuring a risk step against it is the
 * fork's own trap one level up: Ravenswood sits at Merchant capture with its
 * screening open, and an index gate would have decided KYC was unreached and
 * hidden the one genuinely outstanding check in the book.
 */
/**
 * Every step carrying an unresolved blocking finding.
 *
 * The set `laneState` needs in order to refuse a tick. It lives HERE, beside
 * `blockingFinding`, because this module imports `acquirer-data` and not the
 * reverse — which is the whole reason `laneState` takes the answer as an
 * argument rather than computing it.
 *
 * ONE implementation, deliberately. The journey built this set inline for its
 * amber marker while the ship gate re-derived the same judgement in its own
 * loop; two surfaces answering "is this step blocked?" from separate code is
 * how they come to disagree about a single file. Both call this now.
 */
export function haltedSteps(
  merchant: Merchant,
  ctx: ExceptionContext,
  /** Runs played this session. REQUIRED — see `blockingFinding`. */
  played: ReadonlySet<StepId>,
): ReadonlySet<StepId> {
  const out = new Set<StepId>()
  for (const s of PIPELINE) {
    if (blockingFinding(s.id, merchant, ctx, played)) out.add(s.id)
  }
  return out
}

/**
 * Every step that is NOT SETTLED — halted or unresolved.
 *
 * THIS is the set `laneState` wants, and the split from `haltedSteps` is the
 * point. A halt and an unanswered check are different findings, reported
 * differently (red vs amber, "Exception" vs "Unresolved"), but they hold the
 * lane IDENTICALLY: neither lets the step behind it start. Pricing a merchant
 * whose registry never replied is the same mistake as pricing one whose
 * registry contradicted the filing — in both cases the entity was never
 * confirmed, and only the reason differs.
 *
 * Kept separate rather than widening `haltedSteps` because that set also drives
 * the red halt marker and `effectiveStatus`; folding warnings in would promote
 * every silent provider into a full halt and lose the amber register entirely.
 */
export function openSteps(
  merchant: Merchant,
  ctx: ExceptionContext,
  /** Runs played this session. REQUIRED — see `blockingFinding`. */
  played: ReadonlySet<StepId>,
): ReadonlySet<StepId> {
  const out = new Set<StepId>(haltedSteps(merchant, ctx, played))
  for (const s of PIPELINE) {
    if (stepUnresolved(s.id, merchant, ctx, played)) out.add(s.id)
  }
  return out
}

/**
 * `haltedSteps` for a whole book, in the shape `effectiveStatus` consumes.
 *
 * ONE builder, deliberately. Four surfaces need a merchant's status — the
 * portfolio table, the KPI cards, the nav badge and the agent bar — and if each
 * assembled this map itself they would differ in exactly the way that produced
 * the original bug: whichever one forgot would go on reporting "On track" over a
 * halt the others could see.
 *
 * `themeFor` is passed in because the brand rules are measured against the LIVE
 * studio theme, which lives in React state. A default would have to invent one,
 * and inventing a theme here is how a book-level read comes to disagree with the
 * screen the user is actually looking at.
 */
export function haltedByMerchant(
  merchants: readonly Merchant[],
  themeFor: (m: Merchant) => BrandTheme,
  /** Runs played this session, per merchant. Passed in for the same reason
   *  `themeFor` is: the played set lives in React state, and inventing one here
   *  is how a book-level read comes to disagree with the screen. A book surface
   *  that genuinely has no session returns `NO_SESSION_PROGRESS`. */
  playedFor: (m: Merchant) => ReadonlySet<StepId>,
): ReadonlyMap<string, ReadonlySet<StepId>> {
  const out = new Map<string, ReadonlySet<StepId>>()
  for (const m of merchants) {
    out.set(m.id, haltedSteps(m, { brandRules: checkBrand(themeFor(m)) }, playedFor(m)))
  }
  return out
}

export function pendingCheckSteps(merchant: Merchant): { step: StepId; count: number }[] {
  const out: { step: StepId; count: number }[] = []
  for (const s of PIPELINE) {
    // Artefacts are derived from the merchant and exist whether or not the
    // agent got there, so an ungated read would report a wait on work nobody
    // has started.
    //
    // NO_HALTS: the portfolio's book-level read has no session theme to measure
    // the brand rule against. Safe here specifically because this gates
    // REACHED-ness only, and a halted step is "active" — still reached — so the
    // count returned for it is the same either way.
    if (
      laneState(merchant, s, NO_SESSION_PROGRESS, NO_HALTS, NO_SESSION_PROGRESS) ===
      "upcoming"
    )
      continue
    /* NO_SESSION_PROGRESS is the honest argument for a book-level read: this
       surface has no session, so the only runs it can vouch for are the ones
       the file's own position implies. It will therefore under-report a wait
       the presenter has just started in another tab, which is the safe
       direction — silence about a new wait, never a claim about an old one. */
    const n = outstandingChecks(s.id, merchant, NO_SESSION_PROGRESS)
    if (n > 0) out.push({ step: s.id, count: n })
  }
  return out
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
    /* 01 Merchant capture.
     *
     * Capture is document-led: the merchant hands over a bundle, and tasks 1-5
     * are the agent reading, quality-checking and reconciling it before anything
     * is enriched. Everything below is DERIVED from the merchant — filenames are
     * the one exception, since a merchant's own file naming is arbitrary by
     * nature and that is exactly why task 1 has to classify it. */
    /* THE DOCUMENT DOSSIER — one panel for the whole bundle.
     *
     * Was five artefacts across five tasks. The failure was not that each was
     * wrong, it was that the file's actual status existed nowhere: the missing
     * documents were on one panel, the files received on another, the fields
     * learned on a third. An acquirer opening this step wants one answer —
     * where does this application stand, and what do I do next — and had to
     * build it from three screens.
     *
     * Everything here derives from the merchant, so the four sections cannot
     * contradict each other or the chase. */
    case "1.0": {
      const reg = registryFor(merchant)
      const missing = outstandingDocuments(merchant)

      /* The bundle as received. Quality is merged INTO the row rather than
         living on a separate panel: "which document is this" and "is it any
         good" are two questions about the same piece of paper, and reading
         them apart is what let a legible, in-date, wrong-type document look
         fine on both screens. */
      const files: DossierFile[] = [
        {
          filename: "incorporation_cert.pdf",
          classified: "Incorporation certificate",
          quality: {
            state: "pass",
            evidence: "Legible, in date, matches the expected certificate layout",
          },
        },
        {
          filename: "utility_mar.pdf",
          classified: "Proof of address",
          quality: { state: "pass", evidence: "Legible, dated within the last 3 months" },
        },
        {
          filename: "passport_scan.jpg",
          classified: "Director ID",
          quality: { state: "pass", evidence: "Legible, in date, photo page captured" },
        },
        {
          filename: "statement.pdf",
          classified: "Bank statement",
          quality: {
            state: "pass",
            evidence: "Legible, dated within the last 3 months, account holder matches the legal name",
          },
        },
        {
          // No quality verdict on purpose: until the type is known there is
          // nothing to check it against, and a tick here would report a check
          // that never ran.
          filename: "img_4471.jpg",
          classified: null,
          review: "No document type matched. Confirm what this is, or ask the merchant to re-send it.",
        },
      ]

      /* Required vs received, derived from the merchant's own outstanding list.
         A hand-written "second owner ID outstanding" would go on asserting
         itself for merchants whose file is short of something else entirely. */
      const required: DossierRequirement[] = [
        { label: "Incorporation certificate", received: "incorporation_cert.pdf" },
        { label: "Proof of address", received: "utility_mar.pdf" },
        { label: "Director / beneficial-owner ID", received: "passport_scan.jpg" },
        { label: "Bank statement", received: "statement.pdf" },
        ...missing.map<DossierRequirement>((label) => ({ label, received: null })),
      ]

      /* What the bundle TOLD us. Extraction and reconciliation merged: a field
         read off one document and the same field agreeing across two are the
         same claim at different strengths, so `corroborated` carries that
         rather than a second panel repeating the list. */
      const findings: DossierFinding[] = [
        {
          label: "Legal name",
          value: merchant.name,
          source: "Incorporation certificate, matched on the bank statement",
          corroborated: true,
        },
        {
          label: "Company number",
          value: reg?.number ?? null,
          // Read here, CONFIRMED against the register at the next task. Saying
          // "confirmed" now would credit a check that has not run.
          source: reg
            ? "Incorporation certificate — not yet corroborated independently"
            : "The certificate carries one, but this country has no register rule on file",
        },
        {
          label: "Registered address",
          value: merchant.location,
          source: "Proof of address, matched on the certificate",
          corroborated: true,
        },
        {
          label: "Settlement account",
          value: maskedAccountFor(merchant),
          source: "Bank statement",
        },
        { label: "Directors", value: "2 named", source: "Incorporation certificate" },
        {
          label: "Trading name",
          value: "Matches the registered entity",
          source: "Website footer vs incorporation certificate",
          corroborated: true,
        },
      ]

      return {
        kind: "dossier",
        title: "Document dossier",
        note:
          missing.length > 0
            ? `${files.length} files received. ${missing.length} required ${missing.length === 1 ? "document is" : "documents are"} still outstanding — the file cannot be scored until they arrive.`
            : `${files.length} files received. Everything required to open the file is here.`,
        files,
        required,
        findings,
        // Absent when nothing is outstanding, rather than a disabled block. A
        // dead chase button on a complete file invites the reader to hunt for a
        // problem that is not there.
        ...(missing.length > 0
          ? {
              chase: {
                items: missing,
                channel: "merchant portal",
                note: "Sends one request for everything outstanding. One message, not one per document — a merchant who gets three emails about one pile of paperwork answers none of them.",
              },
            }
          : {}),
      }
    }
    /* Registry enrichment is the first INDEPENDENT source on this step —
     * everything before it came from the applicant. Saying which register
     * confirmed it is the whole value; "confirmed" on its own is unre-runnable. */
    case "1.1": {
      const reg = registryFor(merchant)
      if (!reg) {
        return {
          kind: "checks",
          title: "Registry enrichment",
          note: `No companies register is wired up for ${countryOf(merchant.location)}, so nothing here was corroborated independently. The documents stand on their own until someone checks them.`,
          rows: [
            {
              label: "Independent corroboration",
              /* `n/a`, not `warn`: no register exists for this country, so no
                 answer is outstanding and none can be chased. As a warning it
                 held capture open on every Estonian file for a reply that was
                 never coming. The note above already says the documents stand
                 on their own — this is a limit of the check, not a gap in the
                 file. */
              state: "n/a",
              evidence: "Not attempted — no register on file for this country",
            },
          ],
        }
      }
      return {
        kind: "checks",
        title: "Registry enrichment",
        note: `Corroborated against ${reg.name} — a source independent of the applicant.`,
        rows: [
          {
            label: "Company number",
            state: "pass",
            evidence: `${reg.number} confirmed against ${reg.name}`,
          },
          {
            label: "Directors",
            state: "pass",
            evidence: `Both names on the certificate matched to the current ${reg.name} filing`,
          },
          {
            label: "Tax ID",
            state: "pass",
            evidence: `Validated — ${vatFor(merchant) ?? "no tax rule on file for this country"}`,
          },
        ],
      }
    }
    /* The one thing on this step the agent INFERRED rather than read. It is
     * kept as its own panel, and its note says so, because an inference filed
     * alongside extracted and registry-confirmed fields would inherit their
     * standing — and this one is a reading of a website, not a record. */
    case "1.2":
      return {
        kind: "records",
        title: "Web research",
        note: "Inferred from the open web, for your confirmation — not a decision.",
        rows: [
          {
            label: "Website reviewed",
            value: websiteFor(merchant),
            source: "found from the registered entity name",
          },
          {
            label: "Business the agent inferred",
            value: inferredBusinessFor(merchant),
            source: "read off the site's own copy",
          },
          {
            label: "Stated sector",
            value: `${merchant.sector} — corroborated by the website`,
            source: "compared against your submission",
          },
          {
            label: "Trading name",
            value: "Matches the registered entity",
            source: "site footer vs incorporation certificate",
          },
          {
            label: "Prohibited or restricted categories",
            value: "None detected on the site",
            source: "scanned against your restricted-trades list",
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
    case "1.3": {
      const { home, local, peers, crossBorderOnly } = bookPeersByDistance(
        merchant.location,
        merchant.sector,
        distanceKm,
      )

      /* The comparator basis travels WITH the recommendation rather than sitting
       * in a table of its own. "6× A920" is only defensible because merchants
       * like this one run that today, and a device mix on one screen with its
       * evidence on another is a number the reader has to take on trust. Both
       * are derived from the same call, so the count and the kit cannot drift.
       *
       * Three merchants are the only one of their sector in the whole book
       * (Health & Fitness, Leisure, Automotive). An absence is not a result:
       * that case says the kit was sized from the survey, rather than implying a
       * comparator existed. */
      const basis =
        peers.length === 0
          ? `No comparator — this is the only ${merchant.sector.toLowerCase()} merchant in your book, so the mix is sized from the site survey rather than read across from anyone.`
          : crossBorderOnly
            ? `Look-alike merchants in your book: ${peers.length}. Your book holds none in ${home}, so every comparator is cross-border — interchange and scheme mix differ, read the sizing with that in mind.`
            : `Look-alike merchants in your book: ${peers.length} live ${merchant.sector.toLowerCase()} ${
                peers.length === 1 ? "merchant" : "merchants"
              } in ${home}${
                local.length > peers.length ? ` (closest ${peers.length} of ${local.length})` : ""
              }, ranked by distance from ${merchant.location}.`

      return {
        kind: "basket",
        title: "Recommended kit",
        note: `${basis} Expected annual card volume ${merchant.size}, banded. Adjust the mix before it becomes an order.`,
      }
    }
    /* The drafted application record. This task used to produce nothing, and
     * the panel said so — but "wrote to the trace" is exactly the claim an
     * acquirer cannot check, on the one task whose whole point is that the
     * agent filled your form for you. Each row names WHERE the value came
     * from, so pre-filled is distinguishable from asserted.
     *
     * The company number and settlement account used to be carried here as gaps
     * closing later, at KYC and with the document chase. They are NOT gaps any
     * more: capture now reads a bank statement (task 2) and corroborates the
     * registration against the register (task 6), so leaving those rows empty
     * would have this panel reporting fields missing that three tasks above it
     * on the same step had just filled. */
    case "1.4": {
      const vat = vatFor(merchant)
      const reg = registryFor(merchant)
      return {
        kind: "records",
        title: "Drafted application",
        // Was "Written into your CRM …. Every field is editable" — two claims,
        // both false and mutually contradictory. Nothing had been written (no
        // control on the screen wrote anything) and nothing was editable (every
        // row rendered as flat text). It now says what is true before the push,
        // and the push below is what makes the first half true.
        note: "The agent has filled in your application form. Nothing has left this screen yet — correct anything it got wrong, then send it.",
        handoff: {
          system: `${ACQUIRER.name} CRM`,
          action: "Push to CRM",
          commits:
            "The record is created under your name in your system of record, and underwriting picks the file up from there. Anything you retyped goes as your figure, not the agent's.",
          delivers: "A merchant record with these fields, the source note against each one, and the document bundle attached.",
        },
        rows: [
          { label: "Legal name", value: merchant.name, source: "from incorporation certificate", writable: true },
          {
            label: "Trading sector",
            value: merchant.sector,
            source: "normalised from free text, corroborated by the website",
            writable: true,
          },
          { label: "Registered address", value: merchant.location, source: "from proof of address", writable: true },
          { label: "Expected annual volume", value: merchant.size, source: "banded from your submission", writable: true },
          { label: "Device count", value: `${merchant.terminalCount}`, source: "derived from the recommended kit", writable: true },
          { label: "Tax treatment", value: vat, source: vat ? "derived from country" : "country not in the rules table", writable: true },
          {
            label: "Company number",
            value: reg?.number ?? null,
            source: reg ? `confirmed against ${reg.name}` : "no register on file for this country",
            writable: true,
            ...(reg
              ? {}
              : {
                  // The resolution has always said "key it in from the
                  // certificate" — and until this row became writable there was
                  // nowhere to key it in. An instruction the interface does not
                  // support is a defect with a polite voice.
                  resolution: {
                    owner: "Acquirer",
                    when: "key it in from the certificate before sign-off",
                    blocking: false,
                  },
                }),
          },
          {
            label: "Settlement account",
            value: maskedAccountFor(merchant),
            source: "read off the bank statement at capture",
            writable: true,
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
          /* AN ABSENT RECORD IS NOT A FAILED CHECK — and the row two lines
             below already knew it. `edgeCase` is a PROBLEM field, so its
             absence means "nothing to report" and renders a pass. `identity`
             is an EVIDENCE field, and reading its absence through the same
             truthiness test inverted the polarity: the 20 merchants carrying
             no authored underwriting detail every one showed a permanent
             amber "No registry response on file" — a failed check
             manufactured out of a missing fixture, sitting on files whose own
             `riskLane.verdict` said `cleared`.

             Not one merchant in the app is authored WITH a registry gap: all
             three that carry an `underwriting` record set `identity`. So
             every instance of this warn was the bug, never a scenario.

             And it could not be cleared. `withResolvedChecks` returns early
             on `!uw`, so for exactly the merchants showing the warn the
             "Simulate: outstanding check answered" lever recorded itself as
             used — its Undo twin appeared — and changed nothing. That is the
             worst shape a control can take: not disabled, not failing, just
             silently inert, which is why the step could not be completed no
             matter which button was pressed.

             The three cases are now named instead of collapsed: no record =
             nothing authored against this file, a record WITH evidence = pass
             and quote it, a record WITHOUT it = the authored gap. */
          {
            label: "Registry match",
            state: !uw || uw.identity ? "pass" : "warn",
            evidence: uw
              ? (uw.identity ?? "No registry response on file")
              : "Company number matched to the active filing",
          },
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
          // The one row that can be left OPEN, and the reason this panel
          // exists: the build lane keeps moving behind it. A tick on every
          // merchant would make the parallel design invisible by showing a
          // lane with nothing running.
          //
          // But it was UNCONDITIONALLY running, which was invisible while it
          // only showed inside this one panel and became a false claim the
          // moment the portfolio surfaced it: two LIVE merchants were reported
          // as still waiting on a selfie check. A check cannot outlive the
          // decision it fed — underwriting could not have signed off, and the
          // merchant could not have gone live, on an identity that never came
          // back. So the lane's own verdict decides, and `livenessOpen` states
          // that rule once for every caller.
          livenessOpen(merchant)
            ? {
                label: "Liveness",
                state: "running" as const,
                evidence:
                  "Second owner's selfie check is with the provider — typically clears within the hour",
              }
            : {
                label: "Liveness",
                state: "pass" as const,
                evidence: "Second owner's selfie check returned a match",
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
      // because that is what it is: a small set of stated values, each with a
      // source. Every figure is RETURNED BY THE ACQUIRER'S OWN RISK ENGINE —
      // the step delegates to it (`delegate.system: "Your risk model"`), so
      // nothing here is Ingenico's view to offer, revise or replace.
      const scored = recordedScore(merchant) !== null
      return {
        kind: "records",
        title: "Exposure and acceptance limit",
        note: "What the acquirer would be left carrying if this merchant took payment and disappeared.",
        governed: {
          system: "your risk engine and credit policy",
          why: "Ingenico reads these values over API and applies them as returned. The agent does not weight the factors, set the limit, or proceed against it.",
          change: "To move a limit, change the rule in your credit policy and re-run this step — the new figure flows through here.",
        },
        rows: [
          {
            label: "Risk category",
            value: scored ? "Standard retail" : null,
            source: scored ? "your credit policy — category rules" : "cannot be assigned on an unscored file",
          },
          {
            // Not "Recommended" — a recommendation is something the reader may
            // decline, and this is their own engine's ruling coming back.
            label: "Daily limit",
            // Withheld, not zeroed. A limit of £0 reads as a decision to accept
            // nothing, which is a rejection nobody made.
            value: scored ? "£14,000 / day" : null,
            source: scored
              ? "your credit policy — standard retail rule, on projected volume"
              : "your policy returns no limit until the file is scored",
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
        // "Confirmed by the Ingenico order desk" attributed this to a party
        // that has not been asked yet — they are engaged once the order is
        // placed, and their answer is what the handoff returns. This panel is
        // the published position, which is an indication, not a commitment.
        kind: "stock",
        title: "Availability",
        note: "Indicative, from Ingenico's published stock position. The order desk commits to it once you place the order.",
      }
    case "3.2":
      return {
        kind: "delivery",
        title: "Delivery",
        note: "Where it ships to, from where, and the earliest date the network can commit to.",
        verdict: deliveryVerdict(merchant),
      }
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
            /* Mains-powered units have no battery to test. Reporting a pass
               would attest to a check that could not have run — but `warn` was
               wrong in the other direction: it filed a permanent fact as an
               open question, and once warnings hold the lane that stalled Test
               on every mains-only order, waiting for a battery reading that
               can never arrive. */
            state: battery.length > 0 ? "pass" : "n/a",
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
        // Was "What went into your systems, and where" — past tense, on a panel
        // with no control that put anything anywhere. Same defect as the drafted
        // application: the closing write of the whole journey was reported as
        // already done, so nobody was ever asked.
        note: "What the agent will close the file with. None of it is yours to retype — these are read back off the host — but the write itself is yours to authorise.",
        handoff: {
          system: `${ACQUIRER.name} CRM`,
          action: "Close the record",
          commits:
            "The onboarding file is closed against this merchant and the underwriting signatory travels with it. The go-live notice goes out on the back of this write.",
          delivers: "The merchant record updated to live, the device count, and the signed underwriting decision attached to it.",
        },
        // No `writable` flags anywhere here. Every one of these is a value read
        // back off another system: retyping the Merchant ID would not rename it
        // on the host, it would only make this screen lie about what the host
        // holds. Editability is not a courtesy, it is a claim that the edit
        // lands somewhere.
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
        // Was "Sent to you and to the merchant" — past tense, on a draft that
        // nobody had sent. This is the one artefact that leaves the company
        // entirely, so it was also the worst place to assume the send.
        note: "Drafted for you and the merchant — the same text to both, so neither is told something the other is not. Nothing has gone out yet.",
        filename: `go-live-${merchant.id.replace("m-", "")}.pdf`,
        handoff: {
          system: "the merchant",
          action: "Send the notice",
          commits:
            "This goes to the merchant and to you, over your name. It is the message that tells them they can take payment.",
          delivers: "The text above, as written, to the merchant's registered contact and your own inbox.",
        },
        lines: [
          `${merchant.name} is live.`,
          ``,
          `Merchant ID   ${merchant.id.replace("m-", "MID-").toUpperCase()}`,
          `Devices       ${deviceUnits(merchant).length} active`,
          `Acquirer      ${ACQUIRER.name}`,
          `Settlement    Daily, 23:00 local — first settlement one working day`,
          `              after the first live payment.`,
          ``,
          // Was "The onboarding record has been written back to your CRM."
          // That write is now a button on the Write-back artefact, so this
          // line could go out to a merchant asserting a CRM entry that nobody
          // had made. A notice must not vouch for a step taken on a different
          // screen — it names where the record sits, not that it arrived.
          `Your onboarding record closes against ${ACQUIRER.name}. Fleet`,
          `monitoring passes to Ingenico operations from this point; the`,
          `merchant relationship does not.`,
        ],
      }

    default:
      return null
  }
}
