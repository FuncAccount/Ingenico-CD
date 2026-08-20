// Who a step is actually waiting on, and what the acquirer can do about it.
//
// The pipeline is NOT the acquirer's to drive end to end. Read off the current
// and future state maps: the acquirer owns steps 1-4, Ingenico owns 5-7, the
// merchant owns 8, and 9 runs itself. Step 06 lists no acquirer role at all.
//
// So a single "approve" control on every step would invent authority the
// acquirer does not have. Each party gets a structurally different action:
//   acquirer -> a decision, made here, by hand
//   ingenico -> an inbound response you wait for, then proceed past
//   merchant -> an outbound chase you send, and a portal submission that lands
// These are different kinds of thing, so they are different shapes in the
// type, not one status enum wearing three labels.

import type { Merchant, MerchantStatus, StepId } from "./acquirer-data"

export type Party = "acquirer" | "ingenico" | "merchant"

interface HandoffBase {
  /** One line: what this party has to do before the step can close. */
  ask: string
}

export interface AcquirerHandoff extends HandoffBase {
  party: "acquirer"
  /** The label on the button. Names the decision, never a bare "Approve". */
  action: string
  /** What the acquirer is taking responsibility for by clicking. */
  commits: string
}

export interface IngenicoHandoff extends HandoffBase {
  party: "ingenico"
  /** The Ingenico function that owns it, straight off the role map. */
  team: string
  /** Working-day service level, so a wait can be judged as on or off track. */
  slaDays: number
  /** What comes back when they are done. */
  returns: string
}

export interface MerchantHandoff extends HandoffBase {
  party: "merchant"
  /** Subject line for the auto-drafted request. */
  subject: string
  /** The specific items being requested. */
  items: string[]
  /** Working days before the first chase is due. */
  chaseAfterDays: number
  /** What the merchant does in the portal to satisfy it. */
  portalAction: string
}

export type Handoff = AcquirerHandoff | IngenicoHandoff | MerchantHandoff

/** Worked in order. The first unresolved one is what the step is waiting on. */
export const STEP_HANDOFFS: Record<StepId, Handoff[]> = {
  1: [
    {
      party: "acquirer",
      ask: "Confirm the shaped profile and recommended setup before it becomes an application.",
      action: "Confirm setup",
      /* Names the INFERENCE explicitly. Capture now reads documents, corroborates
         them against the register, and reads the merchant's website — and only
         that last one is a judgement rather than a record. This is the moment
         the acquirer takes ownership of it, so it has to be stated here rather
         than left in a panel they may not have opened. */
      commits:
        "You are accepting this merchant as your customer, the business profile the agent inferred from web research, and the recommended device mix as the basis of the order.",
    },
  ],
  // The risk lane. KYC (10) and Pricing (11) run BEFORE Underwriting (2)
  // despite the ids — see StepId.
  10: [
    {
      party: "acquirer",
      ask: "Clear the compliance screening, or judge an escalated hit.",
      action: "Clear KYC",
      commits:
        "You are accepting the entity as screened under your own AML policy. Anything the agent escalated stays yours to judge — it does not clear itself.",
    },
  ],
  11: [
    {
      party: "acquirer",
      ask: "Set the commercial terms for this merchant.",
      action: "Set pricing",
      commits:
        "You are fixing the monthly, setup and per-transaction rates this merchant will be billed. Ingenico applies them; it does not set or discount them.",
    },
  ],
  // The document chase stays HERE rather than moving to KYC with the identity
  // items, because this is the step that cannot proceed without them and the
  // list spans both (an ownership statement AND a bank statement). Splitting it
  // would send the merchant two competing emails for one pile of paperwork.
  // The ask no longer says "for KYB" — that step now exists separately.
  2: [
    {
      party: "merchant",
      ask: "Supply the documents underwriting needs to score the file.",
      subject: "Documents needed to complete your merchant application",
      items: [
        "Certificate of incorporation",
        "Proof of beneficial ownership (25%+ holders)",
        "Photo ID for each listed director",
        "Bank statement for the settlement account",
      ],
      chaseAfterDays: 3,
      portalAction: "uploads them in the merchant portal",
    },
    {
      party: "acquirer",
      ask: "Sign off the regulated onboarding decision.",
      action: "Sign off underwriting decision",
      commits:
        "This is the regulated decision and it is recorded against your licence, not Ingenico's. The agent's screening is evidence, not the decision.",
    },
  ],
  3: [
    {
      party: "ingenico",
      ask: "Order desk validates the basket, stock and lead time.",
      team: "Ingenico order desk",
      slaDays: 1,
      returns: "Confirmed availability, warehouse allocation and a committed delivery date",
    },
    {
      party: "acquirer",
      ask: "Place and confirm the order against your rate card.",
      action: "Place the order",
      commits:
        "You are committing to the order value on your contracted rate card and releasing it to fulfilment.",
    },
  ],
  // Branding is the acquirer's alone. This step previously led with an
  // Ingenico "configuration specialist" review, which (a) described step 5's
  // work, not this one, and (b) made the step read as Ingenico-owned, because
  // ownerOf() takes the FIRST handoff. Nobody at Ingenico approves what is
  // printed under your licence.
  4: [
    {
      party: "acquirer",
      ask: "Design and approve what the customer sees, on the device and the receipt.",
      action: "Approve branding and receipts",
      commits:
        "The receipt names your entity as the processor, so the look and the wording are yours to own — and so is this approval.",
    },
  ],
  5: [
    {
      party: "ingenico",
      ask: "Deployment team loads settings and injects security keys.",
      team: "Ingenico deployment team",
      slaDays: 2,
      returns: "Devices keyed and provisioned, with exceptions handled by the deployment team",
    },
  ],
  6: [
    {
      party: "ingenico",
      ask: "QA runs the automated test suite against every device.",
      team: "Ingenico QA",
      slaDays: 1,
      returns: "A pass certificate per device; QA acts on flagged conflicts without involving you",
    },
  ],
  7: [
    {
      party: "ingenico",
      ask: "Logistics packs the estate and books the carrier.",
      team: "Ingenico logistics",
      slaDays: 1,
      returns: "Tracking references, and early warning if a delivery is going to fail",
    },
  ],
  8: [
    {
      party: "merchant",
      ask: "Plug in the terminals and complete activation.",
      subject: "Your card machines have arrived — how to switch them on",
      items: [
        "Connect each terminal to power and to the internet",
        "Enter the activation code shown on the packing slip",
        "Run the £0.01 test payment when prompted",
      ],
      chaseAfterDays: 2,
      portalAction: "completes activation on the device",
    },
  ],
  9: [],
}

