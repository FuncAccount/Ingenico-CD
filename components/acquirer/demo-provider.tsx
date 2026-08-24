"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { type Merchant } from "@/lib/acquirer-data"
import {
  fixKey,
  withClearedFindings,
  withDeliveredResponses,
  withResolvedChecks,
  withSuppliedDocuments,
} from "@/lib/demo-fixes"

/**
 * Demo-only state: things that would happen in the real world, outside this
 * app, and which a walkthrough needs to be able to make happen on cue.
 *
 * Kept in its OWN provider rather than folded into `DecisionsProvider`, and
 * every control that writes to it is styled off-theme, because the one thing
 * worse than a demo that cannot show the happy path is a demo where the
 * audience cannot tell which parts were real. A decision an acquirer took and
 * a document a presenter conjured must never look alike.
 */
interface DemoContextValue {
  /** Merchants whose outstanding documents have been simulated as arrived. */
  documentsArrived: Record<string, string>
  /** Simulate the merchant supplying everything still outstanding. */
  supplyDocuments: (merchantId: string) => void
  /** Put the file back to incomplete, so the stop can be shown again. */
  resetDocuments: (merchantId: string) => void

  /**
   * Waits that an outside provider has been simulated as answering, keyed
   * `merchantId:stepId`.
   *
   * EVERY WAIT ON AN OUTSIDE SYSTEM NEEDS ONE OF THESE OR THE DEMO DEAD-ENDS.
   * A step showing "1 in progress" is, by construction, waiting on something
   * this app does not control — a liveness provider, a scheme, a carrier. With
   * no way to make the reply arrive, the walkthrough reaches that step and
   * simply stops: the run has happened, nothing is wrong, and there is no
   * button anywhere that advances it. The presenter is left explaining a
   * spinner.
   *
   * Keyed by step, not merchant, because a file can be waiting on two
   * providers at once (the lanes run in parallel) and answering one must not
   * silently answer the other.
   */
  responsesIn: Record<string, string>
  /** Simulate the outside system replying to one step's outstanding checks. */
  deliverResponse: (merchantId: string, stepId: number) => void
  /** Put the wait back, so the same moment can be shown again. */
  resetResponse: (merchantId: string, stepId: number) => void

  /**
   * Checks that came back UNRESOLVED and have since been answered, keyed
   * `merchantId:stepId`.
   *
   * Separate from `responsesIn` because the two clear different states, and
   * merging them would let one lever claim the other's work. `responsesIn`
   * answers a check still IN FLIGHT and moves the lane on; this answers one
   * that already returned WITHOUT a verdict and leaves the lane where it is.
   * A file can be in both states at once.
   */
  checksResolved: Record<string, string>
  /** Simulate the outstanding questions on a step being answered. */
  resolveChecks: (merchantId: string, stepId: number) => void
  /** Put the gap back, so the same stop can be shown again. */
  unresolveChecks: (merchantId: string, stepId: number) => void

  /**
   * Findings the presenter has declared FIXED IN THE REAL WORLD, keyed
   * `merchantId:stepId`.
   *
   * The third and last dead-end, and the widest. The two levers above answer
   * CHECKS; this one covers the failures no check can answer — an address the
   * carrier will not run to, a commercial invoice rejected at the border, a MID
   * range out of allocation, a brand rule in breach, a refund the terminals
   * cannot send. Every one is real work outside this app, so nothing in the app
   * can ever clear them, and a walkthrough that reaches one simply stops.
   *
   * Deliberately a SEPARATE map from `checksResolved`, and worded as the outside
   * work being done rather than as an override: the distinction between "the
   * problem was fixed" and "somebody waved it through" is the entire difference
   * between a demo and a misrepresentation. Nothing here bypasses a control —
   * it restates the world, and the app re-derives its own verdict.
   */
  findingsCleared: Record<string, string>
  /** Simulate the outside fix landing, so the step can be re-run clean. */
  clearFinding: (merchantId: string, stepId: number) => void
  /** Put the failure back, so the same stop can be shown again. */
  restoreFinding: (merchantId: string, stepId: number) => void
}

