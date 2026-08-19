/**
 * What the agent actually does on a deployment, and what you can ask it to do.
 *
 * Two rules hold everywhere in this file.
 *
 * 1. The agent is only ever credited with work the data can evidence. Search
 *    counts are counted, not typed; every routing is computed from real depot
 *    stock; a saving is the difference between two routings that both exist.
 *
 * 2. Every option states what it OPTIMISES and what it CONCEDES. An agent that
 *    offers three buttons and hides their cost is asking to be clicked without
 *    being read, which is the thing that makes automation unaccountable.
 */

import type { Merchant, StepId } from "@/lib/acquirer-data"
import { ingenicoRole } from "@/lib/estate"
import {
  cityPoint,
  deliveryOptions,
  hardwareLines,
  haversineKm,
  injectionSites,
  needsPhysicalKeying,
  planLine,
  WAREHOUSES,
  type DeliveryOption,
  type OrderLine,
  type Point,
  type Warehouse,
} from "@/lib/devices"

/* ------------------------------------------------------------------ routing */

export interface RoutingLeg {
  warehouse: Warehouse
  /** Model → units drawn from this site. */
  units: { model: string; qty: number }[]
  distanceKm: number
  transitDays: number
  service: DeliveryOption
  /** Distance-and-volume freight for this leg, separate from the flat service
   *  charge. Without it every depot costs the same to ship from and the whole
   *  idea of searching facilities for a cheaper one is theatre. */
  lineHaul: number
  /** service.cost + lineHaul. */
  total: number
  /** kg CO2e for this leg, from its distance, units and mode. */
  co2Kg: number
  /**
   * Working days from despatch to the merchant having these units.
   *
   * NOT `service.days`: air freight is quoted at one day whatever the lane, so
   * reading the carrier's figure alone silently swallowed the day the units
   * spend inside the injection facility, and every keyed plan claimed to
   * arrive as fast as a direct one.
   */
  totalDays: number
  /**
   * Certified facility these units are keyed at before delivery, when the
   * acquirer does not permit remote injection AND the source depot cannot
   * inject. Undefined means the units go straight to the merchant — which is
   * the normal case, not a missing value.
   *
   * When set, `distanceKm`, `transitDays`, `lineHaul` and `co2Kg` all describe
   * the FULL two-hop path, so a keyed leg can never look cheaper than the
   * direct one it replaced.
   */
  via?: Warehouse
}

/**
 * Planning-grade freight estimate: a per-km rate plus a per-unit handling
 * charge. Coarse on purpose and labelled as an estimate in the UI — it is not
 * a carrier quote, but it does make distance cost something, which is what
 * lets one depot genuinely beat another.
 */
export function lineHaulCost(distanceKm: number, units: number): number {
  return Math.round(distanceKm * 0.035 + units * 1.4)
}

/**
 * Freight emissions, kg CO2e, from tonne-kilometres.
 *
 * A terminal is boxed at roughly 1.5 kg, so units convert to tonnes. Intensity
 * is per MODE, not per service name: air freight is roughly twenty times road
 * per tonne-km, which is exactly why the fastest plan is so rarely the
 * greenest, and why the two must be offered as separate objectives rather than
 * bundled into one "best" recommendation.
 *
 * Coarse, and labelled an estimate wherever it is shown. It is a planning
 * comparison BETWEEN plans on identical assumptions, not a reportable figure.
 */
export const UNIT_WEIGHT_KG = 1.5
const INTENSITY: Record<"road" | "air", number> = { road: 0.11, air: 2.1 }

export function emissionsKg(distanceKm: number, units: number, mode: "road" | "air"): number {
  const tonnes = (units * UNIT_WEIGHT_KG) / 1000
  return Math.round(tonnes * distanceKm * INTENSITY[mode] * 10) / 10
}

export type RoutingId = "fastest" | "cheapest" | "fewest" | "greenest"

export interface Routing {
  id: RoutingId
  label: string
  /** The single thing this routing is best at. */
  optimises: string
  /** What it gives up to get there. Required: a routing with no stated cost
   *  is a recommendation pretending to be free. */
  concedes: string
  legs: RoutingLeg[]
  shipments: number
  /** Working days until the merchant has the WHOLE order — the slowest leg,
   *  not the fastest, because a partial delivery does not open a till. */
  days: number
  cost: number
  /** Sum of every leg's emissions, kg CO2e. Unlike days this DOES sum: each
   *  shipment burns its own fuel whether or not they travel in parallel. */
  co2Kg: number
  /** Units no depot can supply. Non-zero means this routing cannot complete. */
  shortfall: number
}

