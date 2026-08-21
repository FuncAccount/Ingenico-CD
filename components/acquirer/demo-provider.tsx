"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { RISK_LANE, type Merchant } from "@/lib/acquirer-data"
import { withClearedFindings } from "@/lib/demo-fixes"

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

/** One key shape, defined once, so a writer and a reader cannot disagree
 *  about how a wait is addressed. */
export const responseKey = (merchantId: string, stepId: number) => `${merchantId}:${stepId}`

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
function withSuppliedDocuments(merchant: Merchant, arrived: boolean): Merchant {
    if (!arrived) return merchant
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
}

/**
 * Apply any outside replies the presenter has simulated.
 *
 * The wait this app actually models is expressed through `riskLane`:
 * `livenessOpen` is precisely "the lane is in flight and sitting on KYC", so
 * the selfie coming back is not a cosmetic flag but the lane moving on. Writing
 * it as a separate "check returned" boolean would leave two sources for one
 * fact, and the lane — which the rail, the badge and the gate all read — would
 * go on reporting the wait.
 *
 * The lane advances to the NEXT risk step, taken from `RISK_LANE` order rather
 * than by adding one to an id, because these ids run 10 → 11 → 2 and arithmetic
 * on them lands on the wrong step. If the answered step was the last on the
 * lane, the lane is cleared.
 *
 * Only `in-flight` lanes move. A `referred` lane is a human decision that no
 * provider reply can overturn, and a `cleared` one has nothing left to answer.
 */
function withDeliveredResponses(merchant: Merchant, responsesIn: Record<string, string>): Merchant {
  const lane = merchant.riskLane
  if (lane.verdict !== "in-flight") return merchant
  if (!responsesIn[responseKey(merchant.id, lane.at)]) return merchant

  const i = RISK_LANE.findIndex((s) => s.id === lane.at)
  const next = i >= 0 ? RISK_LANE[i + 1] : undefined
  const answered = RISK_LANE[i]?.name ?? "the provider"

  return {
    ...merchant,
    riskLane: next ? { verdict: "in-flight", at: next.id } : { verdict: "cleared" },
    /* Written for the same reason `withSuppliedDocuments` writes its two: the
       record of the file should say what happened to it. NOTE the journey
       screen builds its trace from artefacts and renders `events` nowhere, so
       this is currently only visible to `lib/exceptions` and the Ingenico-side
       journey — it is a record, not the user-facing confirmation. What the
       acquirer actually sees is the wait clearing and the lever flipping to
       "Undo simulated reply", which is why that flip has to be unmistakable.
  
       `done: true` matters: `locatedException` scans for OPEN events, so an
       unfinished line here would register this reply as a new finding. */
    events: [
      ...merchant.events,
      {
        step: lane.at,
        actor: "Agent",
        text: `${answered} check returned from the provider. The lane moves on.`,
        time: "just now",
        done: true,
      },
    ],
  }
}

/**
 * Answer the UNRESOLVED CHECKS on the risk lane.
 *
 * The second half of the same dead-end `withDeliveredResponses` fixes. That one
 * clears a check still IN FLIGHT; this clears one that came back WITHOUT an
 * answer — a registry that never responded, an ownership question the agent
 * could not close. Both leave the acquirer with a step they cannot settle and,
 * until now, only the first had a lever. The screenshot that prompted this had
 * KYC reading "2 unresolved" with no control anywhere on the page.
 *
 * It writes the two UNDERLYING FACTS rather than a "resolved" flag, exactly as
 * `withSuppliedDocuments` does, because `10.0` and `10.3` derive their rows
 * from `underwriting.identity` and `underwriting.edgeCase`. A separate flag
 * would leave two sources for one fact and the panels would go on reporting the
 * gap.
 *
 * Keyed by step so answering KYC does not silently answer Underwriting — the
 * same reason `responsesIn` is keyed that way.
 */
function withResolvedChecks(merchant: Merchant, resolved: Record<string, string>): Merchant {
  // RISK_LANE, not "the KYC id": these are the steps whose artefacts read the
  // two fields below, and naming the lane keeps this true if a step is added.
  const answered = RISK_LANE.filter((s) => resolved[responseKey(merchant.id, s.id)])
  if (answered.length === 0) return merchant

  const uw = merchant.underwriting
  if (!uw) return merchant
  // Nothing outstanding on this file, so there is nothing to answer. Guarded so
  // the lever cannot manufacture a resolution for a merchant that never had a
  // gap — which would show a "now confirmed" line under checks that always
  // passed.
  if (uw.identity && !uw.edgeCase) return merchant

  return {
    ...merchant,
    underwriting: {
      ...uw,
      // Names the source, like every other value on this panel, so the answer
      // can be re-read rather than taken on trust.
      identity: uw.identity ?? "Verified — company number and directors confirmed against the filing",
      // The ownership question is CLOSED, not restated more softly: leaving the
      // sentence in place would keep both the media scan and the ownership row
      // amber while claiming the check had been answered.
      edgeCase: undefined,
    },
    events: [
      ...merchant.events,
      {
        step: answered[0].id,
        actor: "Agent",
        text: "Outstanding checks answered: the registry responded and the ownership question closed.",
        time: "just now",
        // `locatedException` scans for OPEN events, so an unfinished line here
        // would register this answer as a fresh finding.
        done: true,
      },
    ],
  }
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
