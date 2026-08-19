// The estate: every journey Ingenico is running, across every acquirer.
//
// This is the structural difference between the two personas, and the reason
// this is not the acquirer screen re-skinned. An acquirer sees their own book
// and nothing else. Ingenico sees the whole estate but CANNOT take the
// regulated decision on any of it. So the organising question here is not
// "what step is this at" (the acquirer's question, already answered by the
// journey view) but "who is this waiting on" — the one question only this side
// can answer, because only this side can see across books.
//
// Nothing in here re-implements pipeline logic. Lanes are derived from the
// same `ownerOf`/`STEP_HANDOFFS` the acquirer product uses, so the two sides
// cannot disagree about who owes what.

import {
  MERCHANTS,
  PIPELINE,
  stepById,
  type Merchant,
  type StepId,
} from "./acquirer-data"
import { handoffsFor, ownerOf, statusPossibleAt, STEP_HANDOFFS, type Party } from "./handoffs"
import { physicalUnits } from "./artifacts"
import { applyDecisions, decisionAtStep, type Decisions } from "./decisions"

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/** The acquirer product's fixture IS one acquirer's book. Naming it here rather
 *  than adding a field to `Merchant` is deliberate: the acquirer's own product
 *  has no concept of "which acquirer", because there is only ever one. The
 *  concept belongs to the estate view, so it lives in the estate module. */
export const HOME_ACQUIRER = "Northgate Acquiring"

/** Journeys belonging to other acquirers. These exist so the estate is
 *  genuinely wider than one book — otherwise "across every acquirer" is a
 *  claim the data cannot support, and the count would be identical to the
 *  acquirer's own portfolio. */