/** One key shape, defined once, so a writer and a reader cannot disagree about
 *  how a wait is addressed. Now an alias of `fixKey` rather than a second
 *  identical implementation: the transforms that READ these maps live in
 *  `lib/demo-fixes`, and two independently-maintained builders for one key are
 *  a silent miss waiting to happen. */
export const responseKey = fixKey

const DemoContext = createContext<DemoContextValue | null>(null)

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [documentsArrived, setDocumentsArrived] = useState<Record<string, string>>({})

  const supplyDocuments = useCallback((merchantId: string) => {
    setDocumentsArrived((prev) => ({ ...prev, [merchantId]: new Date().toISOString() }))
  }, [])

  const resetDocuments = useCallback((merchantId: string) => {
    setDocumentsArrived((prev) => {
      const next = { ...prev }
      delete next[merchantId]
      return next
    })
  }, [])

  const [responsesIn, setResponsesIn] = useState<Record<string, string>>({})

  const deliverResponse = useCallback((merchantId: string, stepId: number) => {
    setResponsesIn((prev) => ({
      ...prev,
      [responseKey(merchantId, stepId)]: new Date().toISOString(),
    }))
  }, [])

  const resetResponse = useCallback((merchantId: string, stepId: number) => {
    setResponsesIn((prev) => {
      const next = { ...prev }
      delete next[responseKey(merchantId, stepId)]
      return next
    })
  }, [])

  const [checksResolved, setChecksResolved] = useState<Record<string, string>>({})

  const resolveChecks = useCallback((merchantId: string, stepId: number) => {
    setChecksResolved((prev) => ({
      ...prev,
      [responseKey(merchantId, stepId)]: new Date().toISOString(),
    }))
  }, [])

  const unresolveChecks = useCallback((merchantId: string, stepId: number) => {
    setChecksResolved((prev) => {
      const next = { ...prev }
      delete next[responseKey(merchantId, stepId)]
      return next
    })
  }, [])

  const [findingsCleared, setFindingsCleared] = useState<Record<string, string>>({})

  const clearFinding = useCallback((merchantId: string, stepId: number) => {
    setFindingsCleared((prev) => ({
      ...prev,
      [responseKey(merchantId, stepId)]: new Date().toISOString(),
    }))
  }, [])

  const restoreFinding = useCallback((merchantId: string, stepId: number) => {
    setFindingsCleared((prev) => {
      const next = { ...prev }
      delete next[responseKey(merchantId, stepId)]
      return next
    })
  }, [])

  const value = useMemo(
    () => ({
      documentsArrived,
      supplyDocuments,
      resetDocuments,
      responsesIn,
      deliverResponse,
      resetResponse,
      checksResolved,
      resolveChecks,
      unresolveChecks,
      findingsCleared,
      clearFinding,
      restoreFinding,
    }),
    [
      documentsArrived,
      supplyDocuments,
      resetDocuments,
      responsesIn,
      deliverResponse,
      resetResponse,
      checksResolved,
      resolveChecks,
      unresolveChecks,
      findingsCleared,
      clearFinding,
      restoreFinding,
    ],
  )

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}

export function useDemo(): DemoContextValue {
  const ctx = useContext(DemoContext)
  if (!ctx) throw new Error("useDemo must be used inside <DemoProvider>")
  return ctx
}


export function useLiveMerchant(merchant: Merchant): Merchant {
  const { documentsArrived, responsesIn, checksResolved, findingsCleared } = useDemo()
  return useMemo(
    () =>
      withClearedFindings(
        withResolvedChecks(
          withDeliveredResponses(
            withSuppliedDocuments(merchant, Boolean(documentsArrived[merchant.id])),
            responsesIn,
          ),
          checksResolved,
        ),
        findingsCleared,
      ),
    [merchant, documentsArrived, responsesIn, checksResolved, findingsCleared],
  )
}