/**
 * The step-7 and step-8 handoffs for an order with no hardware.
 *
 * `STEP_HANDOFFS` is keyed by step alone, which is right for eight of the nine
 * steps but wrong for the two that assume a parcel: a software-only merchant
 * was told "Logistics packs the estate and books the carrier" and "Plug in the
 * terminals", neither of which will ever happen. The party does not change —
 * Ingenico still issues the licence, the merchant still activates — so this
 * substitutes the ASK, leaving `ownerOf` and `statusPossibleAt` untouched.
 */
const SOFTWARE_ONLY_HANDOFFS: Partial<Record<StepId, Handoff[]>> = {
  7: [
    {
      party: "ingenico",
      ask: "Licensing issues the softPOS entitlement to the merchant's account.",
      team: "Ingenico licensing",
      slaDays: 1,
      returns: "An entitlement reference; there is no consignment to track",
    },
  ],
  8: [
    {
      party: "merchant",
      ask: "Install the app and complete activation.",
      subject: "Your softPOS licence is ready — how to start taking payments",
      items: [
        "Install the payment app on a supported phone",
        "Sign in with the activation code emailed to you",
        "Run the £0.01 test payment when prompted",
      ],
      chaseAfterDays: 2,
      portalAction: "completes activation in the app",
    },
  ],
}

/**
 * The handoffs for a step ON A GIVEN ORDER. Prefer this over reading
 * `STEP_HANDOFFS` directly anywhere a merchant is in hand.
 */
export function handoffsFor(step: StepId, softwareOnly: boolean): Handoff[] {
  if (softwareOnly) return SOFTWARE_ONLY_HANDOFFS[step] ?? STEP_HANDOFFS[step]
  return STEP_HANDOFFS[step]
}

/**
 * The handoffs for a step on a given MERCHANT, narrowed to what that merchant
 * actually still owes.
 *
 * The step-2 list is the full KYB set, which is the right ask when nothing has
 * arrived. Once the agent has parsed four of six documents, sending that same
 * list asks the merchant to re-supply what they already sent — the single
 * fastest way to make an automated chase look unread, and to lose the two
 * documents that matter in a list of four they can ignore. So where the file
 * names its outstanding items, the request is narrowed to exactly those.
 */