const OTHER_BOOKS: Merchant[] = [
  {
    id: "m-koln",
    name: "Köln Apotheke",
    sector: "Pharmacy",
    location: "Cologne, DE",
    size: "€1.8m / yr",
    terminals: "2× A920",
    terminalCount: 2,
    currentStep: 6,
    status: "On track",
    submitted: "5 days ago",
    events: [
      { step: 5, actor: "Agent", text: "Terminals configured to the pharmacy profile.", time: "2d ago", done: true },
      { step: 6, actor: "Agent", text: "Running the certification test pack.", time: "now", done: false },
    ],
  },
  {
    id: "m-nordcycle",
    name: "NordCycle",
    sector: "Retail",
    location: "Copenhagen, DK",
    size: "kr 9.2m / yr",
    terminals: "4× A920 + softPOS",
    terminalCount: 5,
    currentStep: 5,
    status: "On track",
    submitted: "4 days ago",
    events: [
      { step: 4, actor: "Agent", text: "Branding pack approved by the acquirer.", time: "1d ago", done: true },
      { step: 5, actor: "Agent", text: "Writing terminal configuration.", time: "now", done: false },
    ],
  },
  {
    id: "m-bellavista",
    name: "Bella Vista Trattoria",
    sector: "Hospitality",
    location: "Naples, IT",
    size: "€890k / yr",
    terminals: "2× A920",
    terminalCount: 2,
    currentStep: 7,
    status: "On track",
    submitted: "11 days ago",
    events: [
      { step: 6, actor: "Agent", text: "Certification test pack passed.", time: "4d ago", done: true },
      { step: 7, actor: "Agent", text: "Awaiting despatch confirmation from the order desk.", time: "now", done: false },
    ],
  },
  {
    id: "m-harbourline",
    name: "Harbourline Ferries",
    sector: "Transport",
    location: "Tallinn, EE",
    size: "€3.3m / yr",
    terminals: "8× A920",
    terminalCount: 8,
    currentStep: 2,
    status: "Needs sign-off",
    submitted: "1 day ago",
    events: [
      { step: 2, actor: "Agent", text: "Identity verified, 5 documents parsed.", time: "6h ago", done: true },
      { step: 2, actor: "Acquirer", text: "Awaiting regulated sign-off from Baltic Card Services.", time: "now", done: false },
    ],
  },
  {
    id: "m-stonebridge",
    name: "Stonebridge Garden Centre",
    sector: "Retail",
    location: "Leeds, UK",
    size: "£1.2m / yr",
    terminals: "3× A920",
    terminalCount: 3,
    currentStep: 8,
    status: "On track",
    submitted: "14 days ago",
    events: [
      { step: 7, actor: "Agent", text: "Devices despatched, tracking issued.", time: "3d ago", done: true },
      { step: 8, actor: "Agent", text: "Merchant installing devices on site.", time: "now", done: false },
    ],
  },

  // -------------------------------------------------------------------------
  // Demo coverage for the estate. This seat is organised by WHO a journey is
  // waiting on, so the roster has to exercise all three lanes in more than one
  // book — otherwise every non-home journey looks the same and the lanes only
  // ever fill from Northgate.
  // -------------------------------------------------------------------------

  // Step 1 in another book. Ingenico is owed nothing yet, which is itself
  // worth showing: the estate sees journeys it has no work on.
  {
    id: "m-vasa",
    name: "Vasa Bageri",
    sector: "Hospitality",
    location: "Stockholm, SE",
    size: "kr 6.4m / yr",
    terminals: "3× A920",
    terminalCount: 3,
    currentStep: 1,
    status: "On track",
    submitted: "8 hours ago",
    events: [
      { step: 1, actor: "Acquirer", text: "Intake received — two bakery sites.", time: "8h ago", done: true },
      { step: 1, actor: "Agent", text: "Sizing the kit against comparable bakeries.", time: "now", done: false },
    ],
  },

  // Step 3, parked on Ingenico's OWN order desk in another book. This is the
  // lane the estate exists to surface: work owed by Ingenico, in a book the
  // acquirer product cannot see.
  {
    id: "m-lisboaverde",
    name: "Lisboa Verde Mercado",
    sector: "Retail",
    location: "Lisbon, PT",
    size: "€2.9m / yr",
    terminals: "5× A920 + 3× Move 5000",
    terminalCount: 8,
    currentStep: 3,
    status: "On track",
    submitted: "4 days ago",
    events: [
      { step: 2, actor: "Acquirer", text: "Underwriting signed off by Meridian Payments.", time: "3d ago", done: true },
      { step: 3, actor: "Agent", text: "Basket assembled. With the order desk for availability and lead time.", time: "now", done: false },
    ],
  },

  // Step 5, Exception, outside the home book — so a failure of Ingenico's own
  // work is not a Northgate-only story.
  {
    id: "m-tallinnkohvik",
    name: "Tallinn Kohvik",
    sector: "Hospitality",
    location: "Tartu, EE",
    size: "€740k / yr",
    terminals: "2× Desk 5000",
    terminalCount: 2,
    currentStep: 5,
    status: "Exception",
    submitted: "9 days ago",
    events: [
      { step: 4, actor: "Acquirer", text: "Branding approved by Baltic Card Services.", time: "4d ago", done: true },
      { step: 5, actor: "Agent", text: "Configuration build failed — the acquirer host rejected the MID range as out of allocation.", time: "now", done: false },
    ],
  },

  // Step 8, With merchant, in another book.
  {
    id: "m-hansabooks",
    name: "Hansa Books",
    sector: "Retail",
    location: "Riga, LV",
    size: "€520k / yr",
    terminals: "1× A920",
    terminalCount: 1,
    currentStep: 8,
    status: "With merchant",
    submitted: "21 days ago",
    events: [
      { step: 7, actor: "Agent", text: "Delivered to the shop.", time: "8d ago", done: true },
      { step: 8, actor: "Agent", text: "Not activated. Owner away until the end of the month.", time: "now", done: false },
    ],
  },

  // Step 9 outside the home book, so "Live" is not something only Northgate
  // ever reaches.
  {
    id: "m-praha",
    name: "Praha Kavárna",
    sector: "Hospitality",
    location: "Prague, CZ",
    size: "Kč 18m / yr",
    terminals: "4× A920",
    terminalCount: 4,
    currentStep: 9,
    status: "Live",
    submitted: "27 days ago",
    events: [
      { step: 8, actor: "Agent", text: "All 4 terminals activated on site.", time: "5d ago", done: true },
      { step: 9, actor: "Agent", text: "First live payment detected. Records reconciled to Meridian Payments.", time: "4d ago", done: true },
    ],
  },
]