interface Draw {
  warehouse: Warehouse
  model: string
  qty: number
  distanceKm: number
  transitDays: number
}

/** Remaining stock per warehouse, so one routing's draws cannot exceed what
 *  another routing already spent. Each strategy starts from a fresh copy. */
function freshStock(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const w of WAREHOUSES) out[w.id] = { ...(w.stock as Record<string, number>) }
  return out
}

function candidatesFor(m: Merchant, line: OrderLine) {
  return planLine(m, line).candidates
}

/** Nearest depot first, splitting across sites when one cannot cover. */
function drawNearestFirst(m: Merchant, lines: OrderLine[]): { draws: Draw[]; shortfall: number } {
  const stock = freshStock()
  const draws: Draw[] = []
  let shortfall = 0

  for (const line of lines) {
    let left = line.qty
    for (const c of candidatesFor(m, line)) {
      if (left === 0) break
      const have = stock[c.warehouse.id][line.model] ?? 0
      const take = Math.min(have, left)
      if (take <= 0) continue
      stock[c.warehouse.id][line.model] = have - take
      left -= take
      draws.push({
        warehouse: c.warehouse,
        model: line.model,
        qty: take,
        distanceKm: c.distanceKm,
        transitDays: c.transitDays,
      })
    }
    shortfall += left
  }
  return { draws, shortfall }
}

/**
 * Greedy set cover: repeatedly take the depot that can supply the most
 * outstanding units, breaking ties by distance. Fewer sites means fewer
 * shipments, which is where the shipping cost actually lives.
 */
function drawFewestSites(m: Merchant, lines: OrderLine[]): { draws: Draw[]; shortfall: number } {
  const stock = freshStock()
  const outstanding = new Map(lines.map((l) => [l.model, l.qty]))
  const draws: Draw[] = []
  const geo = new Map<string, { distanceKm: number; transitDays: number }>()
  for (const line of lines) {
    for (const c of candidatesFor(m, line)) {
      geo.set(c.warehouse.id, { distanceKm: c.distanceKm, transitDays: c.transitDays })
    }
  }

  while ([...outstanding.values()].some((v) => v > 0)) {
    let best: { w: Warehouse; covers: number; dist: number } | null = null
    for (const w of WAREHOUSES) {
      let covers = 0
      for (const [model, need] of outstanding) {
        covers += Math.min(stock[w.id][model] ?? 0, need)
      }
      const dist = geo.get(w.id)?.distanceKm ?? Number.POSITIVE_INFINITY
      if (covers > 0 && (!best || covers > best.covers || (covers === best.covers && dist < best.dist))) {
        best = { w, covers, dist }
      }
    }
    if (!best) break

    const g = geo.get(best.w.id) ?? { distanceKm: 0, transitDays: 1 }
    for (const [model, need] of outstanding) {
      const take = Math.min(stock[best.w.id][model] ?? 0, need)
      if (take <= 0) continue
      stock[best.w.id][model] -= take
      outstanding.set(model, need - take)
      draws.push({ warehouse: best.w, model, qty: take, ...g })
    }
  }

  const shortfall = [...outstanding.values()].reduce((a, b) => a + b, 0)
  return { draws, shortfall }
}

