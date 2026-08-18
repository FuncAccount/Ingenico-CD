import type { Merchant } from "./acquirer-data"

/**
 * THE PHYSICAL SIDE OF THE JOURNEY.
 *
 * Steps 5-7 (Configure, Test, Ship) are where Ingenico stops being an
 * observer and starts doing the work. The acquirer's screens can treat these
 * as "Automate — watch"; Ingenico cannot, because underneath sits a real
 * question with a real trade-off: which warehouse holds the stock, can one
 * site cover the whole order, and what does speed cost.
 *
 * Two things this module refuses to do:
 *
 *  1. Pick a warehouse silently. The nearest site and the site that can cover
 *     the order are frequently not the same, and that tension IS the decision.
 *     Candidates are ranked and the conflict is named.
 *  2. Report on hardware that does not exist. softPOS is a licence on the
 *     merchant's own phone — it has no stock, no shipment and no serial. A
 *     fleet that quietly counted it would overstate the estate.
 */

export type ModelId = "A920" | "Move 5000" | "Desk 5000" | "softPOS"

export interface DeviceModel {
  id: ModelId
  label: string
  /** Software-only products have no warehouse, no carrier and no serial. */
  physical: boolean
  /** Mains-powered units report no battery. That is an absent reading, not 0%. */
  battery: boolean
  form: string
}

export const MODELS: Record<ModelId, DeviceModel> = {
  A920: { id: "A920", label: "A920", physical: true, battery: true, form: "Portable smart terminal" },
  "Move 5000": { id: "Move 5000", label: "Move 5000", physical: true, battery: true, form: "Portable card terminal" },
  "Desk 5000": { id: "Desk 5000", label: "Desk 5000", physical: true, battery: false, form: "Countertop terminal" },
  softPOS: { id: "softPOS", label: "softPOS", physical: false, battery: false, form: "Software on merchant device" },
}

/* ---------------------------------------------------------------- geography */

interface Point { lat: number; lon: number }

const CITIES: Record<string, Point> = {
  "Manchester, UK": { lat: 53.48, lon: -2.24 },
  "Lisbon, PT": { lat: 38.72, lon: -9.14 },
  "Hamburg, DE": { lat: 53.55, lon: 9.99 },
  "Málaga, ES": { lat: 36.72, lon: -4.42 },
  "Dublin, IE": { lat: 53.35, lon: -6.26 },
  "Milan, IT": { lat: 45.46, lon: 9.19 },
  "Bergen, NO": { lat: 60.39, lon: 5.32 },
  "Amsterdam, NL": { lat: 52.37, lon: 4.9 },
  "Edinburgh, UK": { lat: 55.95, lon: -3.19 },
  "Marseille, FR": { lat: 43.3, lon: 5.37 },
  "Stuttgart, DE": { lat: 48.78, lon: 9.18 },
  "Valencia, ES": { lat: 39.47, lon: -0.38 },
  "Cologne, DE": { lat: 50.94, lon: 6.96 },
  "Copenhagen, DK": { lat: 55.68, lon: 12.57 },
  "Naples, IT": { lat: 40.85, lon: 14.27 },
  "Tallinn, EE": { lat: 59.44, lon: 24.75 },
  "Leeds, UK": { lat: 53.8, lon: -1.55 },
}

export interface Warehouse {
  id: string
  name: string
  city: string
  at: Point
  /** On-hand units per model. A model absent from this map is not stocked here
   *  at all, which is different from being stocked at zero. */
  stock: Partial<Record<ModelId, number>>
  cutoff: string
}

export const WAREHOUSES: Warehouse[] = [
  {
    id: "wh-rtm",
    name: "Rotterdam DC",
    city: "Rotterdam, NL",
    at: { lat: 51.92, lon: 4.48 },
    stock: { A920: 340, "Move 5000": 180, "Desk 5000": 260 },
    cutoff: "16:00 CET",
  },
  {
    id: "wh-fra",
    name: "Frankfurt DC",
    city: "Frankfurt, DE",
    at: { lat: 50.11, lon: 8.68 },
    stock: { A920: 120, "Move 5000": 64, "Desk 5000": 95 },
    cutoff: "15:00 CET",
  },
  {
    id: "wh-bcn",
    name: "Barcelona DC",
    city: "Barcelona, ES",
    at: { lat: 41.39, lon: 2.17 },
    stock: { A920: 88, "Move 5000": 40, "Desk 5000": 30 },
    cutoff: "15:00 CET",
  },
  {
    id: "wh-dub",
    name: "Dublin DC",
    city: "Dublin, IE",
    at: { lat: 53.35, lon: -6.26 },
    // Deliberately thin on Desk 5000: Brightline's 12-unit order cannot be met
    // from the site on its doorstep, which is the whole point of the screen.
    stock: { A920: 45, "Move 5000": 22, "Desk 5000": 5 },
    cutoff: "14:00 GMT",
  },
  {
    id: "wh-mil",
    name: "Milan DC",
    city: "Milan, IT",
    at: { lat: 45.46, lon: 9.19 },
    stock: { A920: 76, "Move 5000": 35, "Desk 5000": 48 },
    cutoff: "15:00 CET",
  },
]