/** Which book each journey sits in, and how long it has been on its current
 *  step. Held as a stated measurement rather than computed from a hardcoded
 *  date, which would drift into "47 days waiting" a fortnight from now. */
const ESTATE_META: Record<string, { acquirer: string; daysInStep: number }> = {
  "m-atlas": { acquirer: HOME_ACQUIRER, daysInStep: 1 },
  "m-verde": { acquirer: HOME_ACQUIRER, daysInStep: 1 },
  "m-nordwind": { acquirer: HOME_ACQUIRER, daysInStep: 3 },
  "m-solmar": { acquirer: HOME_ACQUIRER, daysInStep: 2 },
  "m-brightline": { acquirer: HOME_ACQUIRER, daysInStep: 1 },
  "m-tavo": { acquirer: HOME_ACQUIRER, daysInStep: 2 },
  "m-fjord": { acquirer: HOME_ACQUIRER, daysInStep: 3 },
  "m-lumen": { acquirer: HOME_ACQUIRER, daysInStep: 1 },
  // Sitting exactly ON its 2-day service level, not over it. Worth keeping as
  // a boundary case: `>` not `>=` is the difference between "due today" and
  // "late", and a fixture with no boundary never tests it.
  "m-cedar": { acquirer: HOME_ACQUIRER, daysInStep: 2 },
  "m-havenport": { acquirer: HOME_ACQUIRER, daysInStep: 3 },
  "m-kessler": { acquirer: HOME_ACQUIRER, daysInStep: 1 },
  "m-marisol": { acquirer: HOME_ACQUIRER, daysInStep: 2 },
  "m-koln": { acquirer: "Meridian Payments", daysInStep: 2 },
  "m-nordcycle": { acquirer: "Meridian Payments", daysInStep: 1 },
  "m-bellavista": { acquirer: "Meridian Payments", daysInStep: 1 },
  "m-harbourline": { acquirer: "Baltic Card Services", daysInStep: 1 },
  "m-stonebridge": { acquirer: "Baltic Card Services", daysInStep: 4 },

  // Demo-coverage journeys, home book.
  "m-ravenswood": { acquirer: HOME_ACQUIRER, daysInStep: 1 },
  "m-thistle": { acquirer: HOME_ACQUIRER, daysInStep: 1 },
  "m-orchard": { acquirer: HOME_ACQUIRER, daysInStep: 3 },
  "m-meadowbank": { acquirer: HOME_ACQUIRER, daysInStep: 1 },
  // Past the 2-day configure/test service level, so the estate has a genuine
  // breach to sort to the top of the "On us" lane rather than an empty state.
  "m-summit": { acquirer: HOME_ACQUIRER, daysInStep: 4 },
  "m-glasswing": { acquirer: HOME_ACQUIRER, daysInStep: 3 },
  "m-pinegrove": { acquirer: HOME_ACQUIRER, daysInStep: 6 },

  // Demo-coverage journeys, other books.
  "m-vasa": { acquirer: "Meridian Payments", daysInStep: 1 },
  "m-lisboaverde": { acquirer: "Meridian Payments", daysInStep: 2 },
  "m-tallinnkohvik": { acquirer: "Baltic Card Services", daysInStep: 5 },
  "m-hansabooks": { acquirer: "Baltic Card Services", daysInStep: 9 },
  "m-praha": { acquirer: "Meridian Payments", daysInStep: 4 },
}

/** Every journey Ingenico can see, across all books. The estate's population,
 *  before any decisions are applied. */
export const ALL_JOURNEYS: Merchant[] = [...MERCHANTS, ...OTHER_BOOKS]

/** Which book a journey sits in. Throws rather than defaulting, for the same
 *  reason `estateRows` does. */
export function acquirerOf(m: Merchant): string {
  const meta = ESTATE_META[m.id]
  if (!meta) throw new Error(`estate: no book recorded for ${m.id}.`)
  return meta.acquirer
}

/**
 * What a step IS from the Ingenico seat. The nine steps are the same nine
 * steps — this is one onboarding, not two — but Ingenico's relationship to
 * them differs sharply, and flattening that would be the whole misreading.
 *
 *  inbound — decided elsewhere and reported to us. KYC passing, underwriting
 *            clearing, a branding pack arriving. There is nothing to do here
 *            and no control should imply otherwise.
 *  owned   — our work: sourcing, configuring, certifying, despatching.
 *  field   — happening at the merchant's site, where we support but do not act.
 */
