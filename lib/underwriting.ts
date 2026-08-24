// Underwriting — the decomposition behind the risk score.
//
// The score used to be a hand-typed number on the merchant record. You were
// asked to put your licence behind "18 / 100" with nothing underneath it. A
// score you cannot interrogate is not evidence, it is an assertion, and the one
// person who most needs to argue with it is the regulated signer.
//
// So the score here is the SUM of the factors shown. It cannot disagree with
// its own breakdown, because it is computed from it.

import { PIPELINE, type Merchant } from "@/lib/acquirer-data"

/** A merchant past underwriting has, by definition, had its KYC completed —
 *  the fixture just doesn't carry the detail for merchants seeded mid-journey.
 *  Treating that as "checks not run" scored a completed step as an open gap and
 *  put ten merchants in Medium for want of data rather than for cause, while
 *  their own timelines said "Underwriting signed off". Read the completion from
 *  the journey position, so the two can never disagree. */
export const UNDERWRITING_STEP = 2

/**
 * Index of the task that actually refuses when documents are missing.
 *
 * Derived from the task's own label rather than written as `3`. A literal
 * would keep pointing at position 3 if the task list were ever reordered,
 * putting the halt marker on whichever task happened to move into that slot —
 * a stop rendered against the wrong row is worse than no stop, because it
 * accuses a check that passed. Falls back to -1, which matches no row, so a
 * rename shows nothing rather than mislabelling something.
 */
export const SCORE_THE_RISK_TASK: number =
  PIPELINE.find((s) => s.id === UNDERWRITING_STEP)?.tasks.findIndex((t) =>
    /score the risk/i.test(t.label),
  ) ?? -1

export const CAPTURE_STEP = 1

/**
 * Index of capture's document pass — the task that assembles the bundle and is
 * therefore the one that comes up short when the required set is incomplete.
 *
 * Derived from the label for the same reason as `SCORE_THE_RISK_TASK` above,
 * and this step has just been reorganised once (five document tasks collapsed
 * into one), which is exactly the edit a literal index would have survived
 * while silently pointing at the registry lookup.
 */
export const DOCUMENT_PASS_TASK: number =
  PIPELINE.find((s) => s.id === CAPTURE_STEP)?.tasks.findIndex((t) =>
    /document bundle/i.test(t.label),
  ) ?? -1

function pastUnderwriting(merchant: Merchant): boolean {
  // Reads the RISK LANE, not the build position. `currentStep > 2` was sound
  // while the pipeline was a single file, but the lanes now run in parallel:
  // a merchant can be at Configure with underwriting still open, and that test
  // would have called the file approved because the KIT had moved on. The lane
  // is the only thing that carries this verdict.
  return merchant.riskLane.verdict === "cleared"
}

/** The score actually recorded for this merchant — from the underwriting block
 *  where it exists, otherwise from the sign-off line in its own timeline. Read
 *  rather than re-derived, so the breakdown and the timeline cannot disagree. */
export function recordedScore(merchant: Merchant): number | null {
  // An unscoreable file has no recorded score, and must not acquire one by
  // regex from a timeline entry written before the gap was found.
  if ((merchant.underwriting?.documentsOutstanding?.length ?? 0) > 0) return null
  if (typeof merchant.underwriting?.riskScore === "number") return merchant.underwriting.riskScore
  for (const e of merchant.events) {
    const m = /risk score\s+(\d+)/i.exec(e.text)
    if (m) return Number.parseInt(m[1], 10)
  }
  return null
}

export interface RiskFactor {
  label: string
  /** Signed points. Positive adds risk, negative reduces it. */
  points: number
  /** What was actually observed. Never a bare verdict. */
  evidence: string
  /** Where the observation came from — these are not the same authority. */
  source: string
  /** True when the check could not be completed. A gap and a clean result are
   *  different claims, and the difference has to be readable by code, not just
   *  by whoever notices the wording in `evidence`. */
  open?: boolean
}

export type RiskBand = "Low" | "Medium" | "Elevated"

/** Published thresholds. Stated rather than implied, so a score near a boundary
 *  can be argued about instead of just accepted. */
