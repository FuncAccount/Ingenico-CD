import type { Merchant, StepId } from "@/lib/acquirer-data"
import { stepById } from "@/lib/acquirer-data"
import { artifactFor } from "@/lib/artifacts"
import type { BrandTheme } from "@/lib/branding"

/**
 * WHAT AN APPROVAL WAS GIVEN AGAINST.
 *
 * An approval is not a permanent property of a step. It is evidence about a
 * SPECIFIC artefact state: "I looked at this design, and I am content for it to
 * go to production." Change the design afterwards and the approval describes
 * something that no longer exists — but it went on rendering as a green tick,
 * and because a settled row shows no controls, the acquirer could not re-approve
 * the design they had just corrected. The gate said the work was done; the work
 * on screen was not the work that had been signed.
 *
 * So a decision records a fingerprint of its subject, and any surface reading it
 * back compares that fingerprint against what is live now. Null means nothing
 * editable underpins the decision, so it cannot go stale.
 *
 * ONE function, called by both the cockpit and the sign-off screen. Two
 * fingerprints computed in two places would differ the first time either
 * changed, and a mismatch here reads as "the design was edited" — the app would
 * accuse the user of an edit they never made.
 */

/** Steps whose approval rests on the brand design. Derived from the artefacts
 *  the step actually produces, never a hardcoded id: moving the brand studio to
 *  a different step would otherwise leave this pointing at the old one, and a
 *  basis that watches the wrong artefact is worse than none — it reports
 *  "unchanged" about something nobody is looking at. */
function writesBrand(step: StepId, merchant: Merchant): boolean {
  const def = stepById(step)
  if (!def) return false
  return def.tasks.some((_, i) => artifactFor(step, i, merchant)?.kind === "brand")
}

/**
 * The fingerprint of everything editable that this step's approval rests on.
 *
 * Only the brand design is covered today, because it is the only acquirer-
 * editable artefact that outlives the screen it is edited on. The order basket,
 * the acceptance instruction and the underwriting determination are all edited
 * in the same cockpit that gates them, where `restart()` and the step's own
 * `precondition` already hold the line. Stating that gap rather than implying a
 * generality this does not have: if any of those three ever becomes editable
 * from a second surface, it belongs here too.
 */
export function decisionBasis(
  step: StepId,
  merchant: Merchant,
  theme: BrandTheme,
): string | null {
  if (!writesBrand(step, merchant)) return null
  // Key order is fixed by the object's shape, so this is stable across renders
  // and across the two surfaces that compute it.
  return `brand:${JSON.stringify(theme)}`
}
