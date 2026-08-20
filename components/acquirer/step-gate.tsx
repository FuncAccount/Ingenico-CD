"use client"

import { useState } from "react"
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Inbox,
  AlertTriangle,
  Mail,
  Send,
  ShieldCheck,
  Store,
} from "lucide-react"
import type { Merchant, StepId } from "@/lib/acquirer-data"
import { physicalUnits } from "@/lib/artifacts"
import { decisionAtStep, liveDecisionAtStep, type Decision } from "@/lib/decisions"
import { useDecisions } from "@/components/acquirer/decisions-provider"
import {
  type AcquirerDecisionState,
  type Handoff,
  type HandoffState,
  type IngenicoWaitState,
  type MerchantChaseState,
  addWorkingDays,
  blockingIndex,
  settledState,
  draftEmail,
  handoffsForMerchant,
  fmtDate,
  fmtDateTime,
  handoffKey,
  initialState,
  isResolved,
  workingDaysBetween,
} from "@/lib/handoffs"
import { DemoInbound } from "@/components/acquirer/demo-control"
import { useDemo } from "@/components/acquirer/demo-provider"
import { outstandingDocuments } from "@/lib/underwriting"
import { cn } from "@/lib/utils"

const PARTY_META = {
  acquirer: { label: "You", Icon: ShieldCheck, tone: "text-primary" },
  ingenico: { label: "Ingenico", Icon: Building2, tone: "text-foreground" },
  merchant: { label: "Merchant", Icon: Store, tone: "text-warning-foreground" },
} as const

/**
 * The status badge on a handoff row.
 *
 * One place, because the three parties' labels have to stay mutually
 * consistent. Two claims used to be wrong here:
 *
 *  - An acquirer handoff said **"your decision"**, which names the OWNER of a
 *    row rather than its STATE — the one thing a status badge is for. Every
 *    other badge here reports state ("in progress"), and the row already says
 *    "· YOU" in its own header, so the badge was spending the only status slot
 *    restating the party. It now reads **"pending action"**.
 *
 *    This was also the case the previous fix missed: it keyed "blocked" on
 *    `!active`, but an ACTIVE row can sit behind an unmet precondition too
 *    (Underwrite, where a screening escalation must be recorded first). That
 *    row showed "your decision" over a disabled button — putting the ball in
 *    the reader's court while refusing the click.
 *  - A request that had gone out and not come back showed nothing at all, so
 *    "asked, waiting" looked identical to "not asked yet". That is now an
 *    explicit amber **"in progress"** — and it is gated on the request
 *    actually having been sent, so it reports work that is genuinely under
 *    way rather than work that is merely possible.
 */
function statusBadge(
  handoff: Handoff,
  state: HandoffState,
  done: boolean,
  active: boolean,
  runComplete: boolean,
): { label: string; className: string } | null {
  // A settled row already carries a green tick and its settlement line.
  if (done) return null

  if (handoff.party === "acquirer") {
    // "queued", not the old "pending actions": one letter apart from the
    // active label is not a distinction anyone can read, and these two can
    // appear in the same list. A later acquirer row is waiting its turn
    // behind another party, which "queued" says and "pending" does not.
    return active
      ? { label: "pending action", className: "bg-primary/12 text-primary" }
      : { label: "queued", className: "bg-secondary text-muted-foreground" }
  }

  // An Ingenico request is raised BY the agent run, not by a click, so its
  // `requestedIso` is only written when someone chases or simulates a reply.
  // Gating the badge on that field alone made the row contradict itself: the
  // body showed a running SLA clock ("Due 20 Aug · 1 working day") while the
  // badge said nothing, so an active request looked unstarted.
  //
  // The run completing IS the request going out — but `active` DOES NOT CARRY
  // THAT. `active` is `i === blocking`, i.e. "this row is at the front of the
  // queue", which is true from the moment the step opens. So on an unplayed
  // step the badge read "in progress" at 0/4 tasks, directly above its own
  // body text saying the request goes out "once the agent run finishes" —
  // claiming a team was working on something nobody had asked them for.
  // `runComplete` is the fact the badge actually needed.
  const sent =
    handoff.party === "ingenico"
      ? (active && runComplete) || (state as IngenicoWaitState).requestedIso !== null
      : (state as MerchantChaseState).sentIso !== null

  // Not yet asked is not "in progress" — nobody is working on it.
  if (!sent) return null
  return { label: "in progress", className: "bg-warning/15 text-warning-foreground" }
}