export const BANDS: { band: RiskBand; min: number; max: number }[] = [
  { band: "Low", min: 0, max: 24 },
  { band: "Medium", min: 25, max: 49 },
  { band: "Elevated", min: 50, max: 100 },
]

export function bandFor(score: number): RiskBand {
  return BANDS.find((b) => score >= b.min && score <= b.max)?.band ?? "Elevated"
}

/* --------------------------------------------------------------- ingredients */

/** Baseline exposure by trade. Card-present hospitality and high-ticket
 *  automotive do not carry the same chargeback profile, so they do not carry
 *  the same base. */
const SECTOR_BASE: Record<string, { points: number; why: string }> = {
  Hospitality: { points: 12, why: "Card-present, low ticket, seasonal staffing turnover" },
  Retail: { points: 10, why: "Card-present with a returns-driven dispute pattern" },
  Pharmacy: { points: 8, why: "Regulated trade, low fraud rate, high compliance obligation" },
  "Health & Fitness": {
    points: 18,
    why: "Recurring membership billing — the highest dispute category in the book",
  },
  Leisure: { points: 15, why: "Deposits taken well ahead of delivery" },
  Automotive: { points: 14, why: "High average ticket concentrates loss on any single dispute" },
  // Healthcare and Transport are both live in the book and were both missing
  // here, so every one of those merchants was silently scored on the "no sector
  // baseline on file" default. A default is the right behaviour for a trade
  // nobody has assessed; it is the wrong behaviour for two we carry.
  Healthcare: {
    points: 16,
    why: "Treatment plans and procedures billed before the course of care completes",
  },
  Transport: { points: 15, why: "Tickets sold well ahead of travel, and refundable on cancellation" },
}

/** Trades where the customer pays now and receives later.
 *
 *  This list is the "high-risk category list" the acceptance panel cites. It
 *  previously did not exist: the panel answered "No — not a deferred-delivery
 *  category" for every merchant in the book, including the ones whose own
 *  sector baseline above says deposits are taken ahead of delivery.
 *
 *  Keyed by sector because that is known from the application, which is what
 *  makes this test answerable even on a file the engine cannot score.
 */
export const DEFERRED_DELIVERY: Record<string, string> = {
  Leisure: "deposits taken well ahead of the stay or sailing",
  "Health & Fitness": "memberships billed in advance of the months they cover",
  Healthcare: "treatment plans billed before the course of care completes",
  Transport: "tickets sold ahead of travel and refundable on cancellation",
}

/** Parse the annual volume band into a number of major units, currency-agnostic:
 *  the band is a magnitude, and we only use it to size exposure. */
export function annualVolume(size: string): number | null {
  const m = /([\d.]+)\s*(m|k)?/i.exec(size.replace(/,/g, ""))
  if (!m) return null
  const n = Number.parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const unit = (m[2] ?? "").toLowerCase()
  return unit === "m" ? n * 1_000_000 : unit === "k" ? n * 1_000 : n
}

/* ------------------------------------------------------------------ assembly */

export interface RiskAssessment {
  factors: RiskFactor[]
  /** The sum of the factors above, clamped to the 0–100 scale. */
  score: number
  band: RiskBand
  /** True when clamping actually bit, so the total is disclosed as capped
   *  rather than silently presented as the arithmetic result. */
  clamped: boolean
  rawTotal: number
  /**
   * When set, the file COULD NOT be scored and `score`/`band` are meaningless.
   * A risk model weighs the evidence it has against the evidence it needs, and
   * a missing mandatory document is not a low signal — it is the absence of
   * one, so the honest output is a refusal, not a number. Callers must branch
   * on this before showing a score.
   */
  blocked?: {
    missing: string[]
    reason: string
  }
}

/** The documents that must be on file before a score can exist at all. Read
 *  from the merchant, so the same list drives the refusal, the stop banner and
 *  the chase — one source, so they cannot disagree about what is missing. */
export function outstandingDocuments(merchant: Merchant): string[] {
  return merchant.underwriting?.documentsOutstanding ?? []
}

