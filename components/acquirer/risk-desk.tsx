"use client"

// The risk desk — what the underwriting sign-off actually rests on.
//
// Two panels, because they answer two different questions: "how was this score
// arrived at" and "what did the agent refuse to decide". The second is the
// reason a regulated human is in the loop, so it is a decision surface, not a
// paragraph of text.

import { AlertTriangle, Minus, Plus } from "lucide-react"
import { DemoSupplyDocuments } from "@/components/acquirer/demo-control"
import { cn } from "@/lib/utils"
import type { Merchant } from "@/lib/acquirer-data"
import {
  BANDS,
  EDGE_VERDICTS,
  edgeResolved,
  riskAssessment,
  type EdgeResolution,
  type EdgeVerdict,
} from "@/lib/underwriting"

function bandTone(band: string) {
  return band === "Low"
    ? "bg-success/12 text-success"
    : band === "Medium"
      ? "bg-warning/15 text-warning-foreground"
      : "bg-destructive/12 text-destructive"
}

/** The score, decomposed. Rows sum to the total by construction. */
export function RiskBreakdown({ merchant }: { merchant: Merchant }) {
  const a = riskAssessment(merchant)

  // The stop. Rendered INSTEAD of the score, never above it — a withheld
  // verdict shown next to a number is still a number on the screen, and the
  // number is what a reader carries away.
  if (a.blocked) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border-2 border-destructive/40 bg-destructive/[0.07] px-4 py-3.5">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Cannot be scored
          </p>
          <p className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-muted-foreground/50">
            —<span className="text-base font-normal"> / 100</span>
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-foreground">{a.blocked.reason}</p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
          <p className="border-b border-border/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Outstanding · {a.blocked.missing.length}
          </p>
          {a.blocked.missing.map((d, i) => (
            <p
              key={d}
              className={cn(
                "flex items-start gap-2 px-3 py-2.5 text-xs text-foreground",
                i > 0 && "border-t border-border/60",
              )}
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
              {d}
            </p>
          ))}
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The checks that did run are recorded against{" "}
          <span className="font-medium text-foreground">Parse the documents</span>. They are not
          combined into a score here, because a total assembled from a partial file would read as a
          measurement of the whole one.
        </p>

        <DemoSupplyDocuments merchant={merchant} />
      </div>
    )
  }

  const openFactors = a.factors.filter((f) => f.open)
  const openCount = openFactors.length
  const openPoints = openFactors.reduce((s, f) => s + f.points, 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border/70 bg-secondary/40 px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Risk score</p>
          <p className="font-mono text-3xl font-bold tabular-nums text-foreground">
            {a.score}
            <span className="text-base font-normal text-muted-foreground"> / 100</span>
          </p>
        </div>
        <span
          className={cn("rounded-lg px-2.5 py-1 text-xs font-bold", bandTone(a.band))}
        >
          {a.band}
        </span>
      </div>

      {/* Where the bands sit, so a score near a boundary can be argued with. */}
      <div className="flex gap-1">
        {BANDS.map((b) => {
          const active = a.band === b.band
          return (
            <div key={b.band} className="flex-1">
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  active ? "bg-primary" : "bg-border",
                )}
              />
              <p
                className={cn(
                  "mt-1 text-[10px]",
                  active ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {b.band} {b.min}–{b.max}
              </p>
            </div>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
        {a.factors.map((f, i) => (
          <div
            key={f.label}
            className={cn("px-3 py-2.5", i > 0 && "border-t border-border/60")}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold text-foreground">
                {f.label}
                {/* An absent check that adds points looks identical to a
                    measured one unless it says so on the row itself. */}
                {f.open && (
                  <span className="ml-1.5 rounded bg-warning/15 px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wide text-warning-foreground">
                    Not run
                  </span>
                )}
              </p>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums",
                  f.points > 0
                    ? "bg-destructive/10 text-destructive"
                    : "bg-success/12 text-success",
                )}
              >
                {f.points > 0 ? <Plus className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
                {Math.abs(f.points)}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{f.evidence}</p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {f.source}
            </p>
          </div>
        ))}

        {/* Print the arithmetic. A total you cannot reproduce from the rows
            above it is just another assertion. */}
        <div className="flex items-center justify-between gap-3 border-t-2 border-border bg-secondary/50 px-3 py-2">
          <p className="font-mono text-[11px] text-muted-foreground">
            {a.factors.map((f) => (f.points < 0 ? `− ${Math.abs(f.points)}` : `+ ${f.points}`)).join("  ")}
          </p>
          <span className="font-mono text-sm font-bold tabular-nums text-foreground">
            = {a.rawTotal}
          </span>
        </div>
        {a.clamped && (
          <p className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            The factors total {a.rawTotal}; the scale caps at 0–100, so the score reads {a.score}.
          </p>
        )}
        {/* How much of the score is standing in for evidence nobody has. A
            score inflated by absent checks reads the same as a score earned by
            adverse findings, and they call for opposite responses. */}
        {openCount > 0 && (
          <p className="border-t border-border/60 bg-warning/8 px-3 py-2 text-[11px] leading-relaxed text-warning-foreground">
            {Math.abs(openPoints)} of this {a.score}-point score{" "}
            {openPoints < 0 ? "is offset by" : "comes from"}{" "}
            {openCount === 1 ? "a line" : "lines"} the breakdown cannot explain.
            {Math.abs(openPoints) > a.score / 2 &&
              " That is more than half the score, so this breakdown does not on its own justify the band — read the case notes before you sign."}
          </p>
        )}
      </div>

      {/* Present here too. A score reached via the simulation must keep saying
          so, and the presenter needs a way back to the stop — without this the
          lever is one-way and the walkthrough cannot be run twice. */}
      <DemoSupplyDocuments merchant={merchant} />
    </div>
  )
}

/** The escalated item. The agent stopped here on purpose. */
export function EdgeCaseDesk({
  merchant,
  resolution,
  onResolution,
}: {
  merchant: Merchant
  resolution: EdgeResolution | undefined
  onResolution: (r: EdgeResolution) => void
}) {
  const edge = merchant.underwriting?.edgeCase

  if (!edge) {
    // "Nothing escalated" and "everything came back clean" are different
    // claims. A factor the agent could not run is an OPEN check, and saying
    // every check was clean while the breakdown above reports one unverified
    // is the contradiction this branch previously shipped.
    const unresolved = riskAssessment(merchant).factors.filter((f) => f.open)
    return (
      <div className="rounded-xl border border-border/70 bg-white/60 p-4">
        <p className="text-sm text-foreground">Screening raised nothing for your judgement.</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {unresolved.length === 0
            ? "Every check the agent ran returned a clean result, and none of them needed a human call."
            : `No check produced a finding that needs your determination. ${
                unresolved.length === 1 ? "One check" : `${unresolved.length} checks`
              } could not be completed and ${
                unresolved.length === 1 ? "is" : "are"
              } still open — ${unresolved
                .map((f) => f.label.toLowerCase())
                .join("; ")} — which is an absent result, not a clean one.`}
        </p>
      </div>
    )
  }

  const chosen = resolution?.verdict
  const spec = EDGE_VERDICTS.find((v) => v.id === chosen)
  const needsNote = spec?.needsNote ?? false
  const settled = edgeResolved(merchant, resolution)

  const set = (verdict: EdgeVerdict) => onResolution({ verdict, note: resolution?.note ?? "" })

  return (
    <div className="space-y-3">
      <div className="flex gap-2.5 rounded-xl border border-warning/40 bg-warning/8 p-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
        <div>
          <p className="text-xs font-semibold text-foreground">
            The agent escalated this rather than deciding it
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">{edge}</p>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-medium text-foreground">Your determination</p>
        <div className="space-y-1.5">
          {EDGE_VERDICTS.map((v) => (
            <button
              key={v.id}
              onClick={() => set(v.id)}
              aria-pressed={chosen === v.id}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                chosen === v.id
                  ? "border-primary bg-primary/8"
                  : "border-border bg-white/60 hover:border-primary/40",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2",
                  chosen === v.id ? "border-primary bg-primary" : "border-border",
                )}
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-foreground">{v.label}</span>
                <span className="block text-[11px] leading-relaxed text-muted-foreground">
                  {v.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {needsNote && (
        <div>
          <label htmlFor="edge-note" className="mb-1.5 block text-[11px] font-medium text-foreground">
            {chosen === "condition" ? "The condition" : "Why you are referring it"}
          </label>
          <textarea
            id="edge-note"
            rows={3}
            value={resolution?.note ?? ""}
            onChange={(e) => onResolution({ verdict: chosen!, note: e.target.value })}
            placeholder={
              chosen === "condition"
                ? "e.g. Volume review at 90 days; reserve held at 5% until then."
                : "e.g. Exposure above my delegated limit — second signature required."
            }
            className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs leading-relaxed text-foreground outline-none focus:border-primary"
          />
          {!settled && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              This goes on the account record, so it has to say something. A condition nobody wrote
              down is not a condition.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