interface Props {
  step: StepId
  merchant: Merchant
  /** The agent's own run has to finish before any handoff can be worked. */
  runComplete: boolean
  states: Record<string, HandoffState>
  onStates: React.Dispatch<React.SetStateAction<Record<string, HandoffState>>>
  /** A named, step-specific reason the acquirer's own decision cannot be taken
   *  yet — an unresolved escalation, a failing brand check. Null means ready. */
  precondition?: string | null
  /** The stage was reset by hand, so it is being driven live rather than read
   *  back as history — see `isPast` below. */
  wasReset?: boolean
  /** A fingerprint of what an approval taken here would be about, stored on the
   *  decision so a later edit to the same artefact can supersede it. */
  basis: string | null
}

export function StepGate({
  step,
  merchant,
  runComplete,
  states,
  onStates,
  precondition = null,
  wasReset = false,
  basis,
}: Props) {
  // Keyed by step AND by what was ordered: steps 7 and 8 otherwise promise a
  // consignment and a boxed terminal to a merchant who bought only software.
  // ...and narrowed to what THIS merchant still owes, so a chase asks for the
  // two documents actually missing rather than re-requesting the four already
  // parsed.
  const list = handoffsForMerchant(step, merchant, physicalUnits(merchant).length === 0)

  // A step the journey has already passed is settled by fact, so its handoffs
  // default to done. Without this, completed history renders as an outstanding
  // request and offers to chase a merchant who responded weeks ago.
  //
  // Unless the stage was reset by hand. This fallback ignores `states`
  // entirely, so clearing the handoff map left a reset stage still reporting
  // "Step clear · Returned by Ingenico" — the reset silently did nothing to
  // the one panel it was aimed at. Reset means "show me this running for the
  // first time", which is a claim about the VIEW, not about the merchant's
  // real position, so only this default flips: `merchant.currentStep` is
  // untouched and the pipeline rail still shows the step as passed.
  const isPast = step < merchant.currentStep && !wasReset

  // The acquirer's own decision is held in the shared record, not in this
  // component's handoff state — otherwise signing off here and signing off on
  // the sign-off screen are two unrelated events, and each surface goes on
  // saying the other one's decision has not been taken.
  const { decisions, record } = useDecisions()
  // TWO READS OF THE SAME RECORD, on purpose.
  //
  // `decision` is what STILL STANDS, and everything that gates behaves as
  // though a superseded approval had never been given — which is what reopens
  // the row so the corrected design can be approved. `superseded` is the
  // history, and this panel is the one place entitled to read it, because it is
  // the one place that can explain what happened. Without the explanation the
  // approval would simply vanish, and a tick that disappears on its own reads
  // as the app losing the decision rather than withdrawing it.
  const decision = liveDecisionAtStep(decisions, merchant.id, step)
  const superseded = decisionAtStep(decisions, merchant.id, step)?.supersededIso
    ? decisionAtStep(decisions, merchant.id, step)
    : null

  function read(i: number): HandoffState {
    if (list[i].party === "acquirer" && decision?.kind === "signed") {
      return { approvedIso: decision.atIso }
    }
    return (
      states[handoffKey(merchant.id, step, i)] ??
      (isPast ? settledState(list[i]) : initialState(list[i]))
    )
  }

  // Must resolve through the same rules as `read`, or the panel shows a handoff
  // as approved while still naming it as the thing blocking the step.
  //
  // Signing the acquirer's row clears THAT ROW, not the step. This used to
  // collapse straight to `null`, which was safe only while the acquirer's
  // decision was always the LAST handoff — as soon as Order was reordered to
  // put the order desk after it, placing the order reported "Step clear" over
  // an Ingenico confirmation nobody had asked for yet. So advance to the next
  // unsettled row instead, and only call the step clear when none remains.
  const rawBlocking = isPast ? null : blockingIndex(step, merchant.id, states)
  const signedAcquirerRow =
    rawBlocking !== null &&
    list[rawBlocking].party === "acquirer" &&
    decision?.kind === "signed"
  const nextAfterSigned = signedAcquirerRow
    ? list.findIndex((h, i) => i > (rawBlocking as number) && !isResolved(h, read(i)))
    : -1
  const blocking = signedAcquirerRow
    ? nextAfterSigned === -1
      ? null
      : nextAfterSigned
    : rawBlocking

  function write(i: number, next: HandoffState) {
    onStates((prev) => ({ ...prev, [handoffKey(merchant.id, step, i)]: next }))
  }

  // Step 9 passes no work to another party. Saying so is better than an empty
  // panel, which reads as a section that failed.
  //
  // A HANDOFF AND A RELEASE ARE NOT THE SAME ABSENCE. A handoff is work given
  // to someone else; a release is work still sitting with the reader. This
  // panel used to end "there is nothing to approve and nobody to chase",
  // which was true of the first and false of the second — and it rendered
  // directly beneath a live "Send the notice" button. Behind a green tick, it
  // told the reader the step wanted nothing from them while two commits were
  // waiting. The claim is now confined to the thing this panel actually
  // measures: who else is involved.
  if (list.length === 0) {
    return (
      <Frame>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div>
            <p className="text-sm font-medium text-foreground">No handoff on this step</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The merchant simply trades. The first live payment reconciles itself to your
              ledger, so nobody else has anything to do here and there is nobody to chase.
              Anything still open is yours to release, above.
            </p>
          </div>
        </div>
      </Frame>
    )
  }

  return (
    <Frame>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Handoffs
        </h4>
        {blocking === null ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[10px] font-medium text-success">
            <CheckCircle2 className="h-3 w-3" />
            Step clear
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            {/* The same claim the badge was making, one level up: naming the
                next party before the run has finished says they are sitting on
                something, when the only outstanding thing is the run itself —
                which is yours. Name that instead, so the rail points at the
                one control that can actually move the step. */}
            {runComplete
              ? `waiting on ${PARTY_META[list[blocking].party].label.toLowerCase()}`
              : "waiting on the agent run"}
          </span>
        )}
      </div>

      <ol className="space-y-2">
        {list.map((h, i) => {
          const state = read(i)
          const done = isResolved(h, state)
          const active = i === blocking
          return (
            <li key={i}>
              <HandoffRow
                handoff={h}
                state={state}
                done={done}
                active={active}
                index={i}
                total={list.length}
                merchant={merchant}
                runComplete={runComplete}
                precondition={precondition}
                onChange={(next) => write(i, next)}
                superseded={superseded}
                onApprove={() => record(merchant.id, "signed", step, basis)}
              />
            </li>
          )
        })}
      </ol>
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-border p-4">{children}</div>
}