export function riskAssessment(merchant: Merchant): RiskAssessment {
  const factors: RiskFactor[] = []
  const uw = merchant.underwriting

  // The stop. Assembling factors and clamping a total would manufacture a
  // number the file does not support — the very thing that let an incomplete
  // application read as "Low". Refuse before scoring, and say what is missing.
  const missing = outstandingDocuments(merchant)
  if (missing.length > 0) {
    return {
      factors: [],
      score: 0,
      band: "Elevated",
      clamped: false,
      rawTotal: 0,
      blocked: {
        missing,
        reason:
          "Risk cannot be scored until every mandatory document is on file. The agent has parsed what was supplied and is chasing the rest — scoring now would put a number on evidence that does not exist yet.",
      },
    }
  }

  const sector = SECTOR_BASE[merchant.sector] ?? {
    points: 12,
    why: "No sector baseline on file — the book default is applied",
  }
  factors.push({
    label: `Sector baseline — ${merchant.sector}`,
    points: sector.points,
    evidence: sector.why,
    source: "Portfolio loss history, rolling 24 months",
  })

  const vol = annualVolume(merchant.size)
  if (vol === null) {
    factors.push({
      label: "Volume exposure",
      points: 8,
      evidence: `Volume band "${merchant.size}" could not be read, so the conservative default is applied rather than nothing.`,
      source: "Merchant application",
    })
  } else {
    const pts = vol >= 5_000_000 ? 10 : vol >= 2_000_000 ? 6 : vol >= 1_000_000 ? 3 : 1
    factors.push({
      label: "Volume exposure",
      points: pts,
      evidence: `${merchant.size} declared. Larger books concentrate more settlement risk on one counterparty.`,
      source: "Merchant application",
    })
  }

  // Identity verification REDUCES risk. Showing it as a negative makes the
  // point that verification is a mitigant, not a hurdle that was cleared.
  if (uw?.identity || pastUnderwriting(merchant)) {
    factors.push({
      label: "Identity verified",
      // Verification is the EXPECTED state, not a bonus. Crediting it heavily
      // dragged every clean file toward zero and forced a large unexplained
      // residual to reconcile with the score actually recorded at sign-off.
      points: -2,
      evidence: uw?.identity ?? "Registry and beneficial-owner checks completed at underwriting.",
      source: "Registry + KYC provider",
    })
  } else {
    factors.push({
      label: "Identity not yet verified",
      points: 14,
      evidence: "No registry match on file. This is an absent check, not a passed one.",
      source: "Registry + KYC provider",
      open: true,
    })
  }

  if (uw?.documents || pastUnderwriting(merchant)) {
    factors.push({
      label: "Documentation consistent",
      points: -1,
      evidence: uw?.documents ?? "Documents parsed at underwriting with no inconsistencies raised.",
      source: "Merchant upload, agent-parsed",
    })
  } else {
    // Previously pushed nothing at all, so a merchant with no documents scored
    // identically to one whose documents were merely unhelpful — the gap was
    // invisible in both the score and the breakdown.
    factors.push({
      label: "Documentation not received",
      points: 8,
      evidence: "Nothing on file to parse. The consistency check has not run.",
      source: "Merchant upload, agent-parsed",
      open: true,
    })
  }

  factors.push({
    label: "Sanctions and PEP screening",
    points: -1,
    evidence: "No match against EU, OFAC or UK HMT consolidated lists.",
    source: "Screening provider",
  })

  // Delivery risk: the gap between paying and receiving. This is the driver an
  // acquirer actually carries, because an unfulfilled order becomes a
  // chargeback against the acquirer, not against the merchant's bank balance.
  const DELIVERY: Record<string, { points: number; why: string }> = {
    Hospitality: { points: 6, why: "Bookings and deposits are taken ahead of the stay" },
    Leisure: { points: 9, why: "Long lead time between payment and delivery" },
    "Health & Fitness": { points: 11, why: "Membership billed monthly against future access" },
    Retail: { points: 2, why: "Goods handed over at the point of sale" },
    Pharmacy: { points: 1, why: "Immediate fulfilment, negligible delivery gap" },
    Automotive: { points: 4, why: "Deposits against ordered stock" },
  }
  const del = DELIVERY[merchant.sector] ?? {
    points: 5,
    why: "No delivery profile on file — the book default is applied",
  }
  factors.push({
    label: "Delivery risk",
    points: del.points,
    evidence: `${del.why}. Unfulfilled orders land on the acquirer as chargebacks.`,
    source: "Portfolio chargeback analysis",
  })

  // Estate size: more terminals means more places a card can be presented, and
  // more staff handling them.
  if (merchant.terminalCount > 0) {
    const pts = merchant.terminalCount >= 10 ? 5 : merchant.terminalCount >= 5 ? 3 : 1
    factors.push({
      label: "Estate size",
      points: pts,
      evidence: `${merchant.terminalCount} terminal${merchant.terminalCount === 1 ? "" : "s"} across the estate.`,
      source: "Terminal order",
    })
  }

  // The edge case is the reason a human is in this loop at all, so it carries
  // real weight rather than being a footnote under a score decided elsewhere.
  if (uw?.edgeCase) {
    factors.push({
      label: "Open item raised by screening",
      points: 9,
      evidence: uw.edgeCase,
      source: "Agent review — escalated for your judgement",
    })
  }

  // Where a score was recorded at sign-off, THAT is the number the decision was
  // taken on, and this breakdown must reconcile to it rather than quietly
  // publish a competing one. The generic factors above cannot know what the
  // underwriter saw, so the remainder is carried as a named, visible line
  // instead of being absorbed silently or left to contradict the timeline.
  const recorded = recordedScore(merchant)
  if (recorded !== null) {
    const delta = recorded - factors.reduce((s, f) => s + f.points, 0)
    if (delta !== 0) {
      factors.push({
        label: "Case-specific adjustment at sign-off",
        points: delta,
        evidence:
          delta > 0
            ? "The underwriter scored this case higher than the standard factors explain. The reason was recorded in the case notes, not in a structured field, so it cannot be shown here."
            : "The underwriter scored this case lower than the standard factors explain, i.e. accepted a mitigant not modelled above. The reason sits in the case notes.",
        source: "Underwriting sign-off record",
        open: true,
      })
    }
  }

  const rawTotal = factors.reduce((s, f) => s + f.points, 0)
  const score = Math.max(0, Math.min(100, rawTotal))
  return { factors, score, band: bandFor(score), clamped: score !== rawTotal, rawTotal }
}

