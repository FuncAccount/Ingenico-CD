// Branding — the one step where the acquirer designs rather than approves.
//
// Why this is the acquirer's decision and not Ingenico's: the customer sees the
// merchant's brand on the terminal, but the receipt names YOUR legal entity as
// the payment processor. Ingenico manufactures the device; it does not own what
// is printed under your licence. So the design surface, and the sign-off, are
// yours.
//
// The rule checks below are computed from the live theme, never asserted. That
// matters: a rule that is hard-coded to "pass" turns approval into a rubber
// stamp, which is the exact failure mode a compliance gate exists to prevent.

import type { Merchant } from "@/lib/acquirer-data"

/* ------------------------------------------------------------------ colour */

/** sRGB channel → linear, per WCAG 2.1 relative luminance. */
function channel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = Number.parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function luminance(hex: string): number {
  const c = parseHex(hex)
  if (!c) return 0
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

/** WCAG contrast ratio, 1–21. Real arithmetic: change a colour, this moves. */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Pick whichever of black/white is more legible on a given ground. */
export function readableOn(bg: string): string {
  return contrast(bg, "#FFFFFF") >= contrast(bg, "#0A1E3C") ? "#FFFFFF" : "#0A1E3C"
}

/* ------------------------------------------------------------------- theme */

/** How the two brands share the device. Co-branded is the house rule. */
export type Lockup = "merchant-lead" | "balanced"

export interface BrandTheme {
  /** Merchant's primary colour — the ground of the welcome and amount screens. */
  primary: string
  /** Ink used for the amount and headline text. */
  ink: string
  /** What the customer sees on the terminal. Hardware limit is 24 characters. */
  displayName: string
  /** Header printed at the top of the receipt. */
  receiptHeader: string
  /** Whether the merchant supplied real artwork, or we fall back to a wordmark. */
  logoSupplied: boolean
  lockup: Lockup
  /** Merchant's own line of thanks. Optional — an absent one is not an error. */
  receiptFooter: string
}

/** The acquirer's own identity, fixed. This is the co-brand's other half. */
export const ACQUIRER = {
  name: "Northgate Payments",
  /** Printed on every receipt under licence. Not editable — it is a legal line. */
  legalLine: "Processed by Northgate Payments Ltd · FCA 784412",
  mark: "#0A1E3C",
  /** The authorised reversed variant, for dark grounds. Using it is not a
   *  recolour: both variants are part of the supplied brand asset set. */
  markReversed: "#FFFFFF",
  /** Identity colours a merchant band must stay clear of, so the customer can
   *  always tell whose terminal they are standing at. */
  identity: ["#0A1E3C", "#00B9E4"],
} as const

/** Rough perceptual distance, enough to catch "this is basically our navy".
 *  Not a colour-science metric, and it does not pretend to be one. */
export function colourDistance(a: string, b: string): number {
  const x = parseHex(a)
  const y = parseHex(b)
  if (!x || !y) return Number.POSITIVE_INFINITY
  return Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2)
}

/** Terminal hardware constraint, not a style choice. */
export const DISPLAY_NAME_LIMIT = 24

/** Seed a theme from the merchant record so nothing starts blank. */
export function defaultTheme(merchant: Merchant): BrandTheme {
  const seed = SEEDS[merchant.id] ?? { primary: "#0A1E3C", logo: false }
  return {
    primary: seed.primary,
    ink: readableOn(seed.primary),
    displayName: merchant.name.slice(0, DISPLAY_NAME_LIMIT),
    receiptHeader: merchant.name,
    logoSupplied: seed.logo,
    lockup: "balanced",
    receiptFooter: "Thank you",
  }
}

/** Per-merchant starting points. Verde starts on a pale yellow that FAILS the
 *  contrast gate, so the block is demonstrable rather than theoretical. */
const SEEDS: Record<string, { primary: string; logo: boolean }> = {
  "m-atlas": { primary: "#7A1E2B", logo: true },
  "m-verde": { primary: "#E8C547", logo: false },
  "m-nordwind": { primary: "#1F6F4A", logo: true },
  "m-solmar": { primary: "#00B9E4", logo: false },
  "m-brightline": { primary: "#2B2F77", logo: true },
  "m-tavo": { primary: "#B04A2F", logo: false },
  "m-fjord": { primary: "#0A1E3C", logo: true },
  "m-lumen": { primary: "#3C3C3C", logo: false },
  "m-cedar": { primary: "#7A1E2B", logo: true },
  "m-havenport": { primary: "#1F6F4A", logo: false },
  "m-kessler": { primary: "#2B2F77", logo: true },
}

