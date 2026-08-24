import { PIPELINE, RISK_LANE, type Merchant } from "@/lib/acquirer-data"
import { exceptionFor } from "@/lib/exceptions"

/** The capture step, where the document bundle lives. Named rather than typed
 *  as `1` at the call site, because these ids do not run in lane order. */
const CAPTURE_STEP = 1

/**
 * THE MERCHANT SENDS WHAT WAS OUTSTANDING — AND NOTHING ELSE HAPPENS YET.
 *
 * This lever used to end the whole stage in one click: besides delivering the
 * documents it wrote `riskScore: 34`, wrote `riskBand: "Medium"`, cleared
 * `edgeCase`, and logged an agent line announcing "Full file scored". So one
 * simulated event settled THREE steps' work — capture's bundle, KYC's ownership
 * question, and underwriting's score — and the presenter could never show the
 * agent actually doing any of it.
 *
 * ARRIVAL IS NOT READING. A PDF landing in the portal makes the bundle
 * complete; it does not classify the file, reconcile it, resolve an ownership
 * chain or produce a score. Every one of those is the agent's work, and the
 * step's own first task ("Process the document bundle") is literally where it
 * happens. So this now writes only what the merchant's act can support, and
 * the agent has to run to do the rest — which is the thing the demo exists to
 * show.
 *
 * "RECEIVED", NOT "PARSED", for the same reason: parsing is the agent's verb,
 * and the old sentence credited the agent's work to the merchant's upload.
 *
 * The invented score was also simply WRONG. `riskAssessment` derives the score
 * from real factors and never reads this field, so on the file that shipped
 * this it computed 26 while the sign-off screen printed the hardcoded 34 —
 * two numbers for one fact, disagreeing across two screens. Leaving the field
 * unset means `recordedScore` returns null and the score comes from the one
 * place that computes it.
 */
export function withSuppliedDocuments(merchant: Merchant, arrived: boolean): Merchant {
  if (!arrived) return merchant
  const uw = merchant.underwriting
  if (!uw?.documentsOutstanding?.length) return merchant
  const supplied = uw.documentsOutstanding.length
  // Read off the merchant's own summary ("4 of 6 documents parsed") rather than
  // written as 6, so the sentence cannot claim a total the file never had.
  const total = Number(uw.documents.match(/of (\d+)/)?.[1] ?? NaN)
  return {
    ...merchant,
    underwriting: {
      ...uw,
      documents: Number.isFinite(total)
        ? `${total} of ${total} documents received — none outstanding`
        : "All documents received — none outstanding",
      documentsOutstanding: [],
    },
    /* Filed against CAPTURE, not underwriting. The old entry said step 2, which
       is Underwriting — attributing a merchant's upload to the step that scores
       it, the same conflation in miniature. */
    events: [
      ...merchant.events,
      {
        step: CAPTURE_STEP,
        actor: "Merchant",
        text: `Supplied ${supplied} outstanding document${supplied === 1 ? "" : "s"}.`,
        time: "just now",
        done: true,
      },
    ],
  }
}

/**
 * An outside provider answers the check one step is waiting on.
 *
 * Moved here from the provider with `withSuppliedDocuments`, unchanged in
 * behaviour: it advances the lane by exactly ONE step, taken from `RISK_LANE`
 * order rather than by adding to an id, because these ids run 10 → 11 → 2 and
 * arithmetic on them lands on the wrong step.
 *
 * Only `in-flight` lanes move. A `referred` lane is a human decision no
 * provider reply can overturn, and a `cleared` one has nothing left to answer.
 */