export type IngenicoRole = "inbound" | "owned" | "field"

export function ingenicoRole(step: StepId): IngenicoRole {
  if (step === 1 || step === 2 || step === 4) return "inbound"
  if (step === 8) return "field"
  return "owned"
}

export interface EstateRow {
  merchant: Merchant
  acquirer: string
  daysInStep: number
  /** Who the journey is parked on right now. Null means nobody is holding it. */
  waitingOn: Party | null
  /** One line naming what that party owes. Straight off STEP_HANDOFFS. */
  ask: string
  /** Only Ingenico-owned steps carry a service level, so only they can breach
   *  one. An acquirer sitting on a decision is not "late" against Ingenico. */
  slaDays: number | null
  breached: boolean
}

/** The whole estate, with the acquirer's live decisions applied. Passing
 *  `decisions` is what makes the two personas one system: signing off in the
 *  acquirer view clears the row from Ingenico's acquirer-waiting lane. */
export function estateRows(decisions: Decisions): EstateRow[] {
  const all = applyDecisions([...MERCHANTS, ...OTHER_BOOKS], decisions)
  return all.map((merchant) => {
    // No silent default. Falling back to `{ HOME_ACQUIRER, 0 }` would file
    // another acquirer's journey under Northgate and print a fabricated
    // "0 days" that is indistinguishable from a real measurement. This threw
    // on two merchants I had missed, which is exactly what it is for.
    const meta = ESTATE_META[merchant.id]
    if (!meta) {
      throw new Error(
        `estate: no book recorded for ${merchant.id}. Add it to ESTATE_META.`,
      )
    }
    // Same reasoning as the check above: loud, not forgiving. A journey whose
    // status cannot occur at its step renders a lane and an action that the
    // process does not support, and it looks like a working screen.
    if (!statusPossibleAt(merchant.currentStep, merchant.status)) {
      throw new Error(
        `estate: ${merchant.id} is "${merchant.status}" at step ${merchant.currentStep}, ` +
          `which that step's handoffs do not allow.`,
      )
    }
    const party = waitingParty(merchant, decisions)
    const sla = party === "ingenico" ? ingenicoSla(merchant.currentStep) : null
    return {
      merchant,
      acquirer: meta.acquirer,
      daysInStep: meta.daysInStep,
      waitingOn: party,
      ask: askFor(merchant, party),
      slaDays: sla,
      breached: sla !== null && meta.daysInStep > sla,
    }
  })
}

/** Derived from status first, then step ownership. Status wins because it
 *  records something that has actually happened to this journey, whereas
 *  ownership is only the default shape of the step. */
export function waitingParty(m: Merchant, decisions: Decisions): Party | null {
  if (m.status === "Live") return null
  // A sign-off is an acquirer decision by definition, and `statusPossibleAt`
  // guarantees the step actually has one to take.
  if (m.status === "Needs sign-off") return "acquirer"
  if (m.status === "With merchant") return "merchant"

  // An exception is the step's OWN work having failed, so it is held by
  // whoever owns that work. This used to route every exception to the
  // acquirer, which was right for the only exception the fixture had — an
  // order blocked on a bad delivery address at step 3, genuinely theirs to
  // correct — and silently wrong the moment an Ingenico-owned step could
  // fail. A certification failure at step 6 filed under "on the acquirer"
  // tells Marc there is nothing he can do about his own test rig, and quietly
  // drops it out of the one lane that carries a service level.
  if (m.status === "Exception") return ownerOf(m.currentStep)

  // The acquirer has signed THIS step, so they are no longer holding it — even
  // though `currentStep` has not advanced. Without this the journey falls
  // through to `ownerOf`, which reports the acquirer as the owner of a
  // decision they have already taken, and the lane never empties. This is the
  // same stale-claim bug as the sign-off badge, one layer down.
  if (decisionAtStep(decisions, m.id, m.currentStep)?.kind === "signed") return null

  return ownerOf(m.currentStep)
}