function HandoffRow({
  handoff,
  state,
  done,
  active,
  index,
  total,
  merchant,
  runComplete,
  precondition,
  superseded,
  onChange,
  onApprove,
}: {
  handoff: Handoff
  state: HandoffState
  done: boolean
  active: boolean
  index: number
  total: number
  merchant: Merchant
  runComplete: boolean
  precondition: string | null
  /** A previous approval at this gate that no longer stands, or null. */
  superseded: Decision | null
  onChange: (next: HandoffState) => void
  onApprove: () => void
}) {
  const meta = PARTY_META[handoff.party]
  const { Icon } = meta
  const badge = statusBadge(handoff, state, done, active, runComplete)

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        done && "border-success/30 bg-success/[0.05]",
        active && !done && "border-primary/35 bg-primary/[0.05]",
        !active && !done && "border-border/70 bg-secondary/30",
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            done ? "bg-success/15 text-success" : "bg-background/80 " + meta.tone,
          )}
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {total > 1 ? `${index + 1} of ${total} · ` : ""}
              {meta.label}
            </span>
            {badge && (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                  badge.className,
                )}
              >
                {badge.label}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm leading-snug text-foreground">{handoff.ask}</p>

          {/* Only the blocking handoff gets controls. An earlier one is
              settled; a later one is not yet reachable, and showing its
              button would offer an action that cannot legitimately be taken. */}
          {active && !done && (
            <div className="mt-3">
              {handoff.party === "acquirer" && (
                <AcquirerPanel
                  handoff={handoff}
                  runComplete={runComplete}
                  precondition={precondition}
                  superseded={superseded}
                  // Writes to the shared record, not to this component's local
                  // handoff state, so the nav badge, the portfolio KPI and the
                  // sign-off queue all move with it.
                  onApprove={onApprove}
                />
              )}
              {handoff.party === "ingenico" && (
                <IngenicoPanel
                  handoff={handoff}
                  state={state as IngenicoWaitState}
                  runComplete={runComplete}
                  onChange={onChange}
                />
              )}
              {handoff.party === "merchant" && (
                <MerchantPanel
                  handoff={handoff}
                  state={state as MerchantChaseState}
                  merchant={merchant}
                  runComplete={runComplete}
                  onChange={onChange}
                />
              )}
            </div>
          )}

          {done && <Settled handoff={handoff} state={state} />}
        </div>
      </div>
    </div>
  )
}

