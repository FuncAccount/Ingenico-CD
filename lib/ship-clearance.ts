/**
 * Clearance to release hardware.
 *
 * Ship is the rejoin: the one step reachable with the other lane unfinished.
 * It used to warn and allow — `shipRisk` printed a red banner and left the run
 * fully playable, which permitted a walkthrough where terminals reach a
 * merchant nobody approved. That has become a hard gate.
 *
 * Two things about this step are easy to get wrong, and both are structural
 * here rather than left to the caller:
 *
 * 1. WE DO NOT SHIP. Ingenico books the carrier, prints the labels, hands the
 *    parcels over and publishes tracking. The acquirer observes all of it. The
 *    single thing the acquirer contributes is CLEARANCE — permission for the
 *    parcels to leave — so that is the only thing modelled as a gate, and none
 *    of the four logistics tasks is dressed up as an acquirer action.
 *
 * 2. CLEARANCE IS COMPUTED, NOT CLICKED. It follows from the file: when every
 *    prior step on both lanes has passed there is nothing left to decide, so
 *    it is granted automatically. There is deliberately no "approve" button on
 *    a clean file — a control whose only correct use is to be pressed every
 *    time trains people to press it, and would let this screen take credit for
 *    a judgement the checks already made. The control therefore only ever
 *    appears in its WITHHELD state, where it has something real to say.
 */

import type { Merchant, PipelineStep } from "@/lib/acquirer-data"
import { PIPELINE, REJOIN_STEP, laneState } from "@/lib/acquirer-data"
import type { ExceptionContext } from "@/lib/artifacts"
import { blockingFinding } from "@/lib/artifacts"

/**
 * Every step that must be finished before hardware may leave: both lanes plus
 * the capture that precedes them.
 *
 * DERIVED from the lane layout — everything ahead of the rejoin — rather than
 * written out as a list of ids. A hand-kept list is the reason this gate was
 * wrong to begin with: `shipRisk` consulted `riskLane` and nothing else, so
 * the four build steps were never checked at all and a failed terminal
 * configuration could not withhold a shipment. A list also silently stops
 * covering any step added to either lane later, and an unchecked prerequisite
 * does not look like an omission — it looks like a pass.
 */
export const SHIP_PREREQUISITES: PipelineStep[] = PIPELINE.slice(
  0,
  PIPELINE.findIndex((s) => s.id === REJOIN_STEP),
)

/**
 * Why one prerequisite is holding the shipment.
 *
 * `failed` and `incomplete` are kept apart because they are different claims
 * with different remedies, and merging them would be the more damaging of the
 * two errors in both directions: an unfinished step reported as a failure
 * raises an alarm about work that is going fine, and a failure reported as
 * merely unfinished tells the acquirer to wait for something that will never
 * arrive on its own.
 */
export type ClearanceHold =
  /** Reached, ran, and produced a finding. Waiting will not resolve it. */
  | { kind: "failed"; step: PipelineStep; headline: string }
  /** Not finished yet. Nothing is wrong; it is simply not done. */
  | { kind: "incomplete"; step: PipelineStep; started: boolean }

export type ShipClearance = {
  /** Granted automatically the moment nothing is holding it. */
  granted: boolean
  /** Empty exactly when granted, so the two can never disagree. */
  holds: ClearanceHold[]
  /** What the decision was taken over — the denominator for "n of m". */
  checked: PipelineStep[]
  /**
   * True when at least one hold is a real failure, as opposed to work simply
   * being unfinished. Drives tone: a file that is merely early must not be
   * painted in the same alarm colour as one carrying a fraud finding, or the
   * colour stops meaning anything.
   */
  failing: boolean
  /**
   * Whether the parcels have ALREADY gone — Ship itself is done.
   *
   * Separate from `granted` because a gate can only govern a decision still
   * to be taken, and this one is applied to files that moved before it
   * existed. Three fixtures sit at Install with an open branding finding, and
   * telling their operator the release is "withheld" would be plainly false:
   * the terminals are on site.
   *
   * Not a fixture quirk to be tidied away, either. The branding rules are
   * evaluated live against an editable theme, so anyone can break the theme of
   * a merchant already at Go-live and reach this state at runtime. A shipment
   * that went out over a finding still open is a recall question, not a hold,
   * and it needs saying rather than rounding to either clean or blocked.
   */
  released: boolean
}

export function shipClearance(merchant: Merchant, ctx: ExceptionContext): ShipClearance {
  const holds: ClearanceHold[] = []

  for (const step of SHIP_PREREQUISITES) {
    const state = laneState(merchant, step)

    /* A finding is only counted on a step the file has actually REACHED.
       `blockingFinding` derives from artefacts, which exist for every step
       whether or not the agent has run it — so asking it about an upcoming
       step returns what that step WOULD find, and reporting that as a failure
       would convict a check that has not run. An unreached step is incomplete;
       that is the whole of what is known about it. */
    const reached = state === "done" || state === "active"
    const finding = reached ? blockingFinding(step.id, merchant, ctx) : null

    if (finding) {
      holds.push({ kind: "failed", step, headline: finding.headline })
      continue
    }
    /* Note this runs on a step that is `done`, too — done and clean is the
       only combination that clears. The previous gate's mistake was treating
       arrival at Ship as evidence about the lanes behind it. */
    if (state !== "done") {
      holds.push({ kind: "incomplete", step, started: state === "active" })
    }
  }

  const shipStep = PIPELINE.find((s) => s.id === REJOIN_STEP)!

  return {
    granted: holds.length === 0,
    holds,
    checked: SHIP_PREREQUISITES,
    failing: holds.some((h) => h.kind === "failed"),
    released: laneState(merchant, shipStep) === "done",
  }
}

/**
 * One line stating the outcome, for surfaces with no room for the full list.
 *
 * Always names the count against its denominator: "held" on its own invites
 * the reader to supply their own idea of how much is outstanding.
 */
export function clearanceLine(c: ShipClearance): string {
  if (c.granted) {
    return `Cleared automatically — all ${c.checked.length} prior steps passed.`
  }
  const failed = c.holds.filter((h) => h.kind === "failed").length
  const pending = c.holds.length - failed
  // Both figures print when both exist. Reporting only the failures would
  // imply that fixing them releases the shipment, when unfinished work would
  // still be holding it.
  const parts = [
    failed > 0 ? `${failed} failed` : null,
    pending > 0 ? `${pending} not finished` : null,
  ].filter(Boolean)
  const detail = `${parts.join(", ")} of ${c.checked.length} prior steps`
  // Past tense once the parcels have gone. "Withheld" would describe a hold
  // that is not in force on hardware already delivered.
  return c.released
    ? `Released before this was resolved — ${detail}.`
    : `Release withheld — ${detail}.`
}