function haversine(a: Point, b: Point): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const la = (a.lat * Math.PI) / 180
  const lb = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

/* ------------------------------------------------------------- the order */

export interface OrderLine {
  model: ModelId
  qty: number
}

/** Reads the merchant's own `terminals` string so the order can never drift
 *  from what the rest of the app already shows. */
export function orderLines(m: Merchant): OrderLine[] {
  return m.terminals.split(" + ").map((part) => {
    const hit = part.match(/^(\d+)×\s*(.+)$/)
    const qty = hit ? Number(hit[1]) : 1
    const model = (hit ? hit[2] : part).trim() as ModelId
    return { model, qty }
  })
}

export function hardwareLines(m: Merchant): OrderLine[] {
  return orderLines(m).filter((l) => MODELS[l.model]?.physical)
}

export function licenceLines(m: Merchant): OrderLine[] {
  return orderLines(m).filter((l) => MODELS[l.model] && !MODELS[l.model].physical)
}

/* ---------------------------------------------------------------- sourcing */

export interface SourceCandidate {
  warehouse: Warehouse
  distanceKm: number
  transitDays: number
  /** Units of THIS line the site can actually cover, capped at what is needed. */
  canCover: number
  onHand: number
  stocked: boolean
}

export interface LinePlan {
  line: OrderLine
  candidates: SourceCandidate[]
  /** Nearest site that can cover the line in full, if any. */
  singleSite: SourceCandidate | null
  /** Closest site overall, whether or not it can cover the order. */
  nearest: SourceCandidate
  /** True when the nearest site cannot cover it — the trade-off to surface. */
  conflict: boolean
  /** Units that no warehouse can supply. Non-zero means a real shortfall. */
  shortfall: number
}

/** Road/air transit in working days, from distance. Coarse by design: this is
 *  a planning figure, not a carrier quote, and it is labelled as such. */
/**
 * Distances are measured between city centroids, so a depot in the merchant's
 * own city computes to 0 km — a true measurement that reads exactly like a
 * missing value. Naming the case is the fix; rounding it up to a fake "1 km"
 * would be inventing a number to avoid looking broken.
 */
export function distanceLabel(km: number): string {
  return km < 25 ? "Same city" : `${km} km`
}

function transitFor(km: number): number {
  if (km < 400) return 1
  if (km < 1100) return 2
  if (km < 2000) return 3
  return 4
}

export function planLine(m: Merchant, line: OrderLine): LinePlan {
  const dest = CITIES[m.location]
  const candidates: SourceCandidate[] = WAREHOUSES.map((w) => {
    const onHand = w.stock[line.model] ?? 0
    const distanceKm = dest ? haversine(w.at, dest) : 0
    return {
      warehouse: w,
      distanceKm,
      transitDays: transitFor(distanceKm),
      canCover: Math.min(onHand, line.qty),
      onHand,
      stocked: w.stock[line.model] !== undefined,
    }
  }).sort((a, b) => a.distanceKm - b.distanceKm)

  const nearest = candidates[0]
  const singleSite = candidates.find((c) => c.onHand >= line.qty) ?? null
  const best = candidates.reduce((n, c) => Math.max(n, c.onHand), 0)

  return {
    line,
    candidates,
    singleSite,
    nearest,
    conflict: singleSite !== null && singleSite.warehouse.id !== nearest.warehouse.id,
    shortfall: singleSite ? 0 : Math.max(0, line.qty - best),
  }
}

export function sourcingPlan(m: Merchant): LinePlan[] {
  return hardwareLines(m).map((l) => planLine(m, l))
}

/* --------------------------------------------------------------- delivery */

export interface DeliveryOption {
  id: string
  carrier: string
  service: string
  /** Working days once despatched. */
  days: number
  /** Per-shipment cost in EUR. */
  cost: number
  note?: string
}

/** Options are derived from the chosen site's transit time so a "next day"
 *  service cannot be offered on a four-day lane. */