/** What a finished handoff leaves behind: who, when, and by what route. */
function Settled({ handoff, state }: { handoff: Handoff; state: HandoffState }) {
  if (handoff.party === "acquirer") {
    const s = state as AcquirerDecisionState
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {`Approved by you · ${fmtDateTime(s.approvedIso!)}`}
      </p>
    )
  }
  if (handoff.party === "ingenico") {
    const s = state as IngenicoWaitState
    const took = s.requestedIso
      ? workingDaysBetween(new Date(s.requestedIso), new Date(s.returnedIso!))
      : null
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {`Returned by ${handoff.team} · ${fmtDateTime(s.returnedIso!)}`}
        {took !== null && ` · ${took} working day${took === 1 ? "" : "s"}`}
      </p>
    )
  }
  const s = state as MerchantChaseState
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {`Merchant ${handoff.portalAction} · ${fmtDateTime(s.receivedIso!)}`}
      {s.chases > 0 && ` · after ${s.chases} reminder${s.chases === 1 ? "" : "s"}`}
    </p>
  )
}

// ---------------------------------------------------------------------------

function Blocked({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />
      {children}
    </p>
  )
}

function AcquirerPanel({
  handoff,
  runComplete,
  precondition,
  superseded,
  onApprove,
}: {
  handoff: Extract<Handoff, { party: "acquirer" }>
  runComplete: boolean
  /** A named reason the decision cannot be taken yet, or null when it can.
   *  Passed in rather than computed here: what blocks an underwriting sign-off
   *  and what blocks a branding approval are different things. */
  precondition: string | null
  superseded: Decision | null
  onApprove: () => void
}) {
  if (!runComplete) return <Blocked>Run the agent first — there is nothing to approve yet.</Blocked>
  return (
    <div>
      {/* WHY THIS IS BEING ASKED AGAIN.
          An approval that quietly disappears looks like the app losing your
          decision. Saying when it was given, and that the design has changed
          since, makes the reopened gate a consequence of your own edit rather
          than a fault — and it is the only place the superseded record is
          shown, so it does not linger anywhere as a live-looking tick. */}
      {superseded && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/[0.07] p-2.5 text-[11px] leading-relaxed text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {`You approved this on ${fmtDateTime(superseded.atIso)}. The design has been edited since, so that approval no longer covers what is on screen — it needs approving again.`}
          </span>
        </p>
      )}
      <p className="rounded-lg border border-border/70 bg-background/70 p-2.5 text-xs leading-relaxed text-muted-foreground">
        {handoff.commits}
      </p>
      {/* A disabled control must always name its blocker, or it reads as a
          broken button rather than an unmet condition. */}
      {precondition && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {precondition}
        </p>
      )}
      <button
        onClick={onApprove}
        disabled={precondition !== null}
        className={cn(
          "mt-2.5 inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-opacity",
          precondition
            ? "cursor-not-allowed bg-secondary text-muted-foreground"
            : "bg-primary text-primary-foreground hover:opacity-90",
        )}
      >
        {handoff.action}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function IngenicoPanel({
  handoff,
  state,
  runComplete,
  onChange,
}: {
  handoff: Extract<Handoff, { party: "ingenico" }>
  state: IngenicoWaitState
  runComplete: boolean
  onChange: (next: IngenicoWaitState) => void
}) {
  if (!runComplete) return <Blocked>The request goes to {handoff.team} once the agent run finishes.</Blocked>

  const requested = state.requestedIso ?? new Date().toISOString()
  const due = addWorkingDays(new Date(requested), handoff.slaDays)
  const overdue = new Date() > due

  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-border/70 bg-background/70 p-2.5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{handoff.team}</span>
          {/* Do not lowercase: the sentence carries acronyms like QA. */}
          {" owns this. Nothing is required from you. When they are done you will get: "}
          {handoff.returns}.
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px]">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className={cn(overdue ? "font-medium text-warning-foreground" : "text-muted-foreground")}>
            {`Due ${fmtDate(due.toISOString())} · ${handoff.slaDays} working day${
              handoff.slaDays === 1 ? "" : "s"
            }`}
            {overdue && " · past due"}
          </span>
        </p>
        {state.chases > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {`${state.chases} chase${state.chases === 1 ? "" : "s"} raised${
              state.lastChaseIso ? `, last ${fmtDate(state.lastChaseIso)}` : ""
            }.`}
          </p>
        )}
      </div>

      {/* Waiting is not the same as being unable to act. Past SLA you can push
          the order desk, and the push is recorded against the order so the
          next conversation starts from a fact rather than a recollection. */}
      {overdue ? (
        <button
          onClick={() =>
            onChange({
              ...state,
              requestedIso: requested,
              chases: state.chases + 1,
              lastChaseIso: new Date().toISOString(),
            })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-warning/15 px-3 py-2 text-xs font-semibold text-warning-foreground transition-colors hover:bg-warning/25"
        >
          <Send className="h-3.5 w-3.5" />
          {state.chases ? "Chase again" : "Chase the order desk"}
        </button>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Within SLA, so there is nothing to chase yet. A chase becomes available on{" "}
          {fmtDate(due.toISOString())}.
        </p>
      )}

      {/* The acquirer does not report Ingenico's work, so this is not an
          approval — it stands in for the inbound feed this prototype has no
          connection to, and is labelled as such rather than dressed as a
          control the acquirer would really have. */}
      <button
        onClick={() =>
          onChange({ ...state, requestedIso: requested, returnedIso: new Date().toISOString() })
        }
        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border bg-transparent px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <Inbox className="h-3.5 w-3.5" />
        Simulate inbound: {handoff.team} responds
      </button>
    </div>
  )
}

