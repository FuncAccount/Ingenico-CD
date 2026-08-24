"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, CornerDownLeft, Search, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { PIPELINE, portfolioKpis } from "@/lib/acquirer-data"
import { applyDecisions } from "@/lib/decisions"
import { haltedByMerchant } from "@/lib/artifacts"
import { useBrandTheme } from "@/components/acquirer/brand-theme-provider"
import { useDecisions } from "@/components/acquirer/decisions-provider"
import { useBook } from "@/components/acquirer/book-provider"
import { useProgress } from "@/components/acquirer/progress-provider"
import type { Screen } from "@/components/acquirer/top-nav"

interface Answer {
  q: string
  trace: string
  body: string
  cta?: { label: string; screen: Screen }
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return reduced
}

/**
 * The agent command palette. Every answer is derived from the live book, so a
 * figure here can never disagree with the table it came from.
 */
export function AgentBar({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<Answer | null>(null)
  const [typed, setTyped] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const reduced = usePrefersReducedMotion()

  const { merchants: book } = useBook()
  const { decisions } = useDecisions()
  const { themeFor } = useBrandTheme()
  const { playedFor } = useProgress()

  /* The same halt map the portfolio derives its badges from — and, now, the
     same played set. Omitting either makes `stuck` count a different population
     from the table it is summarising: without the halts it sees only merchants
     a fixture happens to LABEL "Exception", and without the played set it
     counts findings on steps the agent has never run. Either way the docblock's
     promise breaks by the exact mechanism it warns about. */
  const halted = useMemo(
    () => haltedByMerchant(book, themeFor, (m) => playedFor(m.id)),
    [book, themeFor, playedFor],
  )

  const answers = useMemo<Answer[]>(() => {
    // The LIVE book, with decisions applied. The docblock above promises these
    // figures cannot disagree with the table they came from, but the source was
    // the frozen fixture — so the agent went on naming merchants you had
    // already signed off, and had never heard of one you had just submitted.
    const merchants = applyDecisions(book, decisions, halted)
    const k = portfolioKpis(merchants)
    const waiting = merchants.filter((m) => m.status === "Needs sign-off")
    const stuck = merchants.filter((m) => m.status === "Exception")
    const nearLive = merchants.filter(
      (m) => m.currentStep >= 7 && m.status !== "Live",
    )
    // One field, two complementary sides, so these always sum to PIPELINE.length.
    const yours = PIPELINE.filter((s) => s.acquirerRole !== "watch").length
    const mine = PIPELINE.length - yours

    return [
      {
        q: "What needs me today?",
        trace: `queue.scan → ${merchants.length} merchants, ${waiting.length} awaiting you`,
        body: waiting.length
          ? `${waiting.length} decisions are waiting on your signature: ${waiting
              .map((m) => m.name)
              .join(", ")}. I have finished the analysis on each one — you only need to agree or send it back.`
          : "Nothing is waiting on your signature. I will surface the next decision the moment one is ready.",
        cta: { label: "Open sign-off queue", screen: "signoff" },
      },
      {
        q: "Where is my book stuck?",
        trace: `exception.detect → ${stuck.length} blocked of ${merchants.length}`,
        body: stuck.length
          ? `${stuck.map((m) => `${m.name} is held at step ${String(m.currentStep).padStart(2, "0")}`).join(", ")}. I have retried automatically and escalated what I could not clear on my own.`
          : "Nothing is blocked right now. Every merchant is moving through the pipeline on schedule.",
        cta: { label: "Review the book", screen: "portfolio" },
      },
      {
        q: "Who is about to go live?",
        trace: `pipeline.project → ${nearLive.length} in the final stretch`,
        body: nearLive.length
          ? `${nearLive.map((m) => m.name).join(" and ")} ${nearLive.length === 1 ? "is" : "are"} past dispatch and into install. On current pace they should be taking live payments within days — average time to go live across your book is ${k.avgTimeToGoLive}.`
          : `No merchants are in the final stretch today. Average time to go live across your book is ${k.avgTimeToGoLive}.`,
        cta: { label: "Watch the journey", screen: "journey" },
      },
      {
        q: "How much are you handling for me?",
        trace: `workload.split → ${mine} mine + ${yours} yours = ${PIPELINE.length} steps`,
        body: `I run ${mine} of the ${PIPELINE.length} pipeline steps end to end — you only watch them. The other ${yours} are yours to own, sign or approve, and I will not move them without you. That split is deliberate: the regulated call never leaves your desk.`,
        cta: { label: "See the pipeline", screen: "journey" },
      },
    ]
    // An empty dep array here would have re-frozen everything one layer down:
    // the answers would be computed once at mount and go on quoting the book as
    // it was when the page loaded, which is the same defect in a new place.
    //
    // `halted` belongs here for the same reason. It is an input to
    // `applyDecisions` above, so leaving it out means "Where is my book stuck?"
    // keeps answering from the halt map as it stood at mount — and now that
    // halts depend on which runs have been PLAYED, that set changes while the
    // palette is open. The answer would go stale the moment you ran an agent.
  }, [book, decisions, halted])

  // ⌘K / Ctrl+K to summon, Esc to dismiss.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else {
      setActive(null)
      setTyped(0)
    }
  }, [open])

  // Stream the answer in, the way an agent actually replies.
  useEffect(() => {
    if (!active) return
    if (reduced) {
      setTyped(active.body.length)
      return
    }
    setTyped(0)
    const id = window.setInterval(() => {
      setTyped((n) => {
        if (n >= active.body.length) {
          window.clearInterval(id)
          return n
        }
        return n + 2
      })
    }, 12)
    return () => window.clearInterval(id)
  }, [active, reduced])

  const streaming = active ? typed < active.body.length : false

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="glass-pill glass-hover group hidden items-center gap-2.5 rounded-full py-2 pl-3 pr-2.5 text-left lg:flex"
      >
        <span className="relative flex h-4 w-4 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-primary/25 animate-agent-ring" />
          <Sparkles className="relative h-3.5 w-3.5 text-primary" />
        </span>
        <span className="text-xs text-muted-foreground group-hover:text-foreground">
          Ask the agent
        </span>
        <kbd className="rounded-md border border-border/70 bg-white/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
          <button
            aria-label="Close agent"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-foreground/15 backdrop-blur-md"
          />

          <div className="agent-border relative w-full max-w-2xl overflow-hidden rounded-2xl glass-solid shadow-2xl">
            <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3.5">
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <span className="absolute inset-0 rounded-full bg-primary/20 animate-agent-ring" />
                <Sparkles className="relative h-3.5 w-3.5 text-primary" />
              </span>
              <input
                ref={inputRef}
                placeholder="Ask about your book, a merchant, or a step…"
                className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[52vh] overflow-y-auto p-2">
              {!active && (
                <>
                  <p className="px-2 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Suggested
                  </p>
                  <div className="flex flex-col">
                    {answers.map((a) => (
                      <button
                        key={a.q}
                        onClick={() => setActive(a)}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary/70"
                      >
                        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 text-sm text-foreground">
                          {a.q}
                        </span>
                        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </>
              )}

              {active && (
                <div className="animate-trace-in p-2">
                  <p className="text-sm font-medium text-foreground">
                    {active.q}
                  </p>
                  <p className="mt-2 font-mono text-[11px] text-primary">
                    {active.trace}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {active.body.slice(0, typed)}
                    {streaming && (
                      <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-primary animate-caret" />
                    )}
                  </p>

                  <div className="mt-4 flex items-center gap-2">
                    {active.cta && (
                      <button
                        onClick={() => {
                          onNavigate(active.cta!.screen)
                          setOpen(false)
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                      >
                        {active.cta.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => setActive(null)}
                      className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      Ask something else
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div
              className={cn(
                "flex items-center gap-2 border-t border-border/70 px-4 py-2.5",
                "font-mono text-[10px] text-muted-foreground",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-agent-pulse" />
              agent online · answers derived from your live book
            </div>
          </div>
        </div>
      )}
    </>
  )
}
