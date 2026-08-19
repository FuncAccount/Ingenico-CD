/**
 * Scheme acceptance — what the merchant may accept, and who decides it.
 *
 * THE POINT OF THIS FILE is that acceptance is an INSTRUCTION the acquirer
 * sends, not a switch the acquirer throws. The panel this feeds used to render
 * a flat list of "Enabled" rows with an "Edit acceptance" button that only
 * expanded a sentence — so the one genuinely commercial decision on the whole
 * Configure step was read-only, and every line already read as configured.
 *
 * Two separate claims are kept apart everywhere below, because collapsing them
 * is what makes a request look like a result:
 *
 *   `live`      — what Ingenico has actually configured on the merchant today.
 *   `requested` — what the acquirer wants. Changing it CANNOT change `live`.
 *
 * A requested line therefore never reads "Enabled". It reads "Requested" while
 * it sits in the draft, and "With Ingenico" once the instruction is sent —
 * both of which are true statements about a configuration that does not exist
 * yet. Only Ingenico moves a line into `live`.
 */

import type { Merchant } from "@/lib/acquirer-data"
import { ACQUIRER } from "@/lib/branding"
import { vatFor, licenceUnits } from "@/lib/artifacts"

export type SchemeId =
  | "visaMc"
  | "amex"
  | "domesticDebit"
  | "contactless"
  | "softpos"

/**
 * Why a line is the shape it is.
 *
 *  - `acquirer` — the acquirer's commercial permission. Theirs to change.
 *  - `mandate`  — the schemes require it. On, and not ours to switch off;
 *                 rendering it as an editable toggle would offer a control
 *                 that cannot be honoured.
 *  - `blocked`  — cannot be requested on this order, for a stated reason.
 *                 NAMED rather than hidden: an omitted line reads as an option
 *                 nobody thought of, a struck one reads as a decision.
 */
export type SchemeAuthority = "acquirer" | "mandate" | "blocked"

export interface SchemeLine {
  id: SchemeId
  label: string
  /** Who decided, printed on the row. An acquirer permission and a scheme
   *  mandate are different kinds of claim and must not look alike. */
  source: string
  authority: SchemeAuthority
  /** Only for `blocked`: what would have to change for it to be available. */
  blockedReason?: string
  /** What the merchant gains. Acceptance is a commercial choice, so the row
   *  has to say what it is for, not just name a scheme. */
  effect: string
}

/**
 * The acceptance catalogue for a merchant.
 *
 * Derived per merchant rather than a static list: domestic debit depends on
 * the country rules table and softPOS on whether this order actually carries a
 * licence, and both were already conditional in the artefact this replaces.
 */
export function schemeLines(merchant: Merchant): SchemeLine[] {
  const hasVat = vatFor(merchant) !== null
  const licences = licenceUnits(merchant).length

  return [
    {
      id: "visaMc",
      label: "Visa / Mastercard",
      source: `${ACQUIRER.name} BIN 452110`,
      authority: "acquirer",
      effect: "Core card acceptance on every terminal.",
    },
    {
      id: "amex",
      label: "Amex",
      source: "separate Amex agreement on file",
      authority: "acquirer",
      effect: "Adds Amex at a separate rate. Settles on its own agreement.",
    },
    {
      id: "domesticDebit",
      label: "Domestic debit",
      source: hasVat ? "country scheme table" : "country not in the rules table",
      authority: hasVat ? "acquirer" : "blocked",
      blockedReason: hasVat
        ? undefined
        : "This merchant's country has no entry in the scheme rules table, so the domestic scheme cannot be named. Adding the country is a rules-table change, not a configuration one.",
      effect: "Local debit routing, usually the cheapest path for the merchant.",
    },
    {
      id: "contactless",
      label: "Contactless",
      source: "scheme mandated",
      authority: "mandate",
      effect: "Required on all new terminals. Not switchable.",
    },
    {
      id: "softpos",
      label: "softPOS acceptance",
      source:
        licences > 0
          ? `${licences} licence line${licences > 1 ? "s" : ""} on this order`
          : "no softPOS licence on this order",
      authority: licences > 0 ? "acquirer" : "blocked",
      blockedReason:
        licences > 0
          ? undefined
          : "softPOS acceptance needs a licence line on the order. Add one at the Order step first — enabling it here would configure something the merchant has not bought.",
      effect: "Tap to pay on the merchant's own phone, no terminal.",
    },
  ]
}

/** A sent instruction. Dated and referenced, because "we asked Ingenico" is
 *  only checkable if it says when and under what reference. */
export interface AcceptanceInstruction {
  ref: string
  sentIso: string
  /** What was asked for at the moment of sending. Kept separately from the
   *  working draft so later edits cannot rewrite the record of what was sent —
   *  a receipt that changes when you change your mind is not a receipt. */
  requested: Record<SchemeId, boolean>
}