function MerchantPanel({
  handoff,
  state,
  merchant,
  runComplete,
  onChange,
}: {
  handoff: Extract<Handoff, { party: "merchant" }>
  state: MerchantChaseState
  merchant: Merchant
  runComplete: boolean
  onChange: (next: MerchantChaseState) => void
}) {
  const draft = draftEmail(handoff, merchant, state)
  // Hold only the acquirer's OWN edits. Seeding a `body` state from the draft
  // froze the first email in place, so a reminder rendered word-for-word
  // identical to the original — the one thing a chase must never be.
  const [edited, setEdited] = useState<string | null>(null)
  const body = edited ?? draft.body
  const [open, setOpen] = useState(false)
  const { supplyDocuments } = useDemo()

  if (!runComplete) {
    return <Blocked>The agent drafts the request to the merchant once the run finishes.</Blocked>
  }

  const sent = state.sentIso !== null
  const chaseDue = sent
    ? addWorkingDays(new Date(state.lastChaseIso ?? state.sentIso!), handoff.chaseAfterDays)
    : null
  const chaseOverdue = chaseDue !== null && new Date() > chaseDue

  function send() {
    const now = new Date().toISOString()
    if (!sent) onChange({ ...state, sentIso: now })
    else onChange({ ...state, chases: state.chases + 1, lastChaseIso: now })
    // Edits belong to the message just sent, not to the next one.
    setEdited(null)
    setOpen(false)
  }

  return (
    <div className="space-y-2.5">
      {/* Status first: an absence is stated, never left blank. */}
      <div className="rounded-lg border border-border/70 bg-background/70 p-2.5">
        {!sent ? (
          <p className="text-xs text-muted-foreground">
            Nothing has been sent yet. The agent has drafted the request below.
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-foreground">
              {`Requested ${fmtDate(state.sentIso!)}`}
              {state.chases > 0 &&
                ` · ${state.chases} reminder${state.chases === 1 ? "" : "s"} sent, last ${fmtDate(
                  state.lastChaseIso!,
                )}`}
            </p>
            <p
              className={cn(
                "text-[11px]",
                chaseOverdue ? "font-medium text-warning-foreground" : "text-muted-foreground",
              )}
            >
              {chaseOverdue
                ? `Next reminder was due ${fmtDate(chaseDue!.toISOString())}`
                : `Next reminder due ${fmtDate(chaseDue!.toISOString())}`}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/70 px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <Mail className="h-3.5 w-3.5" />
          {open ? "Hide draft" : sent ? "Review reminder draft" : "Review draft"}
        </button>
        <button
          onClick={send}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Send className="h-3.5 w-3.5" />
          {sent ? "Send reminder" : "Send request"}
        </button>
      </div>

      {open && (
        <div className="overflow-hidden rounded-lg border border-border bg-background/80">
          <div className="border-b border-border px-3 py-2 text-[11px]">
            <p className="text-muted-foreground">
              {"To  "}
              <span className="text-foreground">{draft.to}</span>
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {"Subject  "}
              <span className="text-foreground">{draft.subject}</span>
            </p>
          </div>
          <textarea
            value={body}
            onChange={(e) => setEdited(e.target.value)}
            rows={10}
            className="w-full resize-y bg-transparent px-3 py-2 text-[11.5px] leading-relaxed text-foreground outline-none"
          />
        </div>
      )}

      {/* Inbound half of the loop: the merchant answers in the portal, and it
          lands here without anyone re-keying it.

          Styled as a demo control rather than a product one. It fabricates an
          event that never happened, and previously wore the same dashed
          border as the interface around it — which made a conjured reply look
          like a received one. */}
      <DemoInbound
        label={`Simulate inbound: merchant ${handoff.portalAction}`}
        onTrigger={() => {
          onChange({ ...state, receivedIso: new Date().toISOString() })
          // The reply and its CONTENTS are the same event. Marking the handoff
          // received without delivering the documents left the file still
          // halted underneath a control that had just said the merchant
          // uploaded them — the chase closed, the gap didn't.
          if (handoff.party === "merchant" && outstandingDocuments(merchant).length > 0) {
            supplyDocuments(merchant.id)
          }
        }}
      />
    </div>
  )
}
