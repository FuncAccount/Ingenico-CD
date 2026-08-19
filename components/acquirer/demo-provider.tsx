"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { Merchant } from "@/lib/acquirer-data"

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
}

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

  const value = useMemo(
    () => ({ documentsArrived, supplyDocuments, resetDocuments }),
    [documentsArrived, supplyDocuments, resetDocuments],
  )

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}

export function useDemo(): DemoContextValue {
  const ctx = useContext(DemoContext)
  if (!ctx) throw new Error("useDemo must be used inside <DemoProvider>")
  return ctx
}

/**
 * The merchant AS THE APP SHOULD NOW SEE IT.
 *
 * The simulation has to change the underlying facts, not paint over them: the
 * risk model, the sign-off gate, the step badge and the chase all read
 * `documentsOutstanding` independently, so clearing it in one place and
 * special-casing the others would leave the score computed while the badge
 * still said Halted. Returning a corrected merchant means every reader gets
 * the same answer without knowing the simulation exists.
 */
export function useLiveMerchant(merchant: Merchant): Merchant {
  const { documentsArrived } = useDemo()
  return useMemo(() => {
    if (!documentsArrived[merchant.id]) return merchant
    const uw = merchant.underwriting
    if (!uw?.documentsOutstanding?.length) return merchant
    const supplied = uw.documentsOutstanding.length
    // Read off the merchant's own summary ("4 of 6 documents parsed") rather
    // than written as 6, so the sentence cannot end up claiming a total the
    // file never had.
    const total = Number(uw.documents.match(/of (\d+)/)?.[1] ?? NaN)
    return {
      ...merchant,
      underwriting: {
        ...uw,
        documents: Number.isFinite(total)
          ? `${total} of ${total} documents parsed — none outstanding`
          : "All documents parsed — none outstanding",
        documentsOutstanding: [],
        // The score appears only now, because only now is there a complete
        // file to score. It is NOT the 22 the record used to assert: the
        // ownership chain resolved to a second corporate holder, which is a
        // real risk factor, so a full file scores higher than the incomplete
        // one ever claimed to.
        riskScore: 34,
        riskBand: "Medium",
        edgeCase: undefined,
      },
      // The edge case existed BECAUSE the ownership statement was missing.
      // Leaving it would have the file citing an unknown owner it now knows.
      events: [
        ...merchant.events,
        {
          step: 2,
          actor: "Merchant",
          text: `Supplied ${supplied} outstanding document${supplied === 1 ? "" : "s"}.`,
          time: "just now",
          done: true,
        },
        {
          step: 2,
          actor: "Agent",
          text: "Full file scored: 34 / 100 (Medium). The corporate holder resolved, so the ownership edge case is closed.",
          time: "just now",
          done: true,
        },
      ],
    }
  }, [merchant, documentsArrived])
}
