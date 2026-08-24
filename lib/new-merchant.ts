import { RISK_LANE, type Merchant } from "@/lib/acquirer-data"

/**
 * Turning a submission form into a merchant record.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a merchant submitted thirty seconds ago
 * has no history, and must not be given one. The fixtures are all mid-flight —
 * they carry a risk score, a parsed document count, an edge case and a timeline
 * of things the agent already did. Cloning one of those as a template would
 * hand a brand-new applicant an underwriting verdict nobody produced, on
 * exactly the file nobody has opened yet. Every field below is either taken
 * from what the acquirer actually typed, derived from it, or deliberately
 * absent.
 */

export interface MerchantDraft {
  name: string
  sector: string
  city: string
  country: string
  /** Volume band label, e.g. "£1m – £5m". */
  volume: string
  /** What the acquirer typed in "terminals", if anything. */
  terminals: string
  /** The kit the comparables suggested, e.g. "3× A920 + softPOS". May be null
   *  when the form had too little to match on. */
  recommendation: string | null
}

/** Fallback device when the acquirer named a count but no comparable matched.
 *  A920 is the catalogue's default terminal; naming the constant keeps that
 *  assumption visible rather than buried in a template string. */
const DEFAULT_MODEL = "A920"

/** Parse the leading quantity of one summary part ("3× A920" → 3). Mirrors the
 *  parse in `defaultBasket`, which is the consumer of whatever we write. */
function qtyOf(part: string): number {
  const m = part.trim().match(/^(\d+)\s*[x×]\s*/i)
  return m ? Number(m[1]) : 1
}

/**
 * Reconcile the two things the form can tell us about kit.
 *
 * The acquirer's own terminal count OVERRIDES the recommendation's quantity but
 * keeps its models — typing "5" against a suggested "3× A920 + softPOS" means
 * five of the suggested terminal, not five of something unnamed, and not a
 * silent discard of the softPOS line.
 */
export function kitFor(draft: MerchantDraft): string {
  const typed = Number(draft.terminals)
  const wanted = Number.isFinite(typed) && typed > 0 ? typed : null
  const rec = draft.recommendation?.trim() || null

  if (!rec) return `${wanted ?? 1}× ${DEFAULT_MODEL}`
  if (wanted === null) return rec

  const parts = rec.split("+").map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return `${wanted}× ${DEFAULT_MODEL}`

  // Re-quantify the first (primary) device only. The trailing licence lines are
  // per-merchant, not per-terminal, so multiplying them by the terminal count
  // would bill twelve softPOS licences to a merchant who asked for twelve
  // card machines.
  const head = parts[0].replace(/^(\d+)\s*[x×]\s*/i, "")
  return [`${wanted}× ${head}`, ...parts.slice(1)].join(" + ")
}

/** Slug that is stable, readable in a URL, and unique against the book. */
function idFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    "m-" +
    (name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "merchant")
  if (!taken.has(base)) return base
  // Suffix rather than overwrite: two merchants may legitimately share a name,
  // and reusing an id would make the second one edit the first one's file.
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

export function createMerchant(draft: MerchantDraft, existingIds: ReadonlySet<string>): Merchant {
  const terminals = kitFor(draft)
  const terminalCount = terminals.split("+").reduce((n, p) => n + qtyOf(p), 0)

  return {
    id: idFor(draft.name, existingIds),
    name: draft.name.trim(),
    sector: draft.sector,
    location: `${draft.city.trim()}, ${draft.country}`,
    size: draft.volume,
    terminals,
    terminalCount,

    // Capture is where it starts, and capture has not run yet.
    currentStep: 1,

    // Nothing has been approved and nothing has shipped, so there is no band on
    // any hardware to compare against. `null` says exactly that. Seeding it with
    // the studio's starting colour would record an approval that never happened,
    // on the one file guaranteed not to have had one.
    brandingApprovedAgainst: null,

    // IN FLIGHT AT THE FIRST RISK STEP, never "cleared". `riskLane` is required
    // without a default precisely so this decision is made explicitly, and the
    // honest answer for a file submitted seconds ago is that KYC has not begun.
    // The step id is read off RISK_LANE rather than written as a literal,
    // because the lane's ids are non-monotonic (10 → 11 → 2) and a hardcoded
    // "1" would point at Merchant capture, a step on a different lane.
    riskLane: { verdict: "in-flight", at: RISK_LANE[0].id },

    // Not "Needs sign-off" — nothing has been produced for anyone to sign off
    // on. The agent has to run capture first.
    status: "On track",
    submitted: "Just now",

    // NO `underwriting` BLOCK. Its absence is the whole point: an empty object
    // would render as "identity: —, documents: —", which reads as checks that
    // ran and found nothing, rather than checks that have not run. The type
    // makes it optional so this stays expressible.

    // One event, the one that actually happened.
    events: [
      {
        step: 1,
        actor: "Acquirer",
        text: `Merchant submitted with expected volume ${draft.volume}.`,
        time: "just now",
        done: true,
      },
    ],
  }
}
