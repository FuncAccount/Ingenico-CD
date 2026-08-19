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
import { riskAssessment } from "@/lib/underwriting"

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

/* --------------------------------------------------------------- artefacts */

export interface RecordRow {
  label: string
  value: string | null
  /** Where the value came from, so a figure is never orphaned from its source. */
  source?: string
}

export interface CheckRow {
  label: string
  state: "pass" | "warn" | "fail"
  /** What was actually compared — a green tick with no comparison is decoration. */
  evidence: string
}

export interface TableArtifact {
  columns: string[]
  rows: string[][]
}

export type Artifact =
  | { kind: "basket"; title: string; note: string }
  | { kind: "stock"; title: string; note: string }
  | { kind: "delivery"; title: string; note: string }
  | { kind: "pricing"; title: string; note: string }
  | { kind: "records"; title: string; note: string; rows: RecordRow[] }
  | { kind: "checks"; title: string; note: string; rows: CheckRow[] }
  | { kind: "table"; title: string; note: string; table: TableArtifact }
  | { kind: "document"; title: string; note: string; filename: string; lines: string[] }
  // The three below are decision surfaces rather than read-outs: the acquirer
  // changes something here, and the change is what the sign-off then rests on.
  | { kind: "risk"; title: string; note: string }
  | { kind: "edge"; title: string; note: string }
  | { kind: "brand"; title: string; note: string }

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
      const peers = MERCHANTS.filter((m) => m.sector === merchant.sector && m.id !== merchant.id)
      const counts = peers.map((m) => m.terminalCount).sort((a, b) => a - b)
      const median = counts.length
        ? counts.length % 2
          ? counts[(counts.length - 1) / 2]
          : (counts[counts.length / 2 - 1] + counts[counts.length / 2]) / 2
        : null
      return `match.similar → ${peers.length} ${merchant.sector.toLowerCase()} merchants${
        median === null ? ", no median available" : `, median ${median} terminals`
      }`
    }
    // Derived, not typed. The static line said "18 / 100" and would have gone
    // on saying it regardless of what the factor table underneath computed.
    case "2.3": {
      const a = riskAssessment(merchant)
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

function countryOf(merchant: Merchant): string {
  return merchant.location.split(",").pop()?.trim() ?? ""
}

export function localeFor(merchant: Merchant): string | null {
  return COUNTRY_RULES[countryOf(merchant)]?.locale ?? null
}

export function vatFor(merchant: Merchant): string | null {
  return COUNTRY_RULES[countryOf(merchant)]?.vat ?? null
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
          { label: "Company number", value: null, source: "not supplied at intake" },
        ],
      }
    case "1.1": {
      const peers = MERCHANTS.filter(
        (m) => m.sector === merchant.sector && m.id !== merchant.id,
      ).slice(0, 5)
      return {
        kind: "table",
        title: `Look-alike merchants in your book (${peers.length})`,
        note: `Matched on sector only. Sector is the one attribute every record carries, so a closer match would narrow the set below a useful size.`,
        table: {
          columns: ["Merchant", "Location", "Volume", "Devices"],
          rows: peers.map((m) => [m.name, m.location, m.size, m.terminals]),
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
          { label: "Company number", value: null, source: "retrieved at underwriting, not at intake" },
          { label: "Settlement account", value: null, source: "collected from the merchant with the KYB documents" },
        ],
      }
    }

    /* 02 Underwrite */
    case "2.0":
      return {
        kind: "checks",
        title: "Identity and screening",
        note: "Each check names what it compared, so a pass can be re-run rather than taken on trust.",
        rows: [
          { label: "Registry match", state: uw?.identity ? "pass" : "warn", evidence: uw?.identity ?? "No registry response on file" },
          { label: "Sanctions / PEP", state: "pass", evidence: "Screened against EU + OFAC consolidated lists" },
          { label: "Beneficial ownership", state: uw?.edgeCase ? "warn" : "pass", evidence: uw?.edgeCase ?? "All owners above 25% identified" },
        ],
      }
    case "2.1":
      return {
        kind: "checks",
        title: "Principal screening",
        note: "Run against every beneficial owner above 25%, not just the applicant.",
        rows: [
          { label: "Sanctions", state: "pass", evidence: "EU, OFAC and UK HMT consolidated lists — no match" },
          { label: "PEP", state: "pass", evidence: "No politically exposed person among the named owners" },
          {
            label: "Adverse media",
            state: uw?.edgeCase ? "warn" : "pass",
            evidence: uw?.edgeCase ?? "No adverse media returned in the 5-year window",
          },
        ],
      }
    case "2.2":
      return {
        kind: "records",
        title: "Documents",
        note: "Collected from the merchant and checked for legibility, consistency and expiry.",
        rows: [
          { label: "Documents received", value: uw?.documents ?? null, source: "merchant upload" },
          { label: "Cross-field consistency", value: uw ? "No inconsistencies found" : null, source: "document AI" },
          { label: "Expiry", value: "All documents in date", source: "document AI" },
        ],
      }
    // The score is what the regulated sign-off rests on, so it is decomposed
    // rather than quoted. The old prose memo that restated the score and the
    // edge case is deleted: it was a second copy of both claims, free to drift.
    case "2.3":
      return {
        kind: "risk",
        title: "Risk score",
        note: "Every factor behind the number, and what each was measured against.",
      }
    case "2.4":
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
        title: "Brand assets and design",
        note: "What the merchant gave us, and what you make of it. Edits proof live.",
      }
    case "4.1":
      return {
        kind: "brand",
        title: "Device theme",
        note: "The screens the theme reaches. PIN entry is excluded by the hardware.",
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
        title: "Proof and brand checks",
        note: "What the customer will see, and what must pass before it can ship.",
      }

    /* 05 Configure */
    case "5.0":
      return {
        kind: "records",
        title: "Terminal configuration",
        note: "The parameter set that will be pushed to every device on this order.",
        rows: [
          { label: "Acquirer BIN", value: "452110", source: "acquirer profile" },
          { label: "Currencies", value: "EUR, GBP", source: "merchant profile" },
          { label: "Contactless limit", value: "€50.00", source: "scheme default for country" },
          { label: "Tipping", value: merchant.sector === "Hospitality" ? "Enabled" : "Disabled", source: "sector default" },
          { label: "Receipt", value: "Print merchant copy, email customer copy", source: "acquirer template" },
        ],
      }
    case "5.1":
      return {
        kind: "checks",
        title: "Configuration validation",
        note: "Run against the parameter set before it is allowed to leave the building.",
        rows: [
          { label: "Scheme rules", state: "pass", evidence: "Contactless limit within Visa/MC ceiling for the country" },
          { label: "Currency support", state: "pass", evidence: "All listed currencies enabled on BIN 452110" },
          { label: "PCI parameter set", state: "pass", evidence: "P2PE profile INGP2PE-4 applied" },
        ],
      }

    /* 06 Test */
    case "6.0":
      return {
        kind: "checks",
        title: "Test transactions",
        note: "Run end to end against the acquirer's certification host.",
        rows: [
          { label: "Contactless sale", state: "pass", evidence: "EUR 1.00 approved, auth 0X41B9, 1.2s round trip" },
          { label: "Chip and PIN sale", state: "pass", evidence: "EUR 1.00 approved, auth 0X41C0" },
          { label: "Refund", state: "pass", evidence: "EUR 1.00 refunded against original auth" },
          { label: "Offline / store-and-forward", state: "warn", evidence: "Approved on reconnect after 40s — above the 30s target" },
        ],
      }

    /* 07 Ship */
    case "7.0":
      return { kind: "delivery", title: "Shipment tracking", note: "The consignment in flight, against the date committed at order." }
    case "7.1":
      return { kind: "stock", title: "Dispatched lines", note: "What actually left each site, against what the order asked for." }

    /* 08 Install */
    case "8.0":
      return {
        kind: "checks",
        title: "Installation sign-off",
        note: "Confirmed on site, device by device.",
        rows: [
          { label: "Devices powered and paired", state: "pass", evidence: `${merchant.terminalCount} of ${merchant.terminalCount} devices reachable` },
          { label: "Network", state: "pass", evidence: "Wi-Fi primary, 4G fallback tested on each device" },
          { label: "Staff walkthrough", state: "pass", evidence: "Completed with the duty manager" },
        ],
      }

    /* 09 Go-live */
    case "9.0":
      return {
        kind: "records",
        title: "Go-live record",
        note: "The state of the merchant at the moment the account was opened for live traffic.",
        rows: [
          { label: "Merchant ID", value: merchant.id.replace("m-", "MID-").toUpperCase(), source: "acquirer host" },
          { label: "Devices live", value: String(merchant.terminalCount), source: "terminal estate" },
          { label: "First live transaction", value: null, source: "not yet observed" },
          { label: "Settlement account", value: "Verified", source: "penny-test confirmed" },
        ],
      }

    default:
      return null
  }
}