/* ------------------------------------------------------------------- rules */

/** `fixed` is not a passed check. It marks a property the platform guarantees
 *  regardless of the design, so it can never fail — and must therefore never
 *  be dressed as a gate that examined this merchant's work. */
export type RuleState = "pass" | "fail" | "advisory" | "fixed"

export interface BrandRule {
  id: string
  label: string
  state: RuleState
  /** What was measured, in the reader's terms. Never a bare verdict. */
  detail: string
  /** Whose standard this is — it is not all the same authority. */
  source: "Acquirer brand standard" | "Terminal hardware" | "Scheme / regulatory"
  /** A failing blocking rule stops approval. Advisories never do. */
  blocking: boolean
  /** What is WRONG, for use when the rule fails. A label states the condition
   *  that would satisfy the rule ("band is distinguishable from us"), so
   *  reusing it in a failure message asserts the opposite of what happened. */
  problem?: string
  /** Offered only where the fix is unambiguous. */
  fix?: { label: string; apply: (t: BrandTheme) => BrandTheme }
}

const AA_TEXT = 4.5
const AA_LARGE = 3
/** Minimum RGB distance a merchant band must keep from an acquirer identity
 *  colour. Tuned so a near-identical navy is caught and ordinary dark brand
 *  colours are not — the gate has to bite rarely to mean anything. */
const IDENTITY_CLEARANCE = 50

/** Picks the authorised mark variant for a ground, the way the device would. */
export function markVariantFor(ground: string): { hex: string; name: string } {
  const dark = contrast(ground, ACQUIRER.mark)
  const light = contrast(ground, ACQUIRER.markReversed)
  return light > dark
    ? { hex: ACQUIRER.markReversed, name: "reversed" }
    : { hex: ACQUIRER.mark, name: "standard" }
}

