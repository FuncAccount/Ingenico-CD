import type { Merchant, StepId } from "@/lib/acquirer-data"
import { streetFor } from "@/lib/addresses"

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

/* Derived from the SAME register the delivery map and trace read, so the
 * failure cannot name a street the rest of the app has never heard of. These
 * were typed by hand as "Via Roma 12/A and 12/B in 20121 Milano" while the
 * register said Via Tortona 27 — the panel was asking someone to correct a
 * record they would not have been able to find. The two near-matches are the
 * whole point of this exception, so they are built from the real street, not
 * asserted beside it. */
const TAVO_STREET = streetFor("m-tavo") // "Via Tortona 27"
const TAVO_NUMBER = TAVO_STREET.split(" ").pop()!
const TAVO_A = `${TAVO_STREET}/A, Milan, IT`
const TAVO_B = `${TAVO_STREET}/B, Milan, IT`

const EXCEPTIONS: Record<string, MerchantException> = {
  "m-tavo": {
    step: 3,
    taskIndex: 2, // "Validate delivery"
    summary: "The delivery address does not resolve to a serviceable route.",
    attempted:
      "Resolve the address on the application to a carrier route, so the order can be released to fulfilment with a committed delivery date.",
    found:
      `No such street number at that postcode. The carrier database has ${TAVO_A} and ${TAVO_B}, but no plain number ${TAVO_NUMBER} — so the address on file cannot be delivered to as written.`,
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
      limit: `The agent will not choose between ${TAVO_NUMBER}/A and ${TAVO_NUMBER}/B.`,
      owner: "merchant",
      why:
        "Both are real addresses, so the carrier would accept either — which is exactly why a near-match cannot stand in for the answer. Sending two terminals to the wrong door is a real loss and an unrecoverable one. Only the merchant knows which entrance is theirs.",
    },
    candidates: [
      {
        value: TAVO_A,
        source: "Carrier address database",
        caveat: "Deliverable, but not evidence that this is the merchant's unit.",
      },
      {
        value: TAVO_B,
        source: "Carrier address database",
        caveat: "Also deliverable. The registry does not distinguish between the two.",
      },
    ],
  },

  // The counterpart to m-tavo, and deliberately a DIFFERENT SHAPE: this one is
  // owned by Ingenico, not the merchant, and there are no candidates because
  // nothing here is ambiguous. The failing permission is known exactly — what
  // the agent will not do is widen acceptance on its own authority.
  "m-summit": {
    step: 6,
    taskIndex: 1, // "Test transactions"
    summary: "The refund test declined: the terminals cannot send a credit.",
    attempted:
      "Run the full pre-dispatch suite — sale, refund, reversal and offline — against the certification host, so every unit can be certified and released for dispatch.",
    found:
      "TXN-0003 declined with code 58, transaction not permitted to terminal. The acceptance profile loaded at step 05 carries no refund permission, so the host rejected the credit before it reached the card. Sale, reversal and offline all passed.",
    source: "Certification host · scheme response code 58",
    consequence:
      "No unit can be certified, so all 6 are held before dispatch. The hardware is built and configured — this is a permission on the profile, not a fault on the devices, so nothing needs remaking.",
    agentMoves: [
      {
        label: "Isolated the failing permission",
        done: true,
        detail:
          "Ran the remaining suite to completion rather than stopping at the decline, so the profile is the only open item. 3 of 5 passed within target, 1 above.",
      },
      {
        label: "Withheld the certificates",
        done: true,
        detail:
          "0 of 6 issued. Certifying the units that happened not to run the refund would have passed the fleet on an untested permission.",
      },
      {
        label: "Raised the profile correction with Ingenico",
        done: true,
        detail:
          "Deployment holds the acceptance profile, so the change and the re-signing are theirs to make.",
      },
      {
        label: "Re-run the suite on the re-signed bundle",
        done: false,
        detail:
          "Re-signing invalidates the passes already recorded, so step 06 restarts rather than resumes — the agent re-runs all five and re-issues certificates on a clean pass.",
      },
    ],
    needsHuman: {
      limit: "The agent will not add the refund permission to the profile itself.",
      owner: "acquirer",
      why:
        "Refund acceptance is a commercial permission you grant, not a configuration defect to be patched — it decides whether this merchant can move money back to a cardholder. The agent can see that the profile omits it, but not whether the omission was an error or your deliberate decision for this merchant category.",
    },
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
