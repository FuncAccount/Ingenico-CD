/**
 * Sign-up rate projection for an overridden tariff.
 *
 * The measured anchor (58–71%) comes from comparable merchants priced on the
 * AGENT'S bundle. Once the acquirer types their own rates, that measurement no
 * longer describes the card on screen — but refusing to say anything is its own
 * failure, because the whole reason to change a rate is to find out what it does.
 *
 * So this projects, and makes the projection legible as a projection:
 *
 *   1. Every line carries a NAMED sensitivity (points of sign-up per unit), so
 *      the arithmetic can be printed rather than asserted.
 *   2. Each line carries the SPAN OF RATES COMPARABLES ACTUALLY COVER. Inside it
 *      the model interpolates; outside it extrapolates and must say so, because
 *      a figure produced by running a curve past its last observation looks
 *      identical to one sitting on top of real data.
 *   3. The band WIDENS with distance from the tested bundle. A projection that
 *      kept the anchor's 13-point width while moving 20 points away would claim
 *      the model got no less certain as it left the evidence behind.
 *   4. An unreadable entry is never treated as zero.
 */

export type RateUnit = "gbp" | "pct"

export type Sensitivity = {
  unit: RateUnit
  /** Points of sign-up per £1, or per 1.00 percentage point of rate. */
  pointsPerUnit: number
  /** [min, max] of this rate across the comparable set. */
  supported: [number, number]
  note: string
}

export type TariffLine = {
  label: string
  value: string
  sensitivity?: Sensitivity
}

export type LineDelta = {
  label: string
  from: number
  to: number
  /** Signed points of sign-up attributed to this line. */
  points: number
  unit: RateUnit
  /** True when `to` sits outside the comparable span. */
  extrapolated: boolean
  supported: [number, number]
  note: string
}

export type Projection =
  /** Nothing changed — report the measurement, not a model of it. */
  | { state: "measured"; low: number; high: number }
  /** One or more entries could not be read as a rate. */
  | { state: "unreadable"; labels: string[] }
  /** A line has no sensitivity, so its effect is unknown rather than zero. */
  | { state: "unmodelled"; labels: string[] }
  | {
      state: "modelled"
      low: number
      high: number
      deltas: LineDelta[]
      /** Net points applied to the anchor. */
      netPoints: number
      /** Extra band width added for distance from the tested bundle. */
      widening: number
      /** Lines whose new rate sits outside the comparable span. */
      extrapolated: LineDelta[]
    }

/**
 * Reads "£19", "1.40%", "0.9", "  £25 ". Returns null for anything else —
 * including an empty box, which is a rate nobody has stated rather than £0.
 */
export function parseRate(raw: string): number | null {
  const cleaned = raw.replace(/[£$€\s%,]/g, "")
  if (cleaned === "") return null
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function formatRate(n: number, unit: RateUnit): string {
  return unit === "gbp"
    ? `£${Number.isInteger(n) ? n : n.toFixed(2)}`
    : `${n.toFixed(2)}%`
}

/** Band width grows by this many points per point of net movement. */
const WIDENING_PER_POINT = 0.28
/** Extrapolated lines are less trustworthy again. */
const WIDENING_PER_EXTRAPOLATED_LINE = 1.5

export function projectSignUp(
  lines: TariffLine[],
  overrides: Record<string, string>,
  anchor: { low: number; high: number },
): Projection {
  const unreadable: string[] = []
  const unmodelled: string[] = []
  const deltas: LineDelta[] = []

  for (const line of lines) {
    const typed = overrides[line.label]
    if (typed === undefined) continue

    const to = parseRate(typed)
    const from = parseRate(line.value)
    if (to === null || from === null) {
      unreadable.push(line.label)
      continue
    }
    if (to === from) continue

    // A line the model was never fitted on cannot contribute 0 points — that
    // would report "your change had no effect" for something never measured.
    if (!line.sensitivity) {
      unmodelled.push(line.label)
      continue
    }

    const s = line.sensitivity
    deltas.push({
      label: line.label,
      from,
      to,
      points: (to - from) * s.pointsPerUnit,
      unit: s.unit,
      extrapolated: to < s.supported[0] || to > s.supported[1],
      supported: s.supported,
      note: s.note,
    })
  }

  // Order matters: an unreadable entry is a stronger objection than a missing
  // model, and both outrank a number we could produce.
  if (unreadable.length > 0) return { state: "unreadable", labels: unreadable }
  if (unmodelled.length > 0) return { state: "unmodelled", labels: unmodelled }
  if (deltas.length === 0) return { state: "measured", low: anchor.low, high: anchor.high }

  const netPoints = deltas.reduce((sum, d) => sum + d.points, 0)
  const movement = deltas.reduce((sum, d) => sum + Math.abs(d.points), 0)
  const extrapolated = deltas.filter((d) => d.extrapolated)
  const widening =
    movement * WIDENING_PER_POINT + extrapolated.length * WIDENING_PER_EXTRAPOLATED_LINE

  // Clamped to 0–100: a sign-up rate is a share, and a model run far enough past
  // its evidence will happily produce 112%.
  const low = clamp(anchor.low + netPoints - widening / 2)
  const high = clamp(anchor.high + netPoints + widening / 2)

  return { state: "modelled", low, high, deltas, netPoints, widening, extrapolated }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n))
}
