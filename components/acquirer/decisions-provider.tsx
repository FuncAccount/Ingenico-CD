"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { StepId } from "@/lib/acquirer-data"
import { decisionKey, type DecisionKind, type Decisions } from "@/lib/decisions"

interface DecisionsContextValue {
  decisions: Decisions
  /** Record a regulated decision. Stamps the time once, here, so the record
   *  cannot be re-dated by a later render.
   *
   *  `basis` is a required argument, not an optional one — see `Decision.basis`.
   *  A surface that cannot say what it was looking at passes `null` explicitly,
   *  which is a claim ("nothing editable underpins this") rather than an
   *  omission. */
  record: (
    merchantId: string,
    kind: DecisionKind,
    step: StepId,
    basis: string | null,
  ) => void
  /**
   * Erase the decision at a gate, as though it had never been taken.
   *
   * ONLY for resetting a stage, which is a claim about the VIEW — "show me this
   * running for the first time". Everything else that invalidates a decision
   * should supersede it instead, so the record survives.
   */
  withdraw: (merchantId: string, step: StepId) => void
  /**
   * Compare every gate's recorded basis against what is live now, and supersede
   * the ones whose subject has moved.
   *
   * Takes the whole map in one call rather than one step at a time: this runs
   * from an effect on every theme change, and nine separate setState calls to
   * write at most one supersession is nine chances to loop. Returns the previous
   * object identity untouched when nothing has moved, which is what stops the
   * effect re-firing on its own output.
   */
  reconcile: (merchantId: string, liveBasisByStep: Map<StepId, string | null>) => void
}

/**
 * No default value. A default would let a screen mount outside the provider and
 * silently read an empty decision set — which renders as "nothing has been
 * signed off yet", the precise false statement this whole module exists to
 * prevent. Failing loudly is better than a confident wrong answer.
 */
const DecisionsContext = createContext<DecisionsContextValue | null>(null)

export function DecisionsProvider({ children }: { children: React.ReactNode }) {
  const [decisions, setDecisions] = useState<Decisions>({})

  const record = useCallback(
    (merchantId: string, kind: DecisionKind, step: StepId, basis: string | null) => {
      setDecisions((prev) => ({
        ...prev,
        // Composite key. Writing to `[merchantId]` made each new decision
        // destroy the previous one, so approving a second gate silently
        // un-approved the first.
        //
        // No `supersededIso` — recording is what CLEARS a supersession. Taking
        // the decision again against the corrected artefact is precisely the
        // act the superseded record was asking for, so the new one must
        // overwrite it wholesale rather than merge into it and inherit the mark.
        [decisionKey(merchantId, step)]: {
          kind,
          step,
          basis,
          atIso: new Date().toISOString(),
        },
      }))
    },
    [],
  )

  const withdraw = useCallback((merchantId: string, step: StepId) => {
    setDecisions((prev) => {
      const key = decisionKey(merchantId, step)
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const reconcile = useCallback(
    (merchantId: string, liveBasisByStep: Map<StepId, string | null>) => {
      setDecisions((prev) => {
        let next: Decisions | null = null
        for (const [step, live] of liveBasisByStep) {
          const key = decisionKey(merchantId, step)
          const d = prev[key]
          // Nothing recorded, already superseded, or nothing editable underpins
          // it — in none of those cases is there a claim that can go stale.
          if (!d || d.supersededIso || d.basis === null) continue
          if (d.basis === live) continue
          next ??= { ...prev }
          next[key] = { ...d, supersededIso: new Date().toISOString() }
        }
        // Identity preserved when nothing moved, so the effect that calls this
        // does not retrigger itself.
        return next ?? prev
      })
    },
    [],
  )

  const value = useMemo(
    () => ({ decisions, record, withdraw, reconcile }),
    [decisions, record, withdraw, reconcile],
  )

  return <DecisionsContext.Provider value={value}>{children}</DecisionsContext.Provider>
}

export function useDecisions(): DecisionsContextValue {
  const ctx = useContext(DecisionsContext)
  if (!ctx) {
    throw new Error("useDecisions must be used inside <DecisionsProvider>")
  }
  return ctx
}
