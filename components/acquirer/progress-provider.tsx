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
    setProgress((prev) => {
      const current = prev[merchantId]
      if (!current?.has(step)) return prev
      const next = new Set(current)
      next.delete(step)
      return { ...prev, [merchantId]: next }
    })
  }, [])

  const progressFor = useCallback(
    (merchantId: string) => progress[merchantId] ?? NO_SESSION_PROGRESS,
    [progress],
  )

  const value = useMemo(
    () => ({ progress, progressFor, markDone, clearStep }),
    [progress, progressFor, markDone, clearStep],
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