function ingenicoSla(step: StepId): number | null {
  const h = STEP_HANDOFFS[step].find((x) => x.party === "ingenico")
  return h && h.party === "ingenico" ? h.slaDays : null
}

function askFor(m: Merchant, party: Party | null): string {
  // Two different reasons for an empty lane. Collapsing them would tell the
  // operator a merchant is "live and reconciled" seconds after their acquirer
  // signed off at step 2, which is a claim about the finished journey.
  if (party === null) {
    return m.status === "Live"
      ? "Live and reconciled. Nothing outstanding."
      : "Signed off. The agent is progressing to the next step."
  }
  // Order-aware, so Ingenico's own lane does not read "Logistics packs the
  // estate" for a merchant whose entire order is a softPOS licence.
  const h = handoffsFor(m.currentStep, physicalUnits(m).length === 0).find((x) => x.party === party)
  return h?.ask ?? stepById(m.currentStep).blurb
}

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

export type Lane = "ingenico" | "acquirer" | "merchant" | "clear"

export interface LaneMeta {
  id: Lane
  label: string
  /** What this lane means for Marc specifically. The whole point of the split
   *  is that only one of these four is his to act on. */
  note: string
  /** False lanes render without actions. A chase button on a row Ingenico does
   *  not own would offer authority this role does not have. */
  actionable: boolean
}

export const LANES: LaneMeta[] = [
  {
    id: "ingenico",
    label: "On us",
    note: "Ours to move. Everything here is inside an Ingenico service level.",
    actionable: true,
  },
  {
    id: "acquirer",
    label: "On the acquirer",
    note: "Their regulated decision. We can surface it, we cannot take it.",
    actionable: false,
  },
  {
    id: "merchant",
    label: "On the merchant",
    note: "Chased by the agent through the merchant portal.",
    actionable: false,
  },
  {
    id: "clear",
    label: "Running clean",
    note: "Nobody is holding these. Agent is working, just signed, or already live.",
    actionable: false,
  },
]

export function laneOf(row: EstateRow): Lane {
  return row.waitingOn ?? "clear"
}

export function rowsInLane(rows: EstateRow[], lane: Lane): EstateRow[] {
  const inLane = rows.filter((r) => laneOf(r) === lane)
  // Breaches first, then the longest wait: the order the operator would work
  // them in. Unsorted, the lane gives no reason to start at the top.
  return inLane.sort((a, b) => {
    if (a.breached !== b.breached) return a.breached ? -1 : 1
    return b.daysInStep - a.daysInStep
  })
}

// ---------------------------------------------------------------------------
// Automation census
// ---------------------------------------------------------------------------

export interface AutomationCensus {
  stepsCleared: number
  unattended: number
  needed: number
  /** Named, not implied. A bare "71%" invites the one question the figure
   *  cannot answer, which is 71% of what. */
  basis: string
}

/** Counts steps every in-flight journey has actually cleared, and how many of
 *  those ran without a person. Bands are the client's own: Automate runs
 *  unattended, Assist and Augment need someone. */
export function automationCensus(rows: EstateRow[]): AutomationCensus {
  let stepsCleared = 0
  let unattended = 0
  for (const r of rows) {
    // Steps strictly before the current one are done. The current step is
    // still in flight, so counting it would credit work not yet finished.
    for (const step of PIPELINE) {
      if (step.id >= r.merchant.currentStep) continue
      stepsCleared += 1
      if (step.band === "Automate") unattended += 1
    }
  }
  return {
    stepsCleared,
    unattended,
    needed: stepsCleared - unattended,
    basis: `${rows.length} journeys in flight`,
  }
}

export function estateSummary(rows: EstateRow[]) {
  const acquirers = new Set(rows.map((r) => r.acquirer))
  const inLane = (l: Lane) => rows.filter((r) => laneOf(r) === l).length
  const onUs = inLane("ingenico")
  const clear = inLane("clear")
  return {
    journeys: rows.length,
    acquirers: acquirers.size,
    breaches: rows.filter((r) => r.breached).length,
    onUs,
    clear,
    // Named rather than left as an arithmetic leftover, so the three figures
    // provably partition the estate: onUs + elsewhere + clear === journeys.
    elsewhere: rows.length - onUs - clear,
  }
}