export function deliveryOptions(transitDays: number): DeliveryOption[] {
  const out: DeliveryOption[] = [
    {
      id: "std",
      carrier: "DHL Freight",
      service: "Standard road",
      days: transitDays + 1,
      cost: 42,
    },
    {
      id: "exp",
      carrier: "DHL Express",
      service: "Express road",
      days: transitDays,
      cost: 88,
    },
  ]
  if (transitDays >= 2) {
    out.push({
      id: "air",
      carrier: "UPS Air",
      service: "Air freight",
      days: 1,
      cost: 265,
      note: "Bypasses the road lane entirely.",
    })
  }
  return out
}

/* ------------------------------------------------------------ config profile */

export interface ConfigItem {
  label: string
  value: string
  /** Where this came from. A value the agent derived and a value the acquirer
   *  stated are different kinds of claim. */
  source: "Derived by agent" | "From acquirer" | "Scheme mandated"
}

export function configProfile(m: Merchant): ConfigItem[] {
  const contactless = m.sector === "Transport" ? "£100 / €50 with transit exemption" : "£100 / €50"
  return [
    { label: "Acceptance profile", value: `${m.sector} — standard EMV`, source: "Derived by agent" },
    { label: "Schemes enabled", value: "Visa, Mastercard, Amex, domestic debit", source: "From acquirer" },
    { label: "Contactless limit", value: contactless, source: "Scheme mandated" },
    { label: "Tipping / gratuity", value: m.sector === "Hospitality" ? "Enabled, prompt after amount" : "Disabled", source: "Derived by agent" },
    { label: "Receipt branding", value: "Merchant logo, acquirer footer", source: "From acquirer" },
    { label: "Settlement window", value: "Daily, 23:00 local", source: "From acquirer" },
    { label: "Key injection", value: "Remote, at first connection", source: "Scheme mandated" },
  ]
}

export interface TestResult {
  name: string
  state: "pass" | "fail" | "running" | "not-run"
  detail: string
}

export function testPack(m: Merchant): TestResult[] {
  const past = m.currentStep > 6
  const at = m.currentStep === 6
  const s = (i: number): TestResult["state"] =>
    past ? "pass" : at ? (i < 3 ? "pass" : i === 3 ? "running" : "not-run") : "not-run"
  return [
    { name: "EMV contact", state: s(0), detail: "Chip read, offline PIN, fallback" },
    { name: "EMV contactless", state: s(1), detail: "Tap, CVM limit, transit exemption" },
    { name: "Scheme certification", state: s(2), detail: "Visa / Mastercard acceptance suite" },
    { name: "Settlement reconciliation", state: s(3), detail: "Batch close and totals match" },
    { name: "Refund and void", state: s(4), detail: "Full and partial reversal" },
  ]
}

/* ------------------------------------------------------------------- fleet */

function seeded(str: string) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type DeviceState = "online" | "degraded" | "offline" | "not-activated"

export interface FleetDevice {
  serial: string
  model: ModelId
  merchant: string
  acquirer: string
  city: string
  state: DeviceState
  /** null when the device has never come online — there is no last contact to
   *  report, which is not the same as "a long time ago". */
  lastSeenHours: number | null
  firmware: string
  firmwareCurrent: boolean
  /** null below the measurement floor: a decline rate off four transactions
   *  is noise dressed as a metric. */
  declineRate: number | null
  txns7d: number
  batteryPct: number | null
  connectivity: "Wi-Fi" | "4G" | "Ethernet"
}

export const CURRENT_FIRMWARE = "4.2.1"

/** Merchants that went live before this pipeline. Without them the fleet would
 *  only contain the two journeys that happen to have reached go-live, and a
 *  terminal management screen covering eight devices would misrepresent the
 *  estate it exists to manage. */
const INSTALLED_BASE: {
  merchant: string
  acquirer: string
  city: string
  units: Partial<Record<ModelId, number>>
}[] = [
  { merchant: "Rheinpark Kaufhaus", acquirer: "Meridian Payments", city: "Düsseldorf, DE", units: { "Desk 5000": 24, A920: 6 } },
  { merchant: "Costa Verde Resorts", acquirer: "Northgate Acquiring", city: "Faro, PT", units: { A920: 18, "Move 5000": 9 } },
  { merchant: "Baltic Rail Kiosks", acquirer: "Baltic Card Services", city: "Riga, LV", units: { A920: 14 } },
  { merchant: "Maison Lefranc", acquirer: "Northgate Acquiring", city: "Lyon, FR", units: { "Move 5000": 11 } },
  { merchant: "Highfield Garden Co.", acquirer: "Northgate Acquiring", city: "Bristol, UK", units: { "Desk 5000": 8, A920: 4 } },
  { merchant: "Aalborg Fiskehus", acquirer: "Meridian Payments", city: "Aalborg, DK", units: { A920: 7 } },
]