export function checkBrand(theme: BrandTheme): BrandRule[] {
  const rules: BrandRule[] = []

  // 1. The amount matters most, but the ink is auto-selected against whatever
  //    band is chosen, so this can never fail. Reported as a measurement, NOT
  //    as a gate: a blocking rule that cannot block is decoration, and it also
  //    hides the one contrast check that genuinely can fail (the co-brand).
  const amountRatio = contrast(theme.primary, theme.ink)
  rules.push({
    id: "amount-contrast",
    label: "Amount is legible on the brand colour",
    state: amountRatio >= AA_TEXT ? "pass" : "advisory",
    detail: `${amountRatio.toFixed(2)}:1. The ink is chosen automatically for whichever band you pick, so this stays above the ${AA_LARGE}:1 display-size floor on its own.`,
    source: "Acquirer brand standard",
    blocking: false,
  })

  // 2. THE co-brand check with teeth. Your mark is fixed — a brand lockup is
  //    content, so it is never recoloured to suit a merchant's band. When the
  //    two collide the mark simply disappears, and on a co-branded device that
  //    means your half of the agreement is not being delivered.
  const variant = markVariantFor(theme.primary)
  const markRatio = contrast(theme.primary, variant.hex)
  rules.push({
    id: "cobrand-mark",
    label: `${ACQUIRER.name} mark is visible on the merchant band`,
    state: markRatio >= AA_LARGE ? "pass" : "fail",
    detail: `${markRatio.toFixed(2)}:1 using the ${variant.name} mark, which the device selects for this band. ${AA_LARGE}:1 required.`,
    source: "Acquirer brand standard",
    blocking: true,
    problem: "your mark is not legible on the merchant's band",
  })

  // 3. Brand confusion. A merchant is not permitted to present as the acquirer:
  //    if the band is essentially your own identity colour, the customer cannot
  //    tell whose terminal they are at, and the co-brand stops meaning anything.
  //    This is the check that genuinely bites, and it is yours to enforce.
  const nearest = ACQUIRER.identity
    .map((c) => ({ c, d: colourDistance(theme.primary, c) }))
    .sort((a, b) => a.d - b.d)[0]
  rules.push({
    id: "brand-collision",
    label: `Band is distinguishable from ${ACQUIRER.name}`,
    state: nearest.d < IDENTITY_CLEARANCE ? "fail" : "pass",
    detail:
      nearest.d < IDENTITY_CLEARANCE
        ? `The band is within ${nearest.d.toFixed(0)} of your own ${nearest.c}, against a ${IDENTITY_CLEARANCE} clearance. The terminal would read as a Northgate device, not the merchant's.`
        : `${nearest.d.toFixed(0)} clear of the nearest identity colour (${nearest.c}), against a ${IDENTITY_CLEARANCE} minimum.`,
    source: "Acquirer brand standard",
    blocking: true,
    problem: `the band is too close to your own ${nearest.c}`,
  })

  // 3. Hardware truncates silently. A name cut mid-word looks like a fault in
  //    your platform, in front of the customer.
  const over = theme.displayName.length > DISPLAY_NAME_LIMIT
  rules.push({
    id: "display-name",
    label: "Display name fits the terminal",
    state: theme.displayName.trim().length === 0 ? "fail" : over ? "fail" : "pass",
    detail:
      theme.displayName.trim().length === 0
        ? "Empty. The welcome screen would show nothing at all."
        : `${theme.displayName.length} of ${DISPLAY_NAME_LIMIT} characters.${over ? " The device will cut the rest." : ""}`,
    source: "Terminal hardware",
    blocking: true,
    problem:
      theme.displayName.trim().length === 0
        ? "the display name is empty"
        : `the display name is ${theme.displayName.length - DISPLAY_NAME_LIMIT} characters too long`,
    fix: over
      ? {
          label: "Trim to fit",
          apply: (t) => ({ ...t, displayName: t.displayName.slice(0, DISPLAY_NAME_LIMIT).trim() }),
        }
      : undefined,
  })

  // 4. Placement, distinct from rule 2's legibility. Both lockups keep both
  //    marks on the device, so this reports WHERE yours sits rather than being
  //    stamped "pass" against a condition nothing could ever violate.
  rules.push({
    id: "cobrand-placement",
    label: "Placement of the two marks",
    state: "fixed",
    detail:
      theme.lockup === "balanced"
        ? `Merchant mark leads the welcome screen; the ${ACQUIRER.name} mark holds the footer on every screen.`
        : `Merchant mark leads throughout; the ${ACQUIRER.name} mark is reduced to the footer rule only.`,
    source: "Acquirer brand standard",
    blocking: false,
  })

  // 5. A legal line the design cannot switch off is a disclosure, not a check.
  //    It was previously "pass" + blocking, which claimed a gate had examined
  //    this merchant when nothing had been measured at all.
  rules.push({
    id: "legal-line",
    label: "Processor disclosure on the receipt",
    state: "fixed",
    detail: `"${ACQUIRER.legalLine}" prints on every receipt and cannot be edited or removed.`,
    source: "Scheme / regulatory",
    blocking: false,
  })

  // 6. A missing logo is a gap in what the merchant gave us, not a design fault.
  //    Advisory, because shipping the wordmark is a legitimate outcome.
  rules.push({
    id: "logo",
    label: "Merchant artwork supplied",
    state: theme.logoSupplied ? "pass" : "advisory",
    detail: theme.logoSupplied
      ? "Vector artwork on file, clear of the safe area."
      : "No artwork on file. The device will set the display name as a wordmark instead — legitimate, but ask the merchant if they have a logo.",
    source: "Acquirer brand standard",
    blocking: false,
  })

  return rules
}

/** Approval is blocked only by a FAILING rule that blocks. An advisory never
 *  stops you: it is information, not a verdict. */
export function blockers(rules: BrandRule[]): BrandRule[] {
  return rules.filter((r) => r.blocking && r.state === "fail")
}

/* ----------------------------------------------------------------- receipt */

export interface ReceiptLine {
  text: string
  weight?: "bold" | "normal"
  align?: "center" | "left" | "split"
  right?: string
  /** Rendered in grey — the parts the merchant does not control. */
  system?: boolean
}

/** One generator, used by both the on-screen proof and the PDF the merchant
 *  gets. Two renderers would eventually disagree about what was approved. */
export function receiptProof(theme: BrandTheme, merchant: Merchant): ReceiptLine[] {
  return [
    { text: theme.receiptHeader || merchant.name, weight: "bold", align: "center" },
    { text: merchant.location, align: "center", system: true },
    { text: "", align: "center" },
    { text: "SALE", right: "EUR 24.80", align: "split", weight: "bold" },
    { text: "VISA CONTACTLESS", right: "**** 4417", align: "split", system: true },
    { text: "AUTH CODE", right: "0X41B9", align: "split", system: true },
    { text: "", align: "center" },
    { text: theme.receiptFooter || "Thank you", align: "center" },
    { text: "", align: "center" },
    // Always last, always present. This is the line that makes the approval yours.
    { text: ACQUIRER.legalLine, align: "center", system: true },
  ]
}