function legsFrom(
  draws: Draw[],
  pick: (opts: DeliveryOption[]) => DeliveryOption,
  needsKeying: boolean,
  dest: Point | undefined,
): RoutingLeg[] {
  const bySite = new Map<string, RoutingLeg>()
  for (const d of draws) {
    const leg = bySite.get(d.warehouse.id)
    if (leg) {
      const u = leg.units.find((x) => x.model === d.model)
      if (u) u.qty += d.qty
      else leg.units.push({ model: d.model, qty: d.qty })
    } else {
      bySite.set(d.warehouse.id, {
        warehouse: d.warehouse,
        units: [{ model: d.model, qty: d.qty }],
        distanceKm: d.distanceKm,
        transitDays: d.transitDays,
        service: pick(deliveryOptions(d.transitDays)),
        lineHaul: 0,
        total: 0,
        co2Kg: 0,
        totalDays: 0,
      })
    }
  }
  // Freight is priced once the leg's full unit count is known, so a second
  // draw onto the same site does not get billed as a separate shipment.
  const legs = [...bySite.values()]
  for (const l of legs) {
    const units = l.units.reduce((a, u) => a + u.qty, 0)

    // A depot that cannot key the terminals must send them through one that
    // can. The detour is priced as the FULL path — depot to facility, then
    // facility to merchant — so a keyed leg can never appear cheaper or
    // shorter than the direct lane it replaced.
    if (needsKeying && !l.warehouse.keyInjection) {
      const kif = nearestInjectionSite(l.warehouse, dest)
      if (kif) {
        l.via = kif.site
        l.distanceKm = kif.toSite + kif.toDest
        // TRAVEL ONLY. The keying day is added once, in `totalDays` — folding
        // it in here too would inflate the carrier's own quoted transit and
        // then count the same day again.
        l.transitDays = transitDaysFor(kif.toSite) + transitDaysFor(kif.toDest)
        l.service = pick(deliveryOptions(l.transitDays))
      }
    }

    l.lineHaul = lineHaulCost(l.distanceKm, units)
    l.total = l.service.cost + l.lineHaul
    l.co2Kg = emissionsKg(l.distanceKm, units, l.service.mode)
    // The facility day is added ON TOP of the carrier's transit, because the
    // units are stationary while they are keyed no matter how fast they fly.
    l.totalDays = l.service.days + (l.via ? KEYING_DAYS : 0)
  }
  return legs.sort((a, b) => a.distanceKm - b.distanceKm)
}

/** Working days the units spend inside the facility being keyed and re-boxed.
 *  Not travel time — it is why a keyed rollout is slower even between two
 *  depots that are close together. */
export const KEYING_DAYS = 1

function transitDaysFor(km: number): number {
  if (km < 400) return 1
  if (km < 1100) return 2
  if (km < 2000) return 3
  return 4
}

/** The facility that makes the WHOLE detour shortest, not the one nearest the
 *  depot: a close facility on the wrong side of the merchant is a longer trip. */
function nearestInjectionSite(from: Warehouse, dest: Point | undefined) {
  let best: { site: Warehouse; toSite: number; toDest: number } | null = null
  for (const site of injectionSites()) {
    const toSite = haversineKm(from.at, site.at)
    const toDest = dest ? haversineKm(site.at, dest) : 0
    if (!best || toSite + toDest < best.toSite + best.toDest) best = { site, toSite, toDest }
  }
  return best
}

const cheapestService = (o: DeliveryOption[]) => o.reduce((a, b) => (b.cost < a.cost ? b : a))
const quickestService = (o: DeliveryOption[]) => o.reduce((a, b) => (b.days < a.days ? b : a))

function assemble(
  id: RoutingId,
  label: string,
  optimises: string,
  concedes: string,
  draws: Draw[],
  shortfall: number,
  pick: (o: DeliveryOption[]) => DeliveryOption,
  needsKeying: boolean,
  dest: Point | undefined,
): Routing {
  const legs = legsFrom(draws, pick, needsKeying, dest)
  return {
    id,
    label,
    optimises,
    concedes,
    legs,
    shipments: legs.length,
    // Max, not sum: the order is complete when the LAST leg lands.
    days: legs.reduce((a, l) => Math.max(a, l.totalDays), 0),
    cost: legs.reduce((a, l) => a + l.total, 0),
    co2Kg: Math.round(legs.reduce((a, l) => a + l.co2Kg, 0) * 10) / 10,
    shortfall,
  }
}

/** Every plan the agent evaluates: two ways of assigning depots × two service
 *  levels. The count is what the "compared N routings" claim is counted from,
 *  so the claim cannot drift from the search. */
function candidatePlans(m: Merchant, acquirer: string): Routing[] {
  const lines = hardwareLines(m)
  if (lines.length === 0) return []
  const assignments = [drawNearestFirst(m, lines), drawFewestSites(m, lines)]
  const needsKeying = needsPhysicalKeying(acquirer)
  const dest = cityPoint(m.location)
  const services = [cheapestService, quickestService]
  const out: Routing[] = []
  for (const a of assignments) {
    for (const s of services) {
      out.push(assemble("cheapest", "", "", "", a.draws, a.shortfall, s, needsKeying, dest))
    }
  }
  return out
}

