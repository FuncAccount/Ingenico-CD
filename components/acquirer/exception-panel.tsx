"use client"

import { AlertTriangle, ArrowRight, Check, Lock, Send } from "lucide-react"
import { useState } from "react"

import type { MerchantException } from "@/lib/exceptions"
import { cn } from "@/lib/utils"

const OWNER_LABEL: Record<MerchantException["needsHuman"]["owner"], string> = {
  merchant: "the merchant",
  acquirer: "you",
  ingenico: "Ingenico",
}

export function ExceptionPanel({
  exception,
  merchantName,
}: {
  exception: MerchantException
  merchantName: string
}) {
  const [sent, setSent] = useState(false)

  const done = exception.agentMoves.filter((m) => m.done)
  const offered = exception.agentMoves.filter((m) => !m.done)

  return (
    <section
      className="glass overflow-hidden rounded-xl border border-destructive/35"
      aria-labelledby="exception-heading"
    >
      {/* What is wrong. Leads, because this is the question the screen exists
          to answer and it was previously not on the page at all. */}
      <div className="flex items-start gap-3 border-b border-destructive/25 bg-destructive/8 px-4 py-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-destructive/15">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
        </span>
        <div className="min-w-0">
          <p
            id="exception-heading"
            className="text-[11px] font-bold uppercase tracking-[0.14em] text-destructive"
          >
            Step blocked
          </p>
          <p className="mt-1 text-sm font-semibold leading-snug text-foreground">
            {exception.summary}
          </p>
        </div>
      </div>

      <div className="grid gap-px bg-border/60 sm:grid-cols-2">
        <Cell label="What the agent tried">{exception.attempted}</Cell>
        <Cell label="What it found" source={exception.source}>
          {exception.found}
        </Cell>
      </div>

      <p className="border-t border-border/60 bg-secondary/40 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">While this is open · </span>
        {exception.consequence}
      </p>

      {/* How the agent helps — split into what it has already done and what it
          is offering, because "handled" and "available" are different claims. */}
      <div className="border-t border-border/60 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          What the agent has done
        </p>
        <ul className="mt-2 space-y-1.5">
          {done.map((m) => (
            <li key={m.label} className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">{m.label}. </span>
                {m.detail}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          What it can do next
        </p>
        <ul className="mt-2 space-y-1.5">
          {offered.map((m) => (
            <li key={m.label} className="flex items-start gap-2">
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">{m.label}. </span>
                {m.detail}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {/* The limit. Kept as prominent as the capability list above it: an agent
          panel that lists only what it CAN do reads as "in hand", when the step
          is stopped precisely because something is not. */}
      <div className="border-t border-border/60 bg-warning/8 px-4 py-3">
        <div className="flex items-start gap-2">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-foreground" />
          <div>
            <p className="text-xs font-semibold text-foreground">
              {exception.needsHuman.limit}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {exception.needsHuman.why} This one is{" "}
              <span className="font-semibold text-foreground">
                {OWNER_LABEL[exception.needsHuman.owner]}
              </span>
              &apos;s to answer.
            </p>
          </div>
        </div>

        {exception.candidates && exception.candidates.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {exception.candidates.map((c) => (
              <div
                key={c.value}
                className="rounded-lg border border-border/70 bg-background/60 px-3 py-2"
              >
                <p className="font-mono text-[11px] font-semibold text-foreground">{c.value}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  {c.source} — {c.caveat}
                </p>
              </div>
            ))}
            {/* Says why there is no "apply" button beside these, so its absence
                reads as a decision rather than an unfinished screen. */}
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Both are offered to {OWNER_LABEL[exception.needsHuman.owner]} to choose between. Neither
              can be applied from here.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3">
        <button
          type="button"
          onClick={() => setSent(true)}
          disabled={sent}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
            sent
              ? "cursor-default bg-secondary text-muted-foreground"
              : "bg-primary text-primary-foreground hover:opacity-90",
          )}
        >
          {sent ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {sent ? "Request sent to the merchant" : "Send the correction request"}
        </button>
        <p className="text-[11px] text-muted-foreground">
          {sent
            ? `Validation re-runs automatically when ${merchantName} replies. The step stays blocked until it passes.`
            : "The agent drafts it, quoting both near-matches. Nothing is applied until a reply comes back."}
        </p>
      </div>
    </section>
  )
}

function Cell({
  label,
  source,
  children,
}: {
  label: string
  source?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-card/60 px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-foreground">{children}</p>
      {source && (
        <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">{source}</p>
      )}
    </div>
  )
}