export interface AcceptanceState {
  /** What Ingenico has configured. Only ever written by Ingenico's side. */
  live: Record<SchemeId, boolean>
  /** What the acquirer wants. Edited freely; commits nothing. */
  requested: Record<SchemeId, boolean>
  /** Sent instructions, newest last. */
  sent: AcceptanceInstruction[]
}

/**
 * The starting position.
 *
 * `live` is what Ingenico has ALREADY configured, so it must reflect the
 * merchant's real acceptance — not an empty slate. A first pass defaulted
 * everything except mandates to off, which showed "Visa / Mastercard · NOT
 * ENABLED" against a merchant already taking payments: the panel would have
 * been inviting the acquirer to request something they already have.
 *
 * Core acceptance is what the acquiring agreement is FOR, so Visa/Mastercard
 * and the domestic scheme are live wherever they are available. Amex is a
 * separate agreement and softPOS a separate licence, so those stay off — they
 * are the genuine decisions, and they are the ones worth being able to request.
 *
 * `requested` starts equal to `live`, so the panel opens with no pending
 * changes anyone has to explain.
 */
export function defaultAcceptance(merchant: Merchant): AcceptanceState {
  const live = {} as Record<SchemeId, boolean>
  for (const l of schemeLines(merchant)) {
    // A blocked line can never be on, whatever else is true of it.
    if (l.authority === "blocked") {
      live[l.id] = false
      continue
    }
    live[l.id] =
      l.authority === "mandate" || l.id === "visaMc" || l.id === "domesticDebit"
  }
  return { live, requested: { ...live }, sent: [] }
}

/**
 * Lines the acquirer wants changed and has NOT yet told Ingenico about.
 *
 * Measured against the last instruction sent, not against `live`. Comparing
 * only to `live` left a sent-but-unconfirmed line counted as pending forever —
 * the row read "With Ingenico" while the desk under it still offered to send
 * the same change, so the same instruction could be raised twice. A change is
 * outstanding until it is SENT; after that it is outstanding on Ingenico.
 */
export function pendingChanges(
  merchant: Merchant,
  state: AcceptanceState,
): { line: SchemeLine; want: boolean }[] {
  const last = state.sent[state.sent.length - 1]
  return schemeLines(merchant)
    .filter((l) => l.authority === "acquirer")
    .filter((l) => {
      // Already asked for exactly this? Then there is nothing new to send.
      if (last && last.requested[l.id] === state.requested[l.id]) return false
      return state.requested[l.id] !== state.live[l.id]
    })
    .map((l) => ({ line: l, want: state.requested[l.id] }))
}

/**
 * How a single line should read.
 *
 * Derived in one place so the row, the summary and the instruction receipt
 * cannot describe the same line differently — the failure mode being a row
 * that says "Enabled" under a banner that says "2 changes not yet sent".
 */
export type LineStatus =
  | { state: "live"; label: string }
  | { state: "with-ingenico"; label: string }
  | { state: "draft-on"; label: string }
  | { state: "draft-off"; label: string }
  | { state: "off"; label: string }
  | { state: "blocked"; label: string }

export function lineStatus(
  line: SchemeLine,
  state: AcceptanceState,
): LineStatus {
  if (line.authority === "blocked") return { state: "blocked", label: "Not available" }
  if (line.authority === "mandate") return { state: "live", label: "Enabled" }

  const live = state.live[line.id]
  const want = state.requested[line.id]

  if (live && want) return { state: "live", label: "Enabled" }
  if (live && !want) return { state: "draft-off", label: "Removal not sent" }

  // Not live. Has it been asked for?
  const asked = state.sent.some((i) => i.requested[line.id])
  if (want && asked) return { state: "with-ingenico", label: "With Ingenico" }
  if (want) return { state: "draft-on", label: "Not sent" }
  return { state: "off", label: "Not enabled" }
}

/**
 * Deterministic per merchant + send count, so the reference is stable across
 * re-renders but a second instruction does not reuse the first one's number.
 *
 * Built from the id's LETTERS. A first pass stripped to digits — but merchant
 * ids look like `m-fjord` and carry none, so every merchant's instruction came
 * out as `SCH-000-01` and two acquirers chasing two different merchants would
 * have quoted the same reference at Ingenico.
 */
export function nextRef(merchant: Merchant, sentCount: number): string {
  const slug = merchant.id.replace(/^m-/, "").replace(/[^a-z]/gi, "").slice(0, 4).toUpperCase()
  return `SCH-${slug || "MERC"}-${String(sentCount + 1).padStart(2, "0")}`
}