export function planCount(m: Merchant, acquirer: string): number {
  return candidatePlans(m, acquirer).length
}

const LABELS: Record<RoutingId, { label: string; optimises: string; concedes: string }> = {
  fastest: {
    label: "Earliest delivery",
    optimises: "Gets the merchant trading soonest",
    concedes: "Pays for speed, and may split across depots",
  },
  cheapest: {
    label: "Lowest cost",
    optimises: "Cheapest total of freight and service",
    concedes: "Adds days, and stock may travel further",
  },
  fewest: {
    label: "Fewest shipments",
    optimises: "Simplest to receive and install",
    concedes: "One depot must carry the whole order",
  },
  greenest: {
    label: "Lowest emissions",
    optimises: "Least CO2e — short road lanes, never air",
    concedes: "Road is slower, and a near depot may be short on stock",
  },
}

/**
 * Pick the best plan per objective out of the same candidate set. Each is a
 * real argmin, so two objectives landing on one plan means they genuinely
 * agree rather than the code having been told they do.
 */
export function routings(m: Merchant, acquirer: string): Routing[] {
  const plans = candidatePlans(m, acquirer)
  if (plans.length === 0) return []

  const pick = (id: RoutingId, better: (a: Routing, b: Routing) => boolean) => {
    const won = plans.reduce((a, b) => (better(b, a) ? b : a))
    return { ...won, id, ...LABELS[id] }
  }

  return [
    pick("fastest", (b, a) => b.days < a.days || (b.days === a.days && b.cost < a.cost)),
    pick("cheapest", (b, a) => b.cost < a.cost || (b.cost === a.cost && b.days < a.days)),
    pick(
      "fewest",
      (b, a) => b.shipments < a.shipments || (b.shipments === a.shipments && b.cost < a.cost),
    ),
    pick("greenest", (b, a) => b.co2Kg < a.co2Kg || (b.co2Kg === a.co2Kg && b.cost < a.cost)),
  ]
}

/** Two strategies can converge on exactly the same plan. Saying so is better
 *  than showing one plan twice under different names. */
export function sameRouting(a: Routing, b: Routing): boolean {
  return (
    a.cost === b.cost &&
    a.days === b.days &&
    a.shipments === b.shipments &&
    a.legs.map((l) => l.warehouse.id).join() === b.legs.map((l) => l.warehouse.id).join()
  )
}

export interface RoutingChoice {
  all: Routing[]
  recommended: Routing
  /** The routing the recommendation was chosen over, for the stated saving. */
  against: Routing | null
  savingEur: number
  extraDays: number
}

/**
 * Recommend on cost, then state the delay it buys. Cost is the objective the
 * user named; speed is the thing it trades against, so both print.
 */
/**
 * What the key-policy check concluded for a given plan.
 *
 * Three genuinely different outcomes, kept apart: units routed through a
 * facility, units that did not need to be because their depot is certified,
 * and no plan to check at all. Collapsing the middle case into the first would
 * claim a detour that never happened.
 */
function keyingNote(r: Routing | undefined): string {
  if (!r) return "No hardware to key"
  const via = r.legs.filter((l) => l.via)
  if (via.length === 0) return "Physical keying required — sourced only from certified depots"
  const names = [...new Set(via.map((l) => l.via!.name))].join(", ")
  return `Physical keying required — ${via.length} of ${r.legs.length} shipment${
    r.legs.length === 1 ? "" : "s"
  } routed via ${names}, adding ${KEYING_DAYS} day`
}

export function chooseRouting(m: Merchant, acquirer: string): RoutingChoice | null {
  const all = routings(m, acquirer)
  if (all.length === 0) return null
  const cheapest = all.reduce((a, b) => (b.cost < a.cost ? b : a))
  const quickest = all.reduce((a, b) => (b.days < a.days ? b : a))
  const tie = sameRouting(cheapest, quickest)
  return {
    all,
    recommended: cheapest,
    against: tie ? null : quickest,
    savingEur: tie ? 0 : quickest.cost - cheapest.cost,
    extraDays: tie ? 0 : cheapest.days - quickest.days,
  }
}

/* ------------------------------------------------------------ agent activity */