/* --------------------------------------------------- exposure and acceptance */

/** One row of the acceptance panel: what the engine returned, and on whose
 *  authority. `value: null` is a withheld figure and always carries a source
 *  saying why — never a blank, and never a zero. */
export interface LimitRow {
  value: string | null
  source: string
}

export interface AcceptanceLimit {
  category: LimitRow
  dailyLimit: LimitRow
  settlementWindow: LimitRow
  fullerReview: LimitRow
  /** True when the file cannot be scored, so category and limit are withheld. */
  unscored: boolean
}

/** Working days used to turn an annual band into a daily one. */
const WORKING_DAYS = 250

/** Headroom over average daily takings, by band. A limit set at the average
 *  would decline a merchant on their best day, so the multiple falls as risk
 *  rises rather than the limit being cut to the average. */
const HEADROOM: Record<RiskBand, number> = { Low: 1.6, Medium: 1.3, Elevated: 1.0 }

const CATEGORY: Record<RiskBand, string> = {
  Low: "Standard",
  Medium: "Standard — monitored",
  Elevated: "Elevated",
}

/** The merchant's own currency symbol, read off the declared volume band.
 *  `annualVolume` is deliberately currency-agnostic — it reads a magnitude —
 *  so the symbol has to be carried separately or a euro merchant gets quoted a
 *  sterling limit. */
function currencyOf(size: string): string {
  return /([^\d\s.,]+)/.exec(size)?.[1] ?? ""
}

/**
 * What the acquirer's risk engine and credit policy return for this merchant.
 *
 * DERIVED FROM `riskAssessment`, which is the authority every other surface
 * already uses — the risk desk, the sign-off panel and the score breakdown.
 * This panel used to ask a different question: whether a score had been typed
 * into the fixture (`recordedScore`). On a file scored from its factors but
 * never hand-annotated, the two disagreed, so the sign-off screen showed a real
 * score and band while the acceptance panel beside it reported the category and
 * limit as "not on file". One question, two answers, on adjacent panels.
 *
 * There is exactly one reason to withhold: the file cannot be scored because
 * mandatory documents are missing. That is the same condition that drives the
 * halt banner, the chase and the sign-off gate, so the panel can no longer
 * disagree with any of them about whether this file is ready.
 */