export function withDeliveredResponses(
  merchant: Merchant,
  responsesIn: Record<string, string>,
): Merchant {
  const lane = merchant.riskLane
  if (lane.verdict !== "in-flight") return merchant
  if (!responsesIn[fixKey(merchant.id, lane.at)]) return merchant

  const i = RISK_LANE.findIndex((s) => s.id === lane.at)
  const next = i >= 0 ? RISK_LANE[i + 1] : undefined
  const answered = RISK_LANE[i]?.name ?? "the provider"

  return {
    ...merchant,
    riskLane: next ? { verdict: "in-flight", at: next.id } : { verdict: "cleared" },
    /* `done: true` matters: `locatedException` scans for OPEN events, so an
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
 * Answer the UNRESOLVED CHECKS on one risk step.
 *
 * Clears a check that came back WITHOUT an answer, as against
 * `withDeliveredResponses`, which clears one still in flight. Writes the two
 * UNDERLYING FACTS rather than a "resolved" flag, because the artefacts derive
 * their rows from `identity` and `edgeCase`; a separate flag would leave two
 * sources for one fact. Deliberately does NOT move the lane.
 */
export function withResolvedChecks(
  merchant: Merchant,
  resolved: Record<string, string>,
): Merchant {
  const answered = RISK_LANE.filter((s) => resolved[fixKey(merchant.id, s.id)])
  if (answered.length === 0) return merchant

  const uw = merchant.underwriting
  if (!uw) return merchant
  // Nothing outstanding, so nothing to answer. Guarded so the lever cannot
  // manufacture a resolution for a file that never had a gap.
  if (uw.identity && !uw.edgeCase) return merchant

  return {
    ...merchant,
    underwriting: {
      ...uw,
      identity: uw.identity ?? "Verified — company number and directors confirmed against the filing",
      edgeCase: undefined,
    },
    events: [
      ...merchant.events,
      {
        step: answered[0].id,
        actor: "Agent",
        text: "Outstanding checks answered: the registry responded and the ownership question closed.",
        time: "just now",
        done: true,
      },
    ],
  }
}

/**
 * Demo transforms that restate the WORLD, so the app can re-derive its verdict.
 *
 * These live in `lib` rather than beside the provider that calls them because
 * they are pure functions over a merchant, with no React in them — and because
 * a `.tsx` file cannot be imported by the Node probes that check this logic.
 * The provider keeps the state; this keeps the rules.
 */

/** The key both the provider and the journey use to address one step's lever. */
export function fixKey(merchantId: string, stepId: number): string {
  return `${merchantId}:${stepId}`
}

/**
 * Record an OUTSIDE FIX landing on a step that failed hard.
 *
 * The widest of the three demo levers. The other two answer CHECKS; the
 * findings this clears are not checks at all — an address the carrier will not
 * run to, an invoice rejected at the border, a MID range out of allocation, a
 * brand rule in breach, a refund the terminals cannot send. No amount of
 * waiting clears any of them, so a walkthrough that reached one simply stopped.
 *
 * All of them rest on ONE OPEN EVENT each: `EXCEPTIONS` has no authored entry
 * for any, so the finding is read off the timeline. Closing that line is
 * therefore the whole fix, and it is the honest one — it says the work was
 * done, which is what happens in the real world. It is NOT an override:
 * nothing here suppresses a check or forces a verdict, it edits the record and
 * lets the app decide again.
 *
 * Only lines AT A CLEARED STEP are closed. A file can carry open lines from
 * several steps, and closing all of them would let one lever silently settle
 * findings the presenter never looked at — the same reason the other two levers
 * are keyed per step.
 */
export function withClearedFindings(
  merchant: Merchant,
  cleared: Record<string, string>,
): Merchant {
  const steps = new Set(
    PIPELINE.map((s) => s.id).filter((id) => cleared[fixKey(merchant.id, id)]),
  )
  if (steps.size === 0) return merchant

  const open = (merchant.events ?? []).filter((e) => e.done === false && steps.has(e.step))

  /* THE SECOND REGISTER. My first pass assumed every hard finding rested on an
     open event; it cleared only two of five, because the rest are authored
     entries in the `EXCEPTIONS` table, which no edit to `events` can touch.
     That table is private and keyed by merchant id, so the only reachable
     handle is `exceptionFor`'s own gate: it returns nothing once `status` is no
     longer "Exception".
  
     Safe to write, because `effectiveStatus` DERIVES the real status and a
     blocking finding outranks whatever is stored here — so if anything else on
     the file is still broken, the merchant is put straight back to "Exception"
     rather than left on this optimistic value. */
  const authored = exceptionFor(merchant)
  const clearsAuthored = authored !== null && steps.has(authored.step)

  // Nothing open and no authored entry at those steps: nothing to clear.
  // Returning the SAME OBJECT (not a copy) is what lets the probes assert no
  // leak across merchants or steps by identity.
  if (open.length === 0 && !clearsAuthored) return merchant

  return {
    ...merchant,
    ...(clearsAuthored ? { status: "On track" as const } : {}),
    events: [
      ...merchant.events.map((e) =>
        e.done === false && steps.has(e.step) ? { ...e, done: true } : e,
      ),
      ...open.map((e) => ({
        step: e.step,
        // The actor union's name for the person driving this screen. The fix
        // was theirs to arrange, so crediting the agent would attribute work
        // to the platform that happened outside it.
        actor: "Acquirer" as const,
        // Names the finding it answers. A bare "resolved" line would leave the
        // reader unable to tell which of several open items was dealt with, on
        // a file that can carry more than one.
        text: `Resolved outside the platform: ${e.text}`,
        time: "just now",
        done: true,
      })),
      // The authored exception leaves no open line of its own, so without this
      // the record would go quiet exactly where the biggest finding was — the
      // file would simply stop being an exception with nothing saying why.
      ...(clearsAuthored && authored
        ? [
            {
              step: authored.step,
              actor: "Acquirer" as const,
              text: `Resolved outside the platform: ${authored.summary}`,
              time: "just now",
              done: true,
            },
          ]
        : []),
    ],
  }
}