/** Depot cities are stored as "Rotterdam, NL", so the country is the suffix.
 *  Counted rather than hardcoded: a sixth depot must move the number. */
function depotCountries(): number {
  return new Set(WAREHOUSES.map((w) => w.city.split(",").pop()?.trim() ?? w.city)).size
}

/**
 * The acquirer's own agreed turnaround. Deliberately NOT Ingenico's SLA:
 * `slaDays` is null on inbound steps precisely because Ingenico cannot breach
 * a decision it does not own, but there is still a point past which chasing
 * is legitimate — and the figure has to be stated to be arguable.
 */
export const ACQUIRER_TURNAROUND_DAYS = 5

export interface AgentTrace {
  /** A thing the agent did, phrased as a completed action with its count. */
  did: string
  /** What that action turned up. Never a restatement of `did`. */
  found: string
}

export interface AgentActivity {
  /** Present tense only when the agent can still act on this step. */
  watching: boolean
  headline: string
  trace: AgentTrace[]
  /** Stored, not computed at render: formatting `new Date()` here would
   *  restate an old check with today's clock. */
  ranAt: string
}

export function agentActivity(m: Merchant, step: StepId, acquirer: string): AgentActivity {
  const role = ingenicoRole(step)
  const countries = depotCountries()
  const lines = hardwareLines(m)
  const units = lines.reduce((a, l) => a + l.qty, 0)

  if (role === "inbound") {
    return {
      watching: true,
      headline: "Watching for the acquirer's signal",
      // The agent genuinely cannot act here, and pretending otherwise would
      // erase the inbound/owned distinction the whole screen rests on.
      trace: [
        { did: "Polling the acquirer feed every 15 minutes", found: "No change since the last update" },
        { did: "Checked the agreed turnaround for this step", found: "Chase becomes available once it is exceeded" },
      ],
      ranAt: "3 minutes ago",
    }
  }

  if (step === 3) {
    const choice = chooseRouting(m, acquirer)
    return {
      watching: false,
      headline: `Searched ${WAREHOUSES.length} facilities for ${units} units`,
      trace: [
        {
          did: `Checked live stock at ${WAREHOUSES.length} depots across ${countries} countries`,
          found: choice
            ? `${choice.recommended.legs.length === 1 ? "One depot can cover the order" : `${choice.recommended.legs.length} depots needed to cover it`}`
            : "No hardware on this order",
        },
        {
          did: `Evaluated ${planCount(m, acquirer)} depot-and-service plans on cost, transit and shipment count`,
          found: choice
            ? choice.against
              ? `Cheapest saves €${choice.savingEur} and costs ${choice.extraDays} day${choice.extraDays === 1 ? "" : "s"}`
              : "Cheapest and fastest are the same plan"
            : "Nothing to route",
        },
        // The key check is reported on BOTH outcomes. Shown only when it
        // forces a detour, a rollout that ships direct would look like one
        // where the check was never made.
        {
          did: `Checked ${acquirer}'s key policy against each depot's certification`,
          found: needsPhysicalKeying(acquirer)
            ? keyingNote(choice?.recommended)
            : "Remote injection permitted — every depot can ship direct",
        },
      ],
      ranAt: "12 minutes ago",
    }
  }

  if (step === 5) {
    return {
      watching: false,
      headline: "Drafted the acceptance profile",
      trace: [
        { did: `Matched this merchant against others in ${m.sector}`, found: "Profile pre-filled from the sector default" },
        { did: "Cross-checked every field against the acquirer's record", found: "Values the acquirer supplied are marked as theirs" },
      ],
      ranAt: "1 hour ago",
    }
  }

  if (step === 6) {
    return {
      watching: false,
      headline: "Running the certification pack",
      trace: [
        { did: "Executed the scheme acceptance suite", found: "Results below, re-run available per case" },
        { did: "Compared against the last passing run for this model", found: "No new failure class" },
      ],
      ranAt: "26 minutes ago",
    }
  }

  if (step === 7) {
    return {
      watching: false,
      headline: "Holding the booking and watching the lane",
      trace: [
        { did: "Booked the despatch against the chosen routing", found: "Carrier confirmed the collection slot" },
        { did: "Monitoring the lane for delay", found: "No exception raised by the carrier" },
      ],
      ranAt: "8 minutes ago",
    }
  }

  return {
    watching: false,
    headline: "Tracking activation",
    trace: [
      { did: "Waiting for first connection from each terminal", found: "Keys inject automatically on connect" },
      { did: "Watching the first transactions", found: "Decline spikes raise an alert on the estate map" },
    ],
    ranAt: "Just now",
  }
}

