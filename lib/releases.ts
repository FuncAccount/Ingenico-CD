/**
 * What the acquirer has actually released, per task.
 *
 * This state was originally local to the handoff footer, which had two faults.
 * The small one: switching task and back discarded it, so a commit that HAD
 * been released came back looking unreleased. The larger one: the step badge
 * could not see it, and so went on reporting "Complete · 4/4 tasks" over two
 * dispatches still sitting unsent — the badge contradicting the record
 * directly beneath it, which is the same defect the halted case fixed.
 *
 * Keyed by step and task index because that is how artefacts are addressed
 * everywhere else in this app.
 */

import type { StepId } from "@/lib/acquirer-data"
import { PIPELINE, stepById } from "@/lib/acquirer-data"
import { artifactFor } from "@/lib/artifacts"
import type { Merchant } from "@/lib/acquirer-data"

export interface ReleaseRecord {
  atIso: string
  /** The exact content that left. Compared against the live artefact to notice
   *  an edit made after the release. */
  signature: string
  edited: number
  gaps: number
}

/** `${stepId}:${taskIndex}` → what was released, if anything. */
export type Releases = Record<string, ReleaseRecord>

export const releaseKey = (stepId: StepId, taskIndex: number) => `${stepId}:${taskIndex}`

/**
 * Tasks on this step whose artefact carries a handoff, i.e. that end in a
 * commit the acquirer has to make. Derived from the artefacts themselves, so a
 * new handoff cannot be added without the badge noticing it — the alternative,
 * a hand-kept list of step/task pairs, is exactly the kind of second source
 * that drifts.
 */
export function releasableTasks(stepId: StepId, merchant: Merchant): number[] {
  const step = stepById(stepId)
  const out: number[] = []
  step.tasks.forEach((_, i) => {
    const a = artifactFor(stepId, i, merchant)
    if (a && "handoff" in a && a.handoff !== undefined) out.push(i)
  })
  return out
}

/**
 * How many of this step's commits are still waiting on the acquirer.
 *
 * `completed` gates it because a task that has not run has produced nothing to
 * release: counting it would report work as outstanding before it exists, and
 * a step at rest would look permanently unfinished.
 */
export function pendingReleases(
  stepId: StepId,
  merchant: Merchant,
  completed: number,
  releases: Releases,
): number {
  return releasableTasks(stepId, merchant).filter(
    (i) => i < completed && releases[releaseKey(stepId, i)] === undefined,
  ).length
}

/** Every step that has a commit of its own, for tests and for the census. */
export function stepsWithReleases(merchant: Merchant): StepId[] {
  return PIPELINE.filter((s) => releasableTasks(s.id, merchant).length > 0).map((s) => s.id)
}