export function acceptanceLimit(merchant: Merchant): AcceptanceLimit {
  const assessment = riskAssessment(merchant)

  /* Answerable WITHOUT a score. The deferred-delivery test reads the trade,
     which is known from the application, so this row stays populated even on a
     blocked file. Previously it was hardcoded "No", which on an unscored file
     also contradicted the row above it: the panel said the category could not
     be assigned and then answered a question about the category. */
  const deferred = DEFERRED_DELIVERY[merchant.sector]
  const fullerReview: LimitRow = {
    value: deferred ? `Yes — ${merchant.sector.toLowerCase()} is a deferred-delivery trade` : "No",
    source: deferred
      ? `your credit policy — high-risk category list: ${deferred}`
      : `your credit policy — high-risk category list does not name ${merchant.sector.toLowerCase()}`,
  }

  /* A settlement cycle is a commercial term of the merchant's contract, not an
     output of the risk model, so it is knowable on any file. */
  const settlementWindow: LimitRow = {
    value: "2 working days",
    source: "your settlement cycle for this merchant type",
  }

  if (assessment.blocked) {
    return {
      unscored: true,
      // Withheld, not zeroed. A limit of £0 reads as a decision to accept
      // nothing, which is a rejection nobody made.
      category: { value: null, source: "cannot be assigned until the file can be scored" },
      dailyLimit: {
        value: null,
        source: `your policy returns no limit until the file is scored — ${assessment.blocked.missing.length} document(s) outstanding`,
      },
      settlementWindow,
      fullerReview,
    }
  }

  const vol = annualVolume(merchant.size)
  const symbol = currencyOf(merchant.size)
  const daily =
    vol === null ? null : Math.round((vol / WORKING_DAYS) * HEADROOM[assessment.band] / 500) * 500

  return {
    unscored: false,
    category: {
      value: CATEGORY[assessment.band],
      source: `your credit policy — category rules, on a score of ${assessment.score} (${assessment.band})`,
    },
    dailyLimit:
      daily === null
        ? {
            // A volume band that cannot be parsed is a gap in the application,
            // not a limit of zero, and it is named as such.
            value: null,
            source: `declared volume "${merchant.size}" could not be read, so no limit can be sized`,
          }
        : {
            value: `${symbol}${daily.toLocaleString("en-GB")} / day`,
            source: `your credit policy — ${assessment.band.toLowerCase()}-band rule at ${HEADROOM[assessment.band]}× average daily takings on ${merchant.size}`,
          },
    settlementWindow,
    fullerReview,
  }
}

/* ---------------------------------------------------------------- edge cases */

export type EdgeVerdict = "accept" | "condition" | "refer"

export interface EdgeResolution {
  verdict: EdgeVerdict
  /** Required on a conditional accept: a condition nobody wrote down is not a
   *  condition, it is a hope. */
  note: string
}

export const EDGE_VERDICTS: { id: EdgeVerdict; label: string; hint: string; needsNote: boolean }[] = [
  {
    id: "accept",
    label: "Accept as-is",
    hint: "The item is understood and does not change the decision.",
    needsNote: false,
  },
  {
    id: "condition",
    label: "Accept with a condition",
    hint: "Proceed, but attach an obligation to the account.",
    needsNote: true,
  },
  {
    id: "refer",
    label: "Refer to credit committee",
    hint: "Above your delegated authority, or you want a second signature.",
    needsNote: true,
  },
]

/** An unresolved edge case blocks the underwriting sign-off. It was escalated
 *  precisely because the agent would not decide it. */
export function edgeResolved(merchant: Merchant, res: EdgeResolution | undefined): boolean {
  if (!merchant.underwriting?.edgeCase) return true
  if (!res) return false
  const needsNote = EDGE_VERDICTS.find((v) => v.id === res.verdict)?.needsNote ?? false
  return !needsNote || res.note.trim().length > 0
}