/* -------------------------------------------------------------- agent tasks */

export interface AgentTask {
  id: string
  label: string
  /** What asking for this actually gets you. */
  optimises: string
  /** What it costs. Never omitted, even when small. */
  concedes: string
  /** When set the task cannot run, and this NAMES why rather than the button
   *  simply being greyed out with no account of itself. */
  blocked?: string
}

export function agentTasks(
  m: Merchant,
  step: StepId,
  /** Required: the acquirer's key policy decides whether terminals must pass
   *  through a certified facility, which changes the whole routing. */
  acquirer: string,
  /** Days the journey has sat on its CURRENT step. Passed in because it is a
   *  property of the estate row, not of the merchant record. */
  daysInStep: number,
): AgentTask[] {
  const role = ingenicoRole(step)

  if (role === "inbound") {
    const overdue = daysInStep > ACQUIRER_TURNAROUND_DAYS
    return [
      {
        id: "chase",
        label: "Chase the acquirer",
        optimises: "Puts a dated request against the outstanding item",
        concedes: "Nothing moves until they answer",
        blocked: overdue
          ? undefined
          : `Not yet past the agreed turnaround — day ${daysInStep} of ${ACQUIRER_TURNAROUND_DAYS}`,
      },
      {
        id: "brief",
        label: "Summarise what we are waiting on",
        optimises: "One paragraph naming the missing item and who holds it",
        concedes: "A description, not a decision",
      },
    ]
  }

  if (step === 3) {
    const choice = chooseRouting(m, acquirer)
    const short = choice ? choice.recommended.shortfall : 0
    return [
      {
        id: "cheapest",
        label: "Re-plan for lowest cost",
        optimises: "Fewest depots, cheapest service",
        concedes: "Slower, and stock may travel further",
      },
      {
        id: "fastest",
        label: "Re-plan for earliest delivery",
        optimises: "Soonest the merchant can trade",
        concedes: "More shipments, higher freight",
      },
      {
        id: "greenest",
        label: "Re-plan for lowest emissions",
        optimises: "Shortest road lanes, no air freight",
        concedes: "Road is slower than air on a long lane",
      },
      {
        id: "consolidate",
        label: "Hold and consolidate with the next order to this city",
        optimises: "One collection instead of two",
        concedes: "Waits for an order that has not been placed yet",
      },
      {
        id: "reserve",
        label: "Reserve the stock now",
        optimises: "Stops another deployment drawing these units",
        concedes: "Ties up inventory before despatch is agreed",
        blocked: short > 0 ? `${short} units are not held anywhere — nothing to reserve against` : undefined,
      },
    ]
  }

  if (step === 5) {
    return [
      {
        id: "copy",
        label: "Copy the profile from a similar merchant",
        optimises: "Matches a deployment already trading in this sector",
        concedes: "Carries over choices nobody has revisited",
      },
      {
        id: "confirm",
        label: "Ask the acquirer to confirm the disputed fields",
        optimises: "Puts the acquirer on record for values they own",
        concedes: "Pauses configuration until they reply",
      },
    ]
  }

  if (step === 6) {
    return [
      {
        id: "rerun",
        label: "Re-run the failed cases only",
        optimises: "Fast feedback on the specific failure",
        concedes: "Does not re-prove the cases that passed earlier",
      },
      {
        id: "full",
        label: "Re-run the whole pack",
        optimises: "Every case proven on the current build",
        concedes: "Takes the full run time again",
      },
    ]
  }

  if (step === 7) {
    return [
      {
        id: "upgrade",
        label: "Upgrade this shipment to air",
        optimises: "Pulls the delivery in to next day",
        concedes: "Several times the road cost",
      },
      {
        id: "split",
        label: "Send what is ready, follow with the rest",
        optimises: "Merchant can open some lanes now",
        concedes: "Two deliveries, two installs",
      },
    ]
  }

  return [
    {
      id: "watch",
      label: "Alert me on the first decline spike",
      optimises: "Catches a bad configuration in the first hours of trading",
      concedes: "Early volumes are small, so a spike may be noise",
    },
  ]
}
