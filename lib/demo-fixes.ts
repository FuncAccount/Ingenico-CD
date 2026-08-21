import { PIPELINE, type Merchant } from "@/lib/acquirer-data"
import { exceptionFor } from "@/lib/exceptions"

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
