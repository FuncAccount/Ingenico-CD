"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { StepId } from "@/lib/acquirer-data"
import type { DecisionKind, Decisions } from "@/lib/decisions"

interface DecisionsContextValue {
  decisions: Decisions
  /** Record a regulated decision. Stamps the time once, here, so the record
   *  cannot be re-dated by a later render. */
  record: (merchantId: string, kind: DecisionKind, step: StepId) => void
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

  const record = useCallback((merchantId: string, kind: DecisionKind, step: StepId) => {
    setDecisions((prev) => ({
      ...prev,
      [merchantId]: { kind, step, atIso: new Date().toISOString() },
    }))
  }, [])

  const value = useMemo(() => ({ decisions, record }), [decisions, record])

  return <DecisionsContext.Provider value={value}>{children}</DecisionsContext.Provider>
}

export function useDecisions(): DecisionsContextValue {
  const ctx = useContext(DecisionsContext)
  if (!ctx) {
    throw new Error("useDecisions must be used inside <DecisionsProvider>")
  }
  return ctx
}