export function handoffsForMerchant(
  step: StepId,
  merchant: Merchant,
  softwareOnly: boolean,
): Handoff[] {
  const base = handoffsFor(step, softwareOnly)
  const outstanding = merchant.underwriting?.documentsOutstanding
  if (step !== 2 || !outstanding?.length) return base

  return base.map((h) =>
    h.party === "merchant"
      ? {
          ...h,
          ask: `Supply the ${outstanding.length} outstanding document${
            outstanding.length === 1 ? "" : "s"
          }. Underwriting cannot score the file without them.`,
          // Counted, not spelled. "Two documents" in a literal goes on saying
          // two after one of them lands.
          subject: `${outstanding.length} document${
            outstanding.length === 1 ? "" : "s"
          } still needed to complete your application`,
          items: outstanding,
        }
      : h,
  )
}

/** The party a step is waiting on, before anyone has done anything.
 *
 *  Deliberately NOT just the first handoff: step 3 opens with an Ingenico
 *  validation but the step exists so that YOU place the order, and labelling it
 *  "Ingenico" hid the acquirer's own decision behind a supplier's queue. Where
 *  the acquirer has a decision anywhere in the step, the step is theirs. */
export function ownerOf(step: StepId): Party | null {
  const list = STEP_HANDOFFS[step]
  if (list.some((h) => h.party === "acquirer")) return "acquirer"
  return list[0]?.party ?? null
}

/** Who the step is waiting on RIGHT NOW, given live state. Distinct from
 *  ownerOf: a step you own can still be parked on someone else's desk. */
export function waitingOn(
  step: StepId,
  merchantId: string,
  states: Record<string, HandoffState>,
  /** Where the merchant has actually reached. Without it, a step completed
   *  weeks ago still reports "waiting on merchant", because handoff state
   *  starts empty and an unrecorded handoff is indistinguishable from an
   *  unfinished one. A step the journey has moved past is settled by fact. */
  currentStep?: StepId,
): Party | null {
  if (currentStep !== undefined && step < currentStep) return null
  const i = blockingIndex(step, merchantId, states)
  return i === null ? null : STEP_HANDOFFS[step][i].party
}

// ---------------------------------------------------------------------------
// Which statuses a step can legitimately carry
// ---------------------------------------------------------------------------

/**
 * Whether a status is even POSSIBLE at a step, derived from that step's
 * handoffs rather than asserted.
 *
 * This exists because the fixture is a demo roster built to show every
 * scenario, and the tempting way to "cover all the cases" is to put every
 * status against every step. Most of those combinations are fiction: steps
 * 5-7 have no acquirer handoff at all, so a merchant sitting there "Needs
 * sign-off" would show a decision nobody can take, on a screen with no control
 * to take it. A demo that shows an impossible state teaches the room something
 * false, which is worse than a gap they never notice.
 *
 * The genuinely impossible combinations are therefore NOT gaps to be filled —
 * they are the shape of the process, and `coverageGaps()` reports them
 * separately from cells that are merely empty.
 */
