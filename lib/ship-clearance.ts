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
 * 2. CLEARANCE IS COMPUTED. THE RELEASE IS CLICKED. These are two different
 *    things and this file used to collapse them into one.
 *
 *    Clearance is eligibility, and it genuinely follows from the file: when
 *    every prior step on both lanes has passed, nothing is blocking, and no
 *    button should ask a human to restate what the checks already determined.
 *    That much of the original reasoning stands and is unchanged below.
 *
 *    What it got wrong was concluding that therefore nothing is left to do.
 *    The checks decide whether the parcels MAY go. They cannot decide that the
 *    parcels DO go, or when — that is a commit, not a judgement, and it spends
 *    money and puts hardware on a van. So the old objection ("a control whose
 *    only correct use is to be pressed every time trains people to press it")
 *    is right about an APPROVAL and wrong about a RELEASE: being pressed every
 *    time is what a release IS, the same way Send is pressed on every mail
 *    that has already been read back. Nothing is rubber-stamped, because the
 *    judgement is not the thing being asked for.
 *
 *    The tell was in the step's own data. `acquirerRole` on Ship has read
 *    "releases" all along — a role naming an act nobody performed, while the
 *    screen said "clearance was granted automatically, there was nothing left
 *    to decide" over four logistics tasks that had already run and ten parcels
 *    already in transit. Same defect as a status tag asserting a check that
 *    never ran, one level up: the app claimed an acquirer decision as the
 *    reason hardware moved, and no acquirer had made one.
 *
 *    So: clearance stays derived and is the PRECONDITION. The release is an
 *    act with a time on it, and it GATES the four logistics tasks — until it
 *    is given, Ingenico does not book the carrier. A release button that did
 *    not hold the run back would be decoration, which is the failure mode this
 *    replaces, not a second copy of it.
 */

import type { Merchant, PipelineStep, StepId } from "@/lib/acquirer-data"
import { PIPELINE, REJOIN_STEP, laneState } from "@/lib/acquirer-data"
import type { ExceptionContext } from "@/lib/artifacts"
import { blockingFinding, openSteps } from "@/lib/artifacts"

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

/**
 * The acquirer's own commit: permission for this estate to leave.
 *
 * Stamped ONCE, when the button is pressed, never formatted from `new Date()`
 * at render — a release re-clocked on every paint would report an old decision
 * with today's time.
 *
 * There is no `by`. This app has no signed-in identity, and inventing a name
 * on a record of who authorised a shipment would be the worst possible field
 * to fabricate. `step-gate` already sets the precedent with "no approver on
 * record" where attribution is genuinely absent.
 */
export interface ShipRelease {
  atIso: string
}

/** merchantId → the release, if one has been given this session. */
export type ShipReleases = Record<string, ShipRelease>

/**
 * Where the shipment stands with respect to the acquirer's commit.
 *
 * Four states, and the two easy to merge are `given` and `onFile`. A file the
 * fixture placed at Install shipped before this gate existed: it is released,
 * but nobody here released it, and printing a timestamp for it would invent a
 * decision. `blocked` and `awaiting` are equally distinct — one is "not yours
 * yet", the other is "yours now, and nothing else is in the way" — and they
 * carry opposite instructions to the reader.
 */
export type ShipReleaseState =
  /** Prerequisites are holding it. There is nothing to release yet. */
  | { kind: "blocked" }
  /** Cleared, nothing shipped, waiting on the acquirer. The button lives here. */
  | { kind: "awaiting" }
  /** Released here, this session, at a known time. */
  | { kind: "given"; atIso: string }
  /** Already gone before this session. Released, but no record of by whom. */
  | { kind: "onFile" }

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
  /**
   * The acquirer's commit, which is a DIFFERENT question from `released`.
   *
   * `released` asks whether the parcels have gone. This asks whether anyone
   * authorised them to. They came apart the moment the button existed: a
   * cleared file with nothing shipped and no release given is the state the
   * old model had no way to express, and so ran straight through.
   */
  release: ShipReleaseState
}

