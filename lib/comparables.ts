import { MERCHANTS, type Merchant } from "./acquirer-data"

/**
 * Lookalike merchants for the submit screen.
 *
 * The screen used to recommend a kit from a hardcoded string keyed on sector
 * alone — `location` was collected, was required to submit, and was then never
 * read. So a Manchester coffee shop was offered the same recommendation as one
 * in Málaga, and the "similar merchants in your book" it claimed to be drawing
 * from were never named, so nobody could see that the evidence was Spanish and
 * Italian.
 *
 * Two rules follow from that:
 *
 *  1. Comparables are matched on COUNTRY FIRST, then sector. An acquirer reads
 *     a lookalike as "a merchant like mine, trading where mine trades" —
 *     interchange, scheme mix, and the terminal estate all differ by market.
 *  2. When the book holds no same-country comparable, that is SAID, and the
 *     foreign fallback is labelled with the country it came from. Silently
 *     reaching for Málaga is what produced the original complaint; the absence
 *     of a local comparable is information the acquirer needs, not a gap to
 *     paper over.
 */

/** The markets this acquirer writes business in. */
export const MARKETS = [
  "UK",
  "IE",
  "FR",
  "DE",
  "NL",
  "ES",
  "IT",
  "PT",
  "AT",
  "NO",
] as const

export type Market = (typeof MARKETS)[number]

export const MARKET_NAMES: Record<Market, string> = {
  UK: "United Kingdom",
  IE: "Ireland",
  FR: "France",
  DE: "Germany",
  NL: "Netherlands",
  ES: "Spain",
  IT: "Italy",
  PT: "Portugal",
  AT: "Austria",
  NO: "Norway",
}

/**
 * Volume bands are quoted in the market's own currency.
 *
 * The form offered "€500k – €2m / yr" to a Manchester merchant whose book
 * entry reads "£2.4m / yr". Asking for a figure in the wrong currency makes
 * the band meaningless and the comparison to the book unreadable.
 */
const CURRENCY: Record<Market, string> = {
  UK: "£",
  NO: "kr ",
  IE: "€",
  FR: "€",
  DE: "€",
  NL: "€",
  ES: "€",
  IT: "€",
  PT: "€",
  AT: "€",
}

export function currencyFor(market: string): string {
  return CURRENCY[market as Market] ?? "€"
}

/** Band edges in millions, shared across markets so the bands stay comparable. */
const BAND_EDGES: [number, number][] = [
  [0, 0.5],
  [0.5, 2],
  [2, 5],
  [5, 10],
  [10, Infinity],
]

export function volumeBandsFor(market: string): string[] {
  const c = currencyFor(market)
  const unit = (n: number) => (n < 1 ? `${n * 1000}k` : `${n}m`)
  return BAND_EDGES.map(([lo, hi], i) => {
    if (i === 0) return `Under ${c}${unit(hi)} / yr`
    if (hi === Infinity) return `Over ${c}${unit(lo)} / yr`
    return `${c}${unit(lo)} – ${c}${unit(hi)} / yr`
  })
}

/** "Manchester, UK" → "UK". */
export function countryOf(location: string): string {
  const parts = location.split(",")
  return (parts[parts.length - 1] ?? "").trim()
}

/** "£2.4m / yr" → 2.4 ; "£680k / yr" → 0.68 ; "kr 22m / yr" → 22 */
export function volumeOf(size: string): number {
  const m = size.match(/([\d.]+)\s*([mk])/i)
  if (!m) return NaN
  const n = Number(m[1])
  return m[2].toLowerCase() === "k" ? n / 1000 : n
}

/** Midpoint of the band the user picked, for ranking by closeness of size. */
function bandMidpoint(band: string): number {
  const nums = [...band.matchAll(/([\d.]+)\s*([mk])/gi)].map(([, n, u]) =>
    u.toLowerCase() === "k" ? Number(n) / 1000 : Number(n),
  )
  if (nums.length === 0) return NaN
  if (/^Under/i.test(band)) return nums[0] / 2
  if (/^Over/i.test(band)) return nums[0] * 1.5
  return (nums[0] + nums[1]) / 2
}

export interface ComparableSet {
  /** Same country AND same sector — what the acquirer actually asked for. */
  matches: Merchant[]
  /**
   * True when `matches` came from outside the requested market because the
   * book holds no local merchant in that sector. Never silently true: the UI
   * must name the country when this is set.
   */
  foreign: boolean
  /** The market the acquirer asked about, echoed back for labelling. */
  country: string
  /** Countries the fallback was drawn from, when `foreign`. */
  foreignCountries: string[]
}

/**
 * Comparables for a prospective merchant, best match first.
 *
 * Ranked by closeness of annual volume, because two coffee shops on the same
 * street take different kit at £200k and £4m. Volume is only a tie-breaker
 * though — country and sector are filters, not weights, so a closer-sized
 * merchant in the wrong country can never outrank a local one.
 */
export function comparablesFor(
  sector: string,
  country: string,
  volumeBand?: string,
  book: Merchant[] = MERCHANTS,
): ComparableSet {
  if (!sector || !country) {
    return { matches: [], foreign: false, country, foreignCountries: [] }
  }

  const inSector = book.filter((m) => m.sector === sector)
  const local = inSector.filter((m) => countryOf(m.location) === country)

  const target = volumeBand ? bandMidpoint(volumeBand) : NaN
  const rank = (list: Merchant[]) =>
    Number.isFinite(target)
      ? [...list].sort(
          (a, b) =>
            Math.abs(volumeOf(a.size) - target) -
            Math.abs(volumeOf(b.size) - target),
        )
      : list

  if (local.length > 0) {
    return {
      matches: rank(local).slice(0, 3),
      foreign: false,
      country,
      foreignCountries: [],
    }
  }

  // No local comparable. Return the foreign ones, but flagged — the caller is
  // required to say where they came from.
  const fallback = rank(inSector).slice(0, 2)
  return {
    matches: fallback,
    foreign: fallback.length > 0,
    country,
    foreignCountries: [...new Set(fallback.map((m) => countryOf(m.location)))],
  }
}

/**
 * The recommended kit, derived from what the comparable merchants actually
 * run rather than typed as a per-sector string.
 *
 * This is the point of the change: the recommendation and the examples under
 * it are now the same evidence, so the panel cannot recommend one kit while
 * displaying merchants running another.
 */
export function recommendedKit(set: ComparableSet): string | null {
  const top = set.matches[0]
  return top ? top.terminals : null
}
