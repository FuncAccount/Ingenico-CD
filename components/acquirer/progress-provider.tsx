"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { StepId } from "@/lib/acquirer-data"
import { NO_SESSION_PROGRESS } from "@/lib/acquirer-data"

/**
 * Which steps have been completed during this session, per merchant.
 *
 * WHY THIS LIVES ABOVE THE SCREEN SWITCH, like `DecisionsProvider`.
 *
 * It used to be `useState` inside `MerchantJourney`. But the screens in
 * `app/page.tsx` are conditionally rendered, so opening the full sign-off
 * screen UNMOUNTS the journey — and React discards its state. The step that
 * needed approving therefore destroyed the record of every step already
 * finished, on the way to approving it. Returning to the journey showed the
 * file back at its fixture position, and the Ship gate, reading that same
 * emptied set, went on holding a shipment whose prerequisites were all done.
 *
 * The rule this encodes: a record of completed work cannot live in a component
 * that the act of completing the work unmounts. `decisions` were already up
 * here for exactly this reason; progress is the same kind of fact and belongs
 * beside them.
 *
 * Kept as a SEPARATE provider rather than folded into decisions, because they
 * are different claims — a decision is a judgement someone took, progress is
 * work the agent ran — and one step can have either without the other.
 */
interface ProgressContextValue {
  /** Completed steps by merchant id. */
  progress: Record<string, ReadonlySet<StepId>>
  /** The set for one merchant, never undefined. */
  progressFor: (merchantId: string) => ReadonlySet<StepId>
  /**
   * Steps whose agent run has been PLAYED, whatever the run concluded.
   *
   * A SECOND SET, NOT A REUSE OF `progress`, because completion excludes
   * failure: `stepFinished` is `!blocker && …`, so a run that halts never
   * reaches `markDone`. Using progress as the evidence signal therefore
   * deadlocks — the finding cannot be raised until the step passes, and the
   * step cannot pass because of the finding.
   *
   * This is what makes "the agent has looked at this" answerable separately
   * from "the agent approved it", which is the distinction the whole
   * no-exception-without-a-run rule rests on.
   *
   * It lives in THIS provider rather than its own so that `clearStep` can
   * retire both facts in a single write. Split across two providers, a stage
   * reset could clear one and leave the other, and a step reading "not run"
   * while still carrying its finding is precisely the kind of half-reset this
   * file already exists to prevent.
   */
  played: Record<string, ReadonlySet<StepId>>
  /** The played set for one merchant, never undefined. */
  playedFor: (merchantId: string) => ReadonlySet<StepId>
  /** Stages explicitly reset by the acquirer, so the rail can stop drawing a
   *  completion tick over a panel that says nothing has run. */
  resetFor: (merchantId: string) => ReadonlySet<StepId>
  /** Record that a run was started here. Idempotent. Called when the run is
   *  PLAYED, not when it succeeds — that is the entire point. */
  markPlayed: (merchantId: string, step: StepId) => void
  /** Record a step as finished. Idempotent. */
  markDone: (merchantId: string, step: StepId) => void
  /**
   * Un-record a step, for a stage reset. Idempotent.
   *
   * The reset flag used to be a `useRef` inside the cockpit, which is BELOW the
   * rail — so the rail went on drawing the step as done, and because it was
   * also carrying a finding, it drew the amber warning marker over a stage that
   * had just been cleared. A reset that the rail cannot see is not a reset; it
   * is two surfaces disagreeing about the same step.
   */
  clearStep: (merchantId: string, step: StepId) => void
}

/**
 * No default, for the same reason decisions has none: a screen mounted outside
 * the provider would read an empty set, which does not mean "nothing is known"
 * — it renders as the confident claim that no step has been completed.
 */
const ProgressContext = createContext<ProgressContextValue | null>(null)

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [progress, setProgress] = useState<Record<string, ReadonlySet<StepId>>>({})
  const [played, setPlayed] = useState<Record<string, ReadonlySet<StepId>>>({})
  /** Stages the acquirer has explicitly reset, which is a claim the fixture's
   *  own position cannot express and the two sets above cannot retract. */
  const [reset, setReset] = useState<Record<string, ReadonlySet<StepId>>>({})

  const markPlayed = useCallback((merchantId: string, step: StepId) => {
    setPlayed((prev) => {
      const current = prev[merchantId]
      if (current?.has(step)) return prev
      const next = new Set(current ?? [])
      next.add(step)
      return { ...prev, [merchantId]: next }
    })
    /* A run RETIRES the reset. Without this the flag would be permanent: the
       stage was shown fresh once and could never report itself finished again,
       however many times the agent ran — the mirror image of the bug the reset
       was added to fix. Playing the agent is exactly the event that makes
       "never run here" false. */
    setReset((prev) => {
      const current = prev[merchantId]
      if (!current?.has(step)) return prev
      const next = new Set(current)
      next.delete(step)
      return { ...prev, [merchantId]: next }
    })
  }, [])

  const markDone = useCallback((merchantId: string, step: StepId) => {
    setProgress((prev) => {
      const current = prev[merchantId]
      // Bail before writing, so a step reporting itself finished on every
      // render cannot spin a new object each time and re-fire the memos and
      // effects that read this.
      if (current?.has(step)) return prev
      const next = new Set(current ?? [])
      next.add(step)
      // Keyed per merchant: one shared set would carry one file's progress
      // onto every other file in the book.
      return { ...prev, [merchantId]: next }
    })
  }, [])

  const clearStep = useCallback((merchantId: string, step: StepId) => {
    const drop = (prev: Record<string, ReadonlySet<StepId>>) => {
      const current = prev[merchantId]
      if (!current?.has(step)) return prev
      const next = new Set(current)
      next.delete(step)
      return { ...prev, [merchantId]: next }
    }
    setProgress(drop)
    // BOTH, always. A reset that retired the completion but left the run on
    // record would put the step back to "not finished" while still treating its
    // findings as evidenced — a cleared stage that goes on reporting a halt.
    setPlayed(drop)

    /* AND A POSITIVE RECORD THAT THIS STAGE IS BEING SHOWN FRESH.
    
       Subtracting from two sets can only retire progress made THIS SESSION. A
       step the fixture already places behind the merchant's position was never
       in either set, so both `drop`s were no-ops and the rail — which reads
       position — went on drawing a solid completion tick over a panel reading
       "Ready · 0/4 tasks · Play agent run". The cockpit knew (it holds a
       `resetSteps` ref) but nothing outside it could.
    
       So the reset is recorded rather than merely subtracted, and `laneState`
       reads this set alongside the others. */
    setReset((prev) => {
      const current = prev[merchantId]
      if (current?.has(step)) return prev
      const next = new Set(current ?? [])
      next.add(step)
      return { ...prev, [merchantId]: next }
    })
  }, [])

  const progressFor = useCallback(
    (merchantId: string) => progress[merchantId] ?? NO_SESSION_PROGRESS,
    [progress],
  )

  const playedFor = useCallback(
    (merchantId: string) => played[merchantId] ?? NO_SESSION_PROGRESS,
    [played],
  )

  const resetFor = useCallback(
    (merchantId: string) => reset[merchantId] ?? NO_SESSION_PROGRESS,
    [reset],
  )

  const value = useMemo(
    () => ({ progress, progressFor, played, playedFor, resetFor, markPlayed, markDone, clearStep }),
    [progress, progressFor, played, playedFor, resetFor, markPlayed, markDone, clearStep],
  )

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>
}

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext)
  if (!ctx) {
    throw new Error("useProgress must be used inside <ProgressProvider>")
  }
  return ctx
}
