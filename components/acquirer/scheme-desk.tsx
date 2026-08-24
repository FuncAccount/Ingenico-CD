"use client"

import { Ban, Check, Lock, Send, Undo2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Merchant } from "@/lib/acquirer-data"

/** Who actions the change. NOT `ACQUIRER` from `lib/branding` — that is
 *  Northgate, the reader's own organisation, so using it here would have
 *  addressed the instruction to the person sending it. */
const PROVIDER = "Ingenico"
import {
  type AcceptanceState,
  type SchemeLine,
  lineStatus,
  nextRef,
  pendingChanges,
  schemeLines,
} from "@/lib/scheme-acceptance"

/**
 * The scheme acceptance desk.
 *
 * The whole design turns on ONE distinction: editing a line is not configuring
 * it. Ingenico configures. So a toggle here writes to `requested`, the row
 * immediately says "Not sent", and the only thing that leaves this panel is an
 * instruction with a reference and a timestamp. Nothing the acquirer clicks
 * can move a line into "Enabled".
 */

/** Tone per status. Deliberately NOT a green tick for anything requested —
 *  green here would report a result for work that has not been done. */
function statusTone(state: string): string {
  switch (state) {
    case "live":
      return "bg-success/12 text-success"
    case "with-ingenico":
      return "bg-primary/12 text-primary"
    case "draft-on":
    case "draft-off":
      return "bg-warning/15 text-warning-foreground"
    case "blocked":
      return "bg-muted text-muted-foreground"
    default:
      return "bg-secondary text-muted-foreground"
  }
}

function Row({
  line,
  state,
  onToggle,
}: {
  line: SchemeLine
  state: AcceptanceState
  onToggle: (id: SchemeLine["id"], next: boolean) => void
}) {
  const status = lineStatus(line, state)
  const want = state.requested[line.id]
  const editable = line.authority === "acquirer"
  const blocked = line.authority === "blocked"

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b border-border/60 px-3 py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between",
        blocked && "bg-muted/30",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-sm font-semibold",
              // Struck, named, and left on screen. Hiding an unavailable line
              // would read as an option nobody considered.
              blocked ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {line.label}
          </span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              statusTone(status.state),
            )}
          >
            {status.label}
          </span>
          {line.authority === "mandate" && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
              <Lock className="h-3 w-3" />
              not switchable
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {line.effect} <span className="text-muted-foreground/80">· {line.source}</span>
        </p>
        {blocked && line.blockedReason && (
          <p className="mt-1.5 flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Ban className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{line.blockedReason}</span>
          </p>
        )}
      </div>

      {editable ? (
        <button
          type="button"
          role="switch"
          aria-checked={want}
          aria-label={`${want ? "Remove" : "Request"} ${line.label}`}
          onClick={() => onToggle(line.id, !want)}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
            want ? "border-primary/40 bg-primary/70" : "border-border bg-secondary",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow-sm transition-all",
              want ? "left-[22px]" : "left-0.5",
            )}
            style={{ height: 18, width: 18 }}
          />
        </button>
      ) : (
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {blocked ? "unavailable" : "mandated"}
        </span>
      )}
    </div>
  )
}

export function SchemeDesk({
  merchant,
  state,
  onState,
}: {
  merchant: Merchant
  state: AcceptanceState
  onState: (s: AcceptanceState) => void
}) {
  const lines = schemeLines(merchant)
  const pending = pendingChanges(merchant, state)
  const latest = state.sent[state.sent.length - 1]

  function toggle(id: SchemeLine["id"], next: boolean) {
    onState({ ...state, requested: { ...state.requested, [id]: next } })
  }

  function send() {
    if (pending.length === 0) return
    onState({
      ...state,
      sent: [
        ...state.sent,
        {
          ref: nextRef(merchant, state.sent.length),
          // Stamped once, here. Formatting `new Date()` at render would
          // restate an old instruction with today's clock.
          sentIso: new Date().toISOString(),
          requested: { ...state.requested },
        },
      ],
    })
  }

  /** Back to the last position anyone was told about — the most recent
   *  instruction if one exists, otherwise what is live. Reverting to `live`
   *  unconditionally would silently withdraw a change already sent, which is
   *  not something a "discard my edits" button should be able to do. */
  function revert() {
    const last = state.sent[state.sent.length - 1]
    onState({ ...state, requested: { ...(last ? last.requested : state.live) } })
  }

  return (
    <div className="space-y-2.5">
      <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
        {lines.map((l) => (
          <Row key={l.id} line={l} state={state} onToggle={toggle} />
        ))}
      </div>

      {/* The instruction desk. Present whether or not there are changes, so it
          is never ambiguous whether this panel can send anything at all. */}
      <div className="rounded-xl border border-border/70 bg-secondary/40 p-3">
        <p className="text-xs font-semibold text-foreground">
          {pending.length === 0
            ? "No changes to send"
            : `${pending.length} change${pending.length > 1 ? "s" : ""} ready to send`}
        </p>

        {pending.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {pending.map(({ line, want }) => (
              <li key={line.id} className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">
                  {want ? "Enable" : "Remove"} {line.label}
                </span>
                {" — "}
                {want
                  ? "not configured today"
                  : "currently live; removal must be actioned by Ingenico too"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {/* "Matches what Ingenico has configured" is false once something
                has been sent and not yet applied — the two states have to read
                differently or a waiting instruction looks like a settled one. */}
            {latest
              ? `Everything you have asked for is with ${PROVIDER}. Toggle a line above to raise a further change.`
              : `The requested set matches what ${PROVIDER} has configured. Toggle a line above to raise a change.`}
          </p>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Sending records the instruction against this merchant and puts it in {PROVIDER}
          &apos;s queue. It does not configure the schemes — {PROVIDER} applies the change and
          the line moves to Enabled only once they confirm it.
        </p>

        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={send}
            disabled={pending.length === 0}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
              pending.length === 0
                ? "cursor-not-allowed bg-secondary text-muted-foreground"
                : "bg-primary text-primary-foreground hover:opacity-90",
            )}
          >
            <Send className="h-3.5 w-3.5" />
            Send instruction to {PROVIDER}
          </button>
          {pending.length > 0 && (
            <button
              type="button"
              onClick={revert}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/70 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Discard changes
            </button>
          )}
        </div>
      </div>

      {/* Receipts. Each names what was asked and when — "we told Ingenico" is
          only checkable if it carries a reference and a time. */}
      {state.sent.length > 0 && (
        <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Check className="h-3.5 w-3.5 text-primary" />
            Instruction {latest!.ref} sent to {PROVIDER}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {new Date(latest!.sentIso).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {state.sent.length > 1 && ` · ${state.sent.length} instructions on this merchant`}
            . Awaiting confirmation — the lines above stay as they are until {PROVIDER}{" "}
            applies them.
          </p>
        </div>
      )}
    </div>
  )
}