export function shipClearance(
  merchant: Merchant,
  ctx: ExceptionContext,
  /**
   * Steps completed during this session.
   *
   * This gate runs on the live journey, beside a rail that passes its own
   * progress. The argument was missing here, `laneState` filled the gap from
   * its default, and the two then read one file from different evidence: every
   * step ticked on the rail while this panel still called B2 "in progress" and
   * held the shipment. A gate answering from staler facts than the screen
   * around it is worse than no gate, because it looks authoritative.
   *
   * `laneState` no longer defaults the argument, so that omission is a compile
   * error now rather than a wrong answer. Surfaces with genuinely no session —
   * the estate rollups, the portfolio table — pass `NO_SESSION_PROGRESS`.
   */
  progressed: ReadonlySet<StepId>,
  /**
   * Steps whose agent run has been played this session.
   *
   * Separate from `progressed` because a run that halts never completes, so the
   * two sets diverge exactly on the files this gate exists to stop. REQUIRED,
   * like `progressed`, so a forgotten call site is a compile error rather than
   * a confident wrong answer.
   */
  played: ReadonlySet<StepId>,
  /**
   * Stages the acquirer has explicitly reset to be shown fresh.
   *
   * The safety-critical case for this gate: a reset stage is being presented as
   * never run, so treating it as done would clear a shipment against a build
   * step the screen itself says has not happened. REQUIRED, like the two above,
   * for the reason this file has now learned three times — a defaulted empty
   * set is a confident claim that nothing was reset.
   */
  wasReset: ReadonlySet<StepId>,
  /**
   * The acquirer's release for THIS merchant, if given.
   *
   * REQUIRED, for the fourth time in this signature and the same reason: a
   * defaulted `undefined` is a confident claim that nobody released anything,
   * and here that claim would hold a shipment on a surface that simply forgot
   * to pass the record.
   */
  releaseRecord: ShipRelease | undefined,
): ShipClearance {
  const holds: ClearanceHold[] = []

  /* This gate CAN evaluate findings — it already holds `ctx` — so it passes the
     real set and never `NO_HALTS`. It is also the safety-critical caller: a
     halted build step reading "done" here would clear parcels for a terminal
     whose theme was never approved.
  
     It already caught that case, because the loop below asks `blockingFinding`
     per step on its own account. Passing the set makes the two agree on the
     same evidence rather than reaching the same answer twice by different
     routes — and, more importantly, propagates the halt to the step's
     SUCCESSORS, which this loop had no way to do. */
  /* `openSteps`, NOT `haltedSteps` — the set the rail beside this panel uses.
  
     Nordwind Apotheke had KYC waiting on an unanswered check, so the rail drew
     Pricing and Underwriting as unreached, while this gate two inches to the
     right read "all 8 prior steps across both lanes have passed, there was
     nothing left to decide" and cleared the parcels. Ten of twenty-nine files
     released that way.
  
     Neither surface was computing anything wrong. They were answering ONE
     QUESTION FROM DIFFERENT EVIDENCE: a halt is a finding, but an unanswered
     check is equally a reason the step is not finished, and the narrower set
     let this gate treat "we never heard back" as a pass. An unresolved check
     lands as an `incomplete` hold rather than a `failed` one, which is the
     honest reading — nothing was found against the merchant, the work simply
     is not done. */
  const halted = openSteps(merchant, ctx, played)

  /* A SECOND, NARROWER SET (findings only) was derived here and handed to
     `laneState` as the ordering half of the judgement, on the argument that an
     unanswered check should not report the steps behind it as unreached. It is
     gone: `laneState` now asks one question of one set, and this gate reads
     `halted` above for both roles.
  
     Keep the hazard it was written against in view, because it is real — an
     unanswered check on R1 does hold the whole lane, and this gate must not
     then describe a stage as unreached in wording that implies nobody worked
     on it. That is a job for the HOLD'S SENTENCE, which names the step and the
     reason, and not for a second set quietly disagreeing with the rail about
     what "done" means. The disagreement was the expensive part: a gate reading
     one set beside a rail reading another produced a release decision no
     reader could reconstruct from the screen. */

  for (const step of SHIP_PREREQUISITES) {
    const state = laneState(merchant, step, progressed, halted, wasReset)

    /* A finding is only counted on a step the file has actually REACHED.
       `blockingFinding` derives from artefacts, which exist for every step
       whether or not the agent has run it — so asking it about an upcoming
       step returns what that step WOULD find, and reporting that as a failure
       would convict a check that has not run. An unreached step is incomplete;
       that is the whole of what is known about it.

       `blockingFinding` now enforces the same principle itself, and more
       strictly — it withholds derived findings from any step the agent has not
       run, including the REACHED one the file is currently standing on, which
       this guard never covered. Kept anyway: the two rules are about different
       things (this one about arrival, that one about evidence) and the local
       one is what makes the `holds` list below read correctly. */
    const reached = state === "done" || state === "active"
    const finding = reached ? blockingFinding(step.id, merchant, ctx, played) : null

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

  /* THE STEP THE GATE GOVERNS IS ALSO A STEP THAT CAN FAIL.
  
     `SHIP_PREREQUISITES` is every step BEFORE the rejoin, so the loop above
     asks about the eight steps behind Ship and never about Ship itself. That
     left the one question this gate exists to answer unasked: Glasswing sat
     flagged as an exception with its own timeline recording "Second shipment
     held in transit — commercial invoice rejected at the border", and the panel
     directly above it read "Cleared to release — all 8 prior steps have passed,
     there was nothing left to decide." Both statements were true of what they
     measured. Neither was true of the shipment.
  
     A hold here is materially different from the ones above: those say the file
     has not EARNED release yet, this says the release itself has run into
     trouble. It is still a `failed` hold, because the consequence is identical
     — parcels do not move — and inventing a third `kind` would fragment the
     rendering for a distinction the reader does not have to act on.
  
     NOT added to `checked`. That array is the denominator behind "all N prior
     steps passed", and Ship is not one of its own prior steps; counting it
     would make a true sentence report 9 where 8 is the honest figure. */
  const shipFinding = blockingFinding(shipStep.id, merchant, ctx, played)
  if (shipFinding) {
    holds.push({ kind: "failed", step: shipStep, headline: shipFinding.headline })
  }

  // Also progress-aware: a Ship completed in this session has released its
  // parcels just as surely as one the fixture placed at Install, and reading
  // only the fixture would keep offering to withhold a dispatch that has
  // already gone.
  const gone = laneState(merchant, shipStep, progressed, halted, wasReset) === "done"
  const granted = holds.length === 0

  /* ORDER MATTERS: the session record is consulted BEFORE `gone`.
  
     Press release, then play the run, and both are true — but only one of them
     knows when the decision was taken. Reading `gone` first would downgrade a
     release we timestamped ourselves into "no record of by whom", throwing away
     the very evidence the button exists to create. */
  const release: ShipReleaseState = releaseRecord
    ? { kind: "given", atIso: releaseRecord.atIso }
    : gone
      ? { kind: "onFile" }
      : granted
        ? { kind: "awaiting" }
        : { kind: "blocked" }

  return {
    granted,
    holds,
    checked: SHIP_PREREQUISITES,
    failing: holds.some((h) => h.kind === "failed"),
    released: gone,
    release,
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
  /* THE SHIPMENT'S OWN TROUBLE IS NOT ONE OF THE PRIOR STEPS.
  
     `checked` is the eight steps behind the rejoin, so every count quoted
     against it has to exclude the hold Ship raises on itself — otherwise the
     line reads "1 failed of 8 prior steps" while all eight of those steps
     passed, which is the same defect as the panel it replaces: a true-sounding
     sentence measured against the wrong population. Glasswing produced exactly
     that on the first pass of this fix. */
  const own = c.holds.filter((h) => h.step.id === REJOIN_STEP)
  const prior = c.holds.filter((h) => h.step.id !== REJOIN_STEP)

  const failed = prior.filter((h) => h.kind === "failed").length
  const pending = prior.length - failed
  // Both figures print when both exist. Reporting only the failures would
  // imply that fixing them releases the shipment, when unfinished work would
  // still be holding it.
  const parts = [
    failed > 0 ? `${failed} failed` : null,
    pending > 0 ? `${pending} not finished` : null,
  ].filter(Boolean)

  const clauses = [
    parts.length ? `${parts.join(", ")} of ${c.checked.length} prior steps` : null,
    // Stated in words, not counted. There is only ever one shipment step, so a
    // figure here would be a denominator of one pretending to be a measurement.
    own.length ? `the shipment itself is stopped` : null,
  ].filter(Boolean)
  const detail = clauses.join(", and ")
  // Past tense once the parcels have gone. "Withheld" would describe a hold
  // that is not in force on hardware already delivered.
  return c.released
    ? `Released before this was resolved — ${detail}.`
    : `Release withheld — ${detail}.`
}