function makeDevices(
  key: string,
  merchant: string,
  acquirer: string,
  city: string,
  model: ModelId,
  count: number,
  forcedState: DeviceState | null,
): FleetDevice[] {
  const rnd = seeded(key + model)
  const out: FleetDevice[] = []
  for (let i = 0; i < count; i++) {
    const r = rnd()
    const state: DeviceState =
      forcedState ?? (r > 0.94 ? "offline" : r > 0.87 ? "degraded" : "online")
    const live = state === "online" || state === "degraded"
    const txns7d = live ? Math.round(40 + rnd() * 900) : state === "offline" ? Math.round(rnd() * 12) : 0
    const fwCurrent = rnd() > 0.22
    out.push({
      serial: `${model.replace(/\D/g, "") || "SP"}${String(Math.floor(rnd() * 900000) + 100000)}`,
      model,
      merchant,
      acquirer,
      city,
      state,
      lastSeenHours: state === "not-activated" ? null : state === "online" ? 0 : state === "degraded" ? Math.round(rnd() * 5) : Math.round(18 + rnd() * 200),
      firmware: fwCurrent ? CURRENT_FIRMWARE : "4.1.6",
      firmwareCurrent: fwCurrent,
      declineRate: txns7d >= 20 ? Math.round((1.2 + rnd() * (state === "degraded" ? 9 : 2.6)) * 10) / 10 : null,
      txns7d,
      batteryPct: MODELS[model].battery && state !== "not-activated" ? Math.round(35 + rnd() * 64) : null,
      connectivity: MODELS[model].battery ? (rnd() > 0.5 ? "Wi-Fi" : "4G") : "Ethernet",
    })
  }
  return out
}

/**
 * The fleet is built from journeys that have reached despatch plus the
 * installed base. A device cannot report transactions for a merchant still in
 * underwriting, so anything before step 7 contributes nothing here — the
 * hardware does not exist yet.
 */
export function fleetDevices(
  pipeline: Merchant[],
  /** Required, not a defaulted module global: a device row that cannot name
   *  its acquirer is unusable on a screen whose whole premise is working
   *  across several of them. */
  acquirerOf: (m: Merchant) => string,
): FleetDevice[] {
  const out: FleetDevice[] = []

  for (const m of pipeline) {
    if (m.currentStep < 7) continue
    // Shipped or being installed: real units, but nothing has transacted yet.
    const forced: DeviceState | null = m.currentStep < 9 ? "not-activated" : null
    for (const line of hardwareLines(m)) {
      out.push(...makeDevices(m.id, m.name, acquirerOf(m), m.location, line.model, line.qty, forced))
    }
  }

  for (const b of INSTALLED_BASE) {
    for (const [model, n] of Object.entries(b.units)) {
      out.push(...makeDevices(b.merchant, b.merchant, b.acquirer, b.city, model as ModelId, n as number, null))
    }
  }
  return out
}

export interface FleetSummary {
  total: number
  online: number
  degraded: number
  offline: number
  notActivated: number
  /** Of the devices that have actually been activated. Reporting uptime over
   *  boxed stock would flatter the number with devices that cannot fail. */
  activated: number
  firmwareBehind: number
  merchants: number
  licences: number
}

/**
 * Share of ACTIVATED terminals currently online.
 *
 * Returns null when nothing has been activated: with no denominator there is
 * no availability to report, and rendering 0% would claim a total outage at a
 * site whose terminals are simply still in their boxes.
 */
export function availabilityPct(s: FleetSummary): number | null {
  if (s.activated === 0) return null
  return Math.round((s.online / s.activated) * 100)
}

export function fleetSummary(devices: FleetDevice[], licences: number): FleetSummary {
  const by = (s: DeviceState) => devices.filter((d) => d.state === s).length
  const notActivated = by("not-activated")
  return {
    total: devices.length,
    online: by("online"),
    degraded: by("degraded"),
    offline: by("offline"),
    notActivated,
    activated: devices.length - notActivated,
    firmwareBehind: devices.filter((d) => !d.firmwareCurrent).length,
    merchants: new Set(devices.map((d) => d.merchant)).size,
    licences,
  }
}
