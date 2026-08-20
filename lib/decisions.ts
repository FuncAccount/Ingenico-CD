import type { Merchant, MerchantStatus, StepId } from "@/lib/acquirer-data"

/**
 * THE SINGLE SOURCE OF TRUTH FOR "HAS THIS BEEN DECIDED".
 *
 * Before this module the app held five independent, unsynchronised answers to
 * that question:
 *
 *   1. `app/page.tsx`   signoffCount — useMemo over MERCHANTS with a [] dep,
 *                       frozen for the lifetime of the page
 *   2. portfolio KPI    "Awaiting your sign-off" — recomputed from MERCHANTS,
 *                       which never changes
 *   3. portfolio table  status badge + "Needs your sign-off" filter
 *   4. sign-off screen  a local `decisions` useState, discarded the moment you
 *                       navigated away
 *   5. step gate        the step-2 handoff `approvedIso`, a different local
 *                       useState, discarded when you switched step or merchant
 *
 * So signing off changed one of the five and left the other four asserting the
 * decision was still outstanding. Every surface now derives from the record
 * below, which means they cannot disagree — not because they are kept in step,
 * but because there is only one thing to read.
 */

export type DecisionKind = "signed" | "returned"

export interface Decision {
  kind: DecisionKind
  /**
   * The gate this decision was taken at. A sign-off is a decision about a
   * specific regulated step, not a permanent property of the merchant: the
   * same merchant reaches a branding gate later and must be asked again.
   */
  step: StepId
  /** When it was taken. Stamped once at the point of decision — formatting
   *  `new Date()` at render time would restate an old decision with today's
   *  clock every time the component re-rendered. */
  atIso: string
  /**
   * A fingerprint of the artefact this decision was taken against — see
   * `lib/decision-basis`. Null when nothing editable underpins it.
   *
   * REQUIRED, not optional. Optional would let a call site forget it and get
   * "never goes stale" by default, which is the silent-approval failure this
   * field exists to close: every surface that records a decision has to say
   * what it was looking at.
   */
  basis: string | null
  /**
   * When the artefact moved out from under this decision.
   *
   * The decision is SUPERSEDED, not deleted: it is a true record of something
   * that genuinely happened, and erasing it would leave the acquirer looking at
   * a gate that had reverted to untouched with no account of why. Keeping it
   * lets the gate say "you approved this on Tuesday; the design changed after
   * that", which is the sentence the reader actually needs.
   */
  supersededIso?: string
}

/**
 * Keyed by merchant AND step — see `decisionKey`.
 *
 * It used to be keyed by merchant alone, one slot each, which made the record
 * a LATEST-DECISION register rather than a history: approving B1 Order and
 * then approving B2 Branding overwrote the first, so B1 silently reverted to
 * undecided. The reader could not tell that from a step never approved at all,
 * because both render identically — and the gate that consults it went on
 * asking for an approval already given.
 */
export type Decisions = Record<string, Decision>

/* `decisionFor(decisions, merchantId)` lived here — "the merchant's decision",
 * singular, which only had a meaning while one slot existed per merchant. With
 * a history to read it would have to pick one arbitrarily, so it is deleted
 * rather than rewritten: every caller must now say WHICH GATE it is asking
 * about. It had no callers left. */

/** One decision per (merchant, gate). Composite because a merchant passes
 *  several regulated gates and each is decided on its own evidence. */
export function decisionKey(merchantId: string, step: StepId): string {
  return `${merchantId}::${step}`
}

/**
 * A decision only counts against the gate it was taken at. Without the step in
 * the key, signing off underwriting at R3 would silently also clear the
 * branding approval the merchant reaches at B2 — one click approving a
 * decision that was never put to anyone.
 */
export function decisionAtStep(
  decisions: Decisions,
  merchantId: string,
  step: StepId,
): Decision | null {
  return decisions[decisionKey(merchantId, step)] ?? null
}

/**
 * The status the merchant actually has now, as opposed to the one baked into
 * the fixture. This is the ONLY place a decision is allowed to change a status,
 * so no surface can hold a private opinion about it.
 */
/**
 * The decision that STILL SPEAKS for this gate, as opposed to the full record.
 *
 * A superseded decision is history. It says what was decided and when, but it
 * cannot answer "has this gate been passed", because the thing it was taken
 * against no longer exists. Every surface that gates on a decision must read
 * through here; only the one surface that REPORTS the decision — the gate
 * panel itself, which needs to explain the supersession — reads the raw record.
 *
 * This is why supersession lives on the record rather than being compared at
 * read time. A comparison would need the live artefact, which the portfolio
 * table and the KPI count have no way to obtain — so they would have gone on
 * counting a withdrawn approval as a passed gate, and the merchant would sit at
 * "On track" while the cockpit asked for the approval again.
 */
export function liveDecisionAtStep(
  decisions: Decisions,
  merchantId: string,
  step: StepId,
): Decision | null {
  const d = decisionAtStep(decisions, merchantId, step)
  return d && !d.supersededIso ? d : null
}

export function effectiveStatus(merchant: Merchant, decisions: Decisions): MerchantStatus {
  // Only the decision taken at the gate the merchant is STANDING AT can speak
  // for their status now. Asking by key rather than fetching their one record
  // and comparing its step: with a history to read, "their decision" is no
  // longer a meaningful phrase.
  // `liveDecisionAtStep`, not `decisionAtStep`: an approval whose subject has
  // since been edited must put the merchant back in the queue, not leave them
  // reading "On track" on the strength of a decision about an older design.
  const d = liveDecisionAtStep(decisions, merchant.id, merchant.currentStep)
  if (!d) return merchant.status

  // Only a merchant who was waiting on you can be moved by your decision.
  if (merchant.status !== "Needs sign-off") return merchant.status

  // Signed: the gate is cleared and the merchant carries on.
  // Returned: you have acted, so it is no longer awaiting YOU — but it is not
  // progressing either. Calling that "On track" would quietly relabel a request
  // for more information as forward movement.
  return d.kind === "signed" ? "On track" : "With merchant"
}

/** Merchants with their live status applied. Pass the result anywhere that used
 *  to read the raw fixture — `portfolioKpis` already takes a list, so the KPI
 *  cards start updating with no further change. */
export function applyDecisions(merchants: Merchant[], decisions: Decisions): Merchant[] {
  return merchants.map((m) => {
    const status = effectiveStatus(m, decisions)
    return status === m.status ? m : { ...m, status }
  })
}

/** What the nav badge and the KPI card both count. One function, so the two
 *  numbers are the same number. */
export function awaitingSignOff(merchants: Merchant[], decisions: Decisions): number {
  return merchants.filter((m) => effectiveStatus(m, decisions) === "Needs sign-off").length
}

/** The working set for the sign-off screen: everyone who was waiting on you
 *  when you arrived. Deliberately NOT filtered by current status — a merchant
 *  vanishing from the list the instant you sign would take the confirmation
 *  away with it, and you could not review what you had just done. */
export function signOffQueue(merchants: Merchant[]): Merchant[] {
  return merchants.filter((m) => m.status === "Needs sign-off")
}
