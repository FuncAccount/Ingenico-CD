import type { Merchant, StepId } from "@/lib/acquirer-data"

/**
 * A blocked step, modelled as data rather than prose.
 *
 * The exception previously existed only as `status: "Exception"` plus a
 * sentence in the timeline, so nothing could render it at the point of action:
 * the step still reported "Ready", the failing task looked identical to the
 * three that had not run, and clicking "Resolve" in the portfolio landed you on
 * a screen that never said what was wrong. A flag is not an explanation.
 */

/** What the agent can do by itself, without waiting for anyone. */
export interface AgentMove {
  label: string
  /** Whether it has already happened, or is being offered to you now. */
  done: boolean
  detail: string
}

/** A candidate the agent found but is NOT permitted to apply on its own. */
export interface Candidate {
  value: string
  source: string
  /** Why this is a suggestion and not an answer. */
  caveat: string
}

export interface MerchantException {
  step: StepId
  /** Index into that step's `tasks`, so the failing task can be marked in place. */
  taskIndex: number
  /** One line, in the acquirer's terms, not the tool's. */
  summary: string
  /** What the agent set out to establish. */
  attempted: string
  /** What it actually observed, and on whose authority. */
  found: string
  source: string
  /** What this costs while it stays open — an exception with no consequence is
   *  not an exception, it is a note. */
  consequence: string
  /** Work the agent has done or can do unaided. */
  agentMoves: AgentMove[]
  /** THE LOAD-BEARING HALF. What the agent must not decide, and who owns it.
   *  Without this the panel reads as "the agent has it in hand", which is the
   *  opposite of the truth — the step is stopped precisely because a fact is
   *  missing that only the merchant holds. */
  needsHuman: {
    limit: string
    owner: "merchant" | "acquirer" | "ingenico"
    why: string
  }
  /** Near-matches the agent turned up. Offered for a human to confirm, never
   *  auto-applied: a plausible address is not a verified one. */
  candidates?: Candidate[]
}

const EXCEPTIONS: Record<string, MerchantException> = {
  "m-tavo": {
    step: 3,
    taskIndex: 2, // "Validate delivery"
    summary: "The delivery address does not resolve to a serviceable route.",
    attempted:
      "Resolve the address on the application to a carrier route, so the order can be released to fulfilment with a committed delivery date.",
    found:
      "No such street number at that postcode. The carrier database has Via Roma 12/A and 12/B in 20121 Milano, but no plain number 12 — so the address on file cannot be delivered to as written.",
    source: "Logistics validation · carrier address database",
    consequence:
      "The order is held before release. Both terminals stay reserved against this merchant, so nothing is lost, but the delivery date does not start counting until the address is corrected.",
    agentMoves: [
      {
        label: "Held the stock reservation",
        done: true,
        detail:
          "2× A920 stay allocated to this order rather than returning to the pool, so a corrected address does not go to the back of the queue.",
      },
      {
        label: "Isolated the failing line",
        done: true,
        detail:
          "Basket, availability and pricing all cleared. Only the address is blocking, so nothing else needs redoing.",
      },
      {
        label: "Draft the correction request",
        done: false,
        detail:
          "Writes to the merchant asking them to confirm the delivery address, quoting both near-matches so they can simply pick one.",
      },
      {
        label: "Re-run validation on reply",
        done: false,
        detail:
          "Re-validates automatically as soon as an address comes back, and releases the order if it passes.",
      },
    ],
    needsHuman: {
      limit: "The agent will not choose between 12/A and 12/B.",
      owner: "merchant",
      why:
        "Both are real addresses, so the carrier would accept either — which is exactly why a near-match cannot stand in for the answer. Sending two terminals to the wrong door is a real loss and an unrecoverable one. Only the merchant knows which entrance is theirs.",
    },
    candidates: [
      {
        value: "Via Roma 12/A, 20121 Milano MI",
        source: "Carrier address database",
        caveat: "Deliverable, but not evidence that this is the merchant's unit.",
      },
      {
        value: "Via Roma 12/B, 20121 Milano MI",
        source: "Carrier address database",
        caveat: "Also deliverable. The registry does not distinguish between the two.",
      },
    ],
  },
}

export function exceptionFor(merchant: Merchant): MerchantException | null {
  // Read from the flag the rest of the app already sorts and counts on, so a
  // merchant cannot be listed as an exception in the portfolio while this
  // returns nothing — the two would then disagree about the same merchant.
  if (merchant.status !== "Exception") return null
  return EXCEPTIONS[merchant.id] ?? null
}

/** True when this specific step is the blocked one. */
export function exceptionOnStep(merchant: Merchant, step: StepId): MerchantException | null {
  const e = exceptionFor(merchant)
  return e && e.step === step ? e : null
}

/** A merchant flagged as an exception with no detail recorded is itself worth
 *  saying out loud, rather than rendering a clean screen that implies nothing
 *  is wrong. Used to caption that gap honestly. */
export function exceptionDetailMissing(merchant: Merchant): boolean {
  return merchant.status === "Exception" && !EXCEPTIONS[merchant.id]
}