export function statusPossibleAt(step: StepId, status: MerchantStatus): boolean {
  const parties = STEP_HANDOFFS[step].map((h) => h.party)
  switch (status) {
    // Terminal, and only terminal. Step 9 has no handoffs because there is
    // nothing left to wait for.
    case "Live":
      return step === 9
    case "Needs sign-off":
      return parties.includes("acquirer")
    case "With merchant":
      return parties.includes("merchant")
    // Work in progress, or work gone wrong. Either can happen at any step that
    // has not finished — including step 9, which cannot be "in progress".
    case "On track":
    case "Exception":
      return step !== 9
  }
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

export interface MerchantChaseState {
  /** When the first request went out. Null means nothing has been sent. */
  sentIso: string | null
  /** Follow-ups after the first send. */
  chases: number
  lastChaseIso: string | null
  /** When the merchant satisfied it through the portal. */
  receivedIso: string | null
}

export interface IngenicoWaitState {
  requestedIso: string | null
  returnedIso: string | null
  /** Chases raised with the order desk. Waiting on a supplier is not the same
   *  as being unable to act: past SLA, you can push, and pushing is recorded. */
  chases: number
  lastChaseIso: string | null
}

export interface AcquirerDecisionState {
  approvedIso: string | null
}

export type HandoffState = MerchantChaseState | IngenicoWaitState | AcquirerDecisionState

/** The state a handoff on an ALREADY-COMPLETED step must start in. The journey
 *  having moved past the step is itself the evidence it was satisfied, so the
 *  default has to be "settled" rather than "never sent" — otherwise history
 *  reads as an outstanding request and the UI invites you to chase a merchant
 *  who answered weeks ago. Timestamps stay null: we know it happened, we do not
 *  know when, and inventing a date would be worse than admitting that. */
export const SETTLED_BEFORE_RECORD = "before-record"

export function settledState(h: Handoff): HandoffState {
  // A sentinel, not a date. Writing a placeholder string into an ISO field puts
  // "Invalid Date" on screen, which reads as a broken app rather than as the
  // honest statement that the timestamp was never captured.
  const done = SETTLED_BEFORE_RECORD
  if (h.party === "merchant") {
    return { sentIso: done, chases: 0, lastChaseIso: null, receivedIso: done }
  }
  if (h.party === "ingenico") {
    return { requestedIso: done, returnedIso: done, chases: 0, lastChaseIso: null }
  }
  return { approvedIso: done }
}

export function initialState(h: Handoff): HandoffState {
  if (h.party === "merchant") {
    return { sentIso: null, chases: 0, lastChaseIso: null, receivedIso: null }
  }
  if (h.party === "ingenico") {
    return { requestedIso: null, returnedIso: null, chases: 0, lastChaseIso: null }
  }
  return { approvedIso: null }
}

export function isResolved(h: Handoff, s: HandoffState): boolean {
  if (h.party === "merchant") return (s as MerchantChaseState).receivedIso !== null
  if (h.party === "ingenico") return (s as IngenicoWaitState).returnedIso !== null
  return (s as AcquirerDecisionState).approvedIso !== null
}

/** Key for one handoff on one merchant. Handoff state is per-merchant: a
 *  chase sent to one merchant says nothing about another. */
export function handoffKey(merchantId: string, step: StepId, index: number) {
  return `${merchantId}:${step}:${index}`
}

/** Index of the handoff currently blocking the step, or null when all are
 *  done. Order matters: documents before sign-off, validation before order. */
export function blockingIndex(
  step: StepId,
  merchantId: string,
  states: Record<string, HandoffState>,
): number | null {
  const list = STEP_HANDOFFS[step]
  for (let i = 0; i < list.length; i++) {
    const s = states[handoffKey(merchantId, step, i)] ?? initialState(list[i])
    if (!isResolved(list[i], s)) return i
  }
  return null
}

// ---------------------------------------------------------------------------
// Dates and drafting
// ---------------------------------------------------------------------------

export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from)
  let left = days
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) left--
  }
  return d
}

export function workingDaysBetween(a: Date, b: Date): number {
  if (b <= a) return 0
  const d = new Date(a)
  let n = 0
  while (d < b) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) n++
  }
  return n
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function fmtDateTime(iso: string): string {
  // Settled before the record began: we know it happened, not when. Say that
  // rather than rendering "Invalid Date", which looks like a broken app.
  if (iso === SETTLED_BEFORE_RECORD) return "date not recorded"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "date not recorded"
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** A contact address for the merchant. Derived so it always matches the name
 *  on screen rather than being a second, driftable field. */
export function merchantEmail(m: Merchant): string {
  const slug = m.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 18)
  return `accounts@${slug}.example`
}

export interface EmailDraft {
  to: string
  subject: string
  body: string
}

/** Draft the outbound request. The chase variant cites the original send date
 *  and the number of previous attempts, because a chase that reads identically
 *  to the first email tells the merchant nothing has been noticed. */
export function draftEmail(
  h: MerchantHandoff,
  m: Merchant,
  state: MerchantChaseState,
  now = new Date(),
): EmailDraft {
  const isChase = state.sentIso !== null
  const due = addWorkingDays(now, h.chaseAfterDays)
  const items = h.items.map((i) => `  •  ${i}`).join("\n")

  if (!isChase) {
    return {
      to: merchantEmail(m),
      subject: h.subject,
      body: `Hello ${m.name},

To keep your account moving we need the following from you:

${items}

The quickest way is through your merchant portal, where you can upload everything in one go. We would like these by ${fmtDate(due.toISOString())}.

If anything on the list does not apply to your business, reply to this email and we will work around it.

Many thanks,
Onboarding team`,
    }
  }

  const waited = workingDaysBetween(new Date(state.sentIso!), now)
  const attempt = state.chases + 1
  return {
    to: merchantEmail(m),
    subject: `Reminder ${attempt}: ${h.subject.toLowerCase()}`,
    body: `Hello ${m.name},

We wrote on ${fmtDate(state.sentIso!)} about the items below and have not had them yet — that is ${waited} working day${waited === 1 ? "" : "s"} ago. Your setup is paused until they arrive.

${items}

You can upload them in your merchant portal in a couple of minutes.

If you are stuck on any of these, reply and tell us which one — we would rather help than keep chasing.

Many thanks,
Onboarding team`,
  }
}
