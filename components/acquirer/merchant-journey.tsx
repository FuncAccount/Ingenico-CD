"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronDown,
  Cpu,
  FileSearch,
  Lock,
  Store,
  Pause,
  PartyPopper,
  Play,
  RotateCcw,
  Sparkles,
  Terminal,
  UserCheck,
  Wrench,
  Plug,
} from "lucide-react"
import {
  MERCHANTS,
  PIPELINE,
  bandTone,
  statusTone,
  type Merchant,
  type PipelineStep,
  type StepId,
} from "@/lib/acquirer-data"
import { cn } from "@/lib/utils"
import { artifactFor, defaultBasket, traceFor } from "@/lib/artifacts"
import {
  ArtifactInspector,
  type OrderDraft,
} from "@/components/acquirer/artifact-inspector"
import { StepGate } from "@/components/acquirer/step-gate"
import { ownerOf, waitingOn, type HandoffState } from "@/lib/handoffs"
import { blockers, checkBrand, defaultTheme, type BrandTheme } from "@/lib/branding"
import { edgeResolved, type EdgeResolution } from "@/lib/underwriting"
import { exceptionDetailMissing, exceptionOnStep } from "@/lib/exceptions"
import { ExceptionPanel } from "@/components/acquirer/exception-panel"

type StepState = "done" | "active" | "upcoming"

export function MerchantJourney({
  merchant,
  onSelectMerchant,
  onOpenSignoff,
}: {
  merchant?: Merchant
  onSelectMerchant: (m: Merchant) => void
  onOpenSignoff: (m: Merchant) => void
}) {
  const current = merchant ?? MERCHANTS[3]
  const [pickerOpen, setPickerOpen] = useState(false)
  const [focusStep, setFocusStep] = useState<StepId>(current.currentStep)

  // When the merchant changes, refocus on their current step.
  useEffect(() => {
    setFocusStep(current.currentStep)
  }, [current.id, current.currentStep])

  const tone = statusTone(current.status)

  function stepState(step: PipelineStep): StepState {
    if (step.id < current.currentStep) return "done"
    if (step.id === current.currentStep) return "active"
    return "upcoming"
  }

  const focused = PIPELINE.find((s) => s.id === focusStep)!
  const focusedState = stepState(focused)

  const doneCount = PIPELINE.filter((s) => stepState(s) === "done").length
  const pct = Math.round((doneCount / PIPELINE.length) * 100)

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header: merchant picker + status */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-3 rounded-2xl glass px-4 py-3 text-left transition-colors hover:border-primary/40"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-sm font-bold text-primary">
              {current.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <p className="text-lg font-semibold tracking-tight text-foreground">
                {current.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {current.sector} · {current.location} · {current.terminals}
              </p>
            </div>
            <ChevronDown className="ml-1 h-4 w-4 text-muted-foreground" />
          </button>
          {pickerOpen && (
            <div className="absolute z-20 mt-2 max-h-80 w-80 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-2xl">
              {MERCHANTS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onSelectMerchant(m)
                    setPickerOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-secondary",
                    m.id === current.id && "bg-secondary",
                  )}
                >
                  <span className="font-medium text-foreground">{m.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {String(m.currentStep).padStart(2, "0")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
            tone.bg,
            tone.text,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
          {current.status}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-5 flex items-center gap-4">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500 glow-soft"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {doneCount}/{PIPELINE.length} steps · {pct}%
        </span>
      </div>

      {/* Go-live banner */}
      {current.status === "Live" && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success/20 text-success">
            <PartyPopper className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Go-live confirmed
            </p>
            <p className="text-xs text-muted-foreground">
              First live payment detected. Records written back to your systems.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left rail: clickable steps */}
        <div className="flex flex-col gap-1.5">
          <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pipeline
          </p>
          {PIPELINE.map((step, i) => {
            const state = stepState(step)
            const isFocus = step.id === focusStep
            const isLast = i === PIPELINE.length - 1
            return (
              <div key={step.id} className="flex gap-3">
                {/* connector */}
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
                      state === "done"
                        ? "border-primary bg-primary text-primary-foreground"
                        : state === "active"
                          ? "border-primary bg-primary/15 text-primary glow-primary"
                          : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {state === "done" ? <Check className="h-4 w-4" /> : step.code}
                  </span>
                  {!isLast && (
                    <span
                      className={cn(
                        "min-h-6 w-px flex-1",
                        state === "done" ? "bg-primary/60" : "bg-border",
                      )}
                    />
                  )}
                </div>
                {/* clickable card */}
                <button
                  onClick={() => setFocusStep(step.id)}
                  className={cn(
                    "mb-1.5 flex-1 rounded-lg border px-3 py-2.5 text-left transition-all",
                    isFocus
                      ? "border-primary/50 bg-primary/[0.06]"
                      : "border-transparent hover:border-border hover:bg-secondary/50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        state === "upcoming"
                          ? "text-muted-foreground"
                          : "text-foreground",
                      )}
                    >
                      {step.name}
                    </span>
                    {ownerOf(step.id) === "acquirer" && (
                      <UserCheck className="h-3.5 w-3.5 text-primary" />
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span
                      className={cn(
                        "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        bandTone(step.band),
                      )}
                    >
                      {step.band}
                    </span>
                    <OwnerBadge step={step.id} compact />
                  </div>
                </button>
              </div>
            )
          })}
        </div>

        {/* Right: the agent trace cockpit for the focused step */}
        <StepCockpit
          step={focused}
          state={focusedState}
          merchant={current}
          onOpenSignoff={() => onOpenSignoff(current)}
        />
      </div>
    </div>
  )
}

/** Who owns the step, read off the handoff map rather than asserted twice.
 *  `waiting` overrides it when the step is yours but currently parked on
 *  someone else — "your role" and "you can act now" are different claims. */
function OwnerBadge({
  step,
  compact = false,
  waiting,
}: {
  step: StepId
  compact?: boolean
  waiting?: "acquirer" | "ingenico" | "merchant" | null
}) {
  const owner = waiting ?? ownerOf(step)
  const meta = {
    acquirer: {
      label: waiting ? "You" : "Your role",
      Icon: UserCheck,
      cls: "bg-primary/12 text-primary",
    },
    ingenico: {
      label: waiting ? "Waiting · Ingenico" : "Ingenico",
      Icon: Building2,
      cls: "bg-secondary text-muted-foreground",
    },
    merchant: {
      label: waiting ? "Waiting · Merchant" : "Merchant",
      Icon: Store,
      cls: "bg-warning/12 text-warning-foreground",
    },
  } as const

  if (!owner) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 font-medium text-muted-foreground",
          compact ? "text-[9px]" : "text-[10px]",
        )}
      >
        <Lock className="h-3 w-3" />
        No handoff
      </span>
    )
  }

  const { label, Icon, cls } = meta[owner]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold",
        cls,
        compact ? "text-[9px]" : "text-[10px]",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* The interactive per-step agent cockpit                              */
/* ------------------------------------------------------------------ */

type RunStatus = "idle" | "running" | "done"

function StepCockpit({
  step,
  state,
  merchant,
  onOpenSignoff,
}: {
  step: PipelineStep
  state: StepState
  merchant: Merchant
  onOpenSignoff: () => void
}) {
  // How many tasks have completed. Upcoming steps start at 0 (preview),
  // done steps start fully complete, the active step invites you to play.
  const initialProgress = state === "done" ? step.tasks.length : 0
  const [completed, setCompleted] = useState(initialProgress)
  const [status, setStatus] = useState<RunStatus>(
    state === "done" ? "done" : "idle",
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  // Which task's artefact is open in the inspector.
  const [selected, setSelected] = useState(0)

  // The exception, if this is the step carrying it. Everything that would
  // otherwise report a clean state reads from this one value, so the badge,
  // the failing task and the panel cannot disagree about whether the step
  // is blocked.
  const blocker = exceptionOnStep(merchant, step.id)
  const detailMissing = exceptionDetailMissing(merchant)

  // Handoff progress, keyed by merchant + step + position, so a chase sent
  // about one merchant never shows against another.
  const [handoffs, setHandoffs] = useState<Record<string, HandoffState>>({})

  // Branding and the underwriting determination live here rather than inside
  // the panels that draw them, because the sign-off gate has to read both.
  const [theme, setTheme] = useState<BrandTheme>(() => defaultTheme(merchant))
  const [edge, setEdge] = useState<EdgeResolution | undefined>(undefined)

  // The order draft is shared by the basket, stock, delivery and pricing
  // artefacts, so changing a quantity moves every downstream figure.
  const [draft, setDraft] = useState<OrderDraft>(() => ({
    lines: defaultBasket(merchant),
    serviceId: "standard",
    requestedIso: null,
  }))

  // Reset the run whenever the focused step (or merchant) changes.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const init = state === "done" ? step.tasks.length : 0
    setCompleted(init)
    setStatus(state === "done" ? "done" : "idle")
    setSelected(0)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [step.id, merchant.id, state, step.tasks.length])

  // A different merchant means a different order, never the last one's basket.
  // The same applies to the brand design and the underwriting determination:
  // carrying either across would attribute one merchant's decision to another.
  useEffect(() => {
    setDraft({ lines: defaultBasket(merchant), serviceId: "standard", requestedIso: null })
    setTheme(defaultTheme(merchant))
    setEdge(undefined)
  }, [merchant])

  // Drive the run: advance one task at a time while "running".
  useEffect(() => {
    if (status !== "running") return
    if (completed >= step.tasks.length) {
      setStatus("done")
      return
    }
    timer.current = setTimeout(() => {
      setCompleted((c) => c + 1)
    }, 720)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [status, completed, step.tasks.length])

  // Autoscroll the console as lines land.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [completed])

  // While the agent runs, the inspector follows it, so you watch artefacts
  // appear rather than having to hunt for the one that just changed.
  useEffect(() => {
    if (status !== "running") return
    setSelected(Math.min(completed, step.tasks.length - 1))
  }, [status, completed, step.tasks.length])

  function play() {
    if (completed >= step.tasks.length) {
      setCompleted(0)
      setStatus("running")
    } else {
      setStatus("running")
    }
  }
  function pause() {
    setStatus("idle")
  }
  function replay() {
    if (timer.current) clearTimeout(timer.current)
    setCompleted(0)
    setStatus("running")
  }

  const acquirerActionable =
    (step.acquirerRole === "signs-off" || step.acquirerRole === "approves") &&
    state === "active" &&
    merchant.status === "Needs sign-off"

  const runningTaskIndex = status === "running" ? completed : -1

  // What stops the acquirer's own decision on THIS step. Different steps are
  // blocked by different things, so this is computed per step rather than by
  // one shared "is everything fine" flag that could not name its own blocker.
  const precondition = useMemo<string | null>(() => {
    if (step.id === 2 && !edgeResolved(merchant, edge)) {
      return merchant.underwriting?.edgeCase && !edge
        ? "Screening escalated an item to you. Record a determination on it before signing."
        : "Your determination needs a note before it can go on the account record."
    }
    if (step.id === 4) {
      const failing = blockers(checkBrand(theme))
      if (failing.length) {
        // Name the PROBLEM, never the rule's label: a label states the
        // condition that would SATISFY the rule, so quoting it in a failure
        // message reports the opposite of what actually happened.
        return `${failing.length} brand check${failing.length === 1 ? "" : "s"} failing — ${failing
          .map((f) => f.problem ?? f.label.toLowerCase())
          .join("; ")}.`
      }
    }
    return null
  }, [step.id, merchant, edge, theme])

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl glass transition-shadow",
        // The conic ring only spins while the agent is genuinely working.
        status === "running" && "agent-border glow-soft",
      )}
    >
      {/* Cockpit header */}
      <div className="relative border-b border-border p-5">
        <div className="grid-fade pointer-events-none absolute inset-0 opacity-40" />
        {status === "running" && (
          <div className="animate-shimmer pointer-events-none absolute inset-0" />
        )}
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-xl",
                state === "upcoming"
                  ? "bg-secondary text-muted-foreground"
                  : "bg-primary/12 text-primary",
              )}
            >
              <Cpu className="h-5 w-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  <span className="font-mono text-muted-foreground">
                    {step.code}
                  </span>{" "}
                  {step.name}
                </h2>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                    bandTone(step.band),
                  )}
                >
                  {step.band}
                </span>
                {/* Name the party who actually owns the step. "Agent-run" was
                    covering three different situations — Ingenico's work, the
                    merchant's, and nobody's — which is exactly the distinction
                    an acquirer needs to see. */}
                <OwnerBadge
                  step={step.id}
                  waiting={
                    completed >= step.tasks.length
                      ? waitingOn(step.id, merchant.id, handoffs, merchant.currentStep)
                      : null
                  }
                />
              </div>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {step.agentMission}
              </p>
            </div>
          </div>

          {/* Live agent status chip */}
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
              status === "running"
                ? "border-primary/40 bg-primary/10 text-primary"
                : status === "done"
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-border bg-secondary text-muted-foreground",
            )}
          >
            {status === "running" ? (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary animate-agent-ring" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
            ) : (
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  status === "done"
                    ? "bg-success"
                    : blocker
                      ? "bg-destructive"
                      : "bg-muted-foreground/60",
                )}
              />
            )}
            {status === "running"
              ? "Agent working"
              : status === "done"
                ? "Complete"
                : // "Ready" on a blocked step is a false all-clear: this is the
                  // one step that cannot be run to completion.
                  blocker
                  ? "Blocked"
                  : "Ready"}
          </span>
        </div>

        {/* Tools. Each chip says WHOSE system it is, because the product claim
            on the regulated steps is that the agent operates the acquirer's own
            stack rather than replacing it. An untagged list read as "Ingenico
            does your KYC", which is the one reading to avoid. */}
        <div className="relative mt-4 flex flex-wrap items-center gap-1.5">
          <Wrench className="mr-0.5 h-3.5 w-3.5 text-muted-foreground" />
          {step.tools.map((t) => (
            <span
              key={t.name}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px]",
                t.owner === "acquirer"
                  ? "border-primary/35 bg-primary/8 text-foreground"
                  : "border-border bg-secondary/60 text-muted-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  t.owner === "acquirer"
                    ? "bg-primary"
                    : t.owner === "ingenico"
                      ? "bg-muted-foreground/50"
                      : "bg-muted-foreground/25",
                )}
              />
              {t.name}
              <span className="sr-only">
                {t.owner === "acquirer"
                  ? " — your system"
                  : t.owner === "ingenico"
                    ? " — Ingenico system"
                    : " — external service"}
              </span>
            </span>
          ))}
          <span className="ml-1 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Yours</span> · Ingenico · external
          </span>
        </div>

        {/* Where the boundary falls, stated rather than left to be inferred
            from the chips. Only present on steps that touch your systems. */}
        {step.integration && (
          <div className="relative mt-3 flex gap-2 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
            <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-foreground">
              <span className="font-semibold">Runs inside your systems. </span>
              {step.integration}
            </p>
          </div>
        )}
      </div>

      {/* The blocker leads the step. Placed above the controls because playing
          the agent cannot clear it — the missing fact is the merchant's. */}
      {blocker && (
        <div className="border-b border-border px-5 py-4">
          <ExceptionPanel exception={blocker} merchantName={merchant.name} />
        </div>
      )}

      {/* Flagged as an exception, but nothing recorded about it. Say so on the
          step where it would have appeared — this is precisely the case that
          otherwise renders a clean, confident screen for a blocked merchant. */}
      {!blocker && detailMissing && step.id === merchant.currentStep && (
        <div className="border-b border-border px-5 py-4">
          <p className="rounded-xl border border-warning/40 bg-warning/8 px-4 py-3 text-xs leading-relaxed text-warning-foreground">
            <span className="font-semibold">
              {merchant.name} is flagged as an exception, but no detail was recorded against this
              step.
            </span>{" "}
            Treat the step as blocked. The absence of a reason here is a gap in the record, not an
            all-clear.
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/30 px-5 py-3">
        <div className="flex items-center gap-2">
          {status === "running" ? (
            <button
              onClick={pause}
              className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/70"
            >
              <Pause className="h-3.5 w-3.5" />
              Pause
            </button>
          ) : (
            <button
              onClick={play}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 glow-soft"
            >
              <Play className="h-3.5 w-3.5" />
              {completed >= step.tasks.length
                ? "Replay agent"
                : completed > 0
                  ? "Resume agent"
                  : "Play agent run"}
            </button>
          )}
          {completed > 0 && status !== "running" && (
            <button
              onClick={replay}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restart
            </button>
          )}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {Math.min(completed, step.tasks.length)}/{step.tasks.length} tasks
        </span>
      </div>

      {/* Task trace — pick a task on the left, read what it produced on the right */}
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Task list */}
        <div className="divide-y divide-border border-b border-border lg:border-b-0 lg:border-r">
          {step.tasks.map((task, i) => {
            const isDone = i < completed
            const isRunning = i === runningTaskIndex
            // A task that RAN AND FAILED is not a task that has yet to run.
            // Without this the blocking line looks exactly like the ones the
            // agent simply hasn't reached.
            const isFailed = blocker?.taskIndex === i && !isRunning
            const isPending = i >= completed && !isRunning && !isFailed
            const art = artifactFor(step.id, i, merchant)
            return (
              <button
                key={task.label}
                onClick={() => setSelected(i)}
                aria-pressed={selected === i}
                className={cn(
                  "flex w-full items-start gap-3 p-4 text-left transition-colors",
                  isRunning && "bg-primary/[0.05]",
                  selected === i ? "bg-primary/[0.08]" : "hover:bg-secondary/60",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
                    isFailed
                      ? "border-destructive/45 bg-destructive/15 text-destructive"
                      : isDone
                        ? "border-success/40 bg-success/15 text-success"
                        : isRunning
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-secondary text-muted-foreground",
                  )}
                >
                  {isFailed ? (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  ) : isDone ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : isRunning ? (
                    <Sparkles className="h-3.5 w-3.5 animate-agent-pulse" />
                  ) : (
                    i + 1
                  )}
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      isPending ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {task.label}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {task.detail}
                  </p>
                  {isFailed && (
                    <p className="mt-1 text-xs font-medium leading-relaxed text-destructive">
                      Failed — {blocker.summary}
                    </p>
                  )}
                  {/* Name the artefact on the row, so the claim and the thing
                      that backs it are never more than a click apart. */}
                  <span
                    className={cn(
                      "mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                      art
                        ? "bg-primary/10 text-primary"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {art ? (
                      <>
                        <FileSearch className="h-3 w-3" />
                        {art.title}
                      </>
                    ) : (
                      "trace only"
                    )}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* Artefact inspector — what the selected task actually produced */}
        <div className="min-h-[22rem] bg-white/35">
          <ArtifactInspector
            artifact={artifactFor(step.id, selected, merchant)}
            merchant={merchant}
            draft={draft}
              onDraft={setDraft}
              produced={selected < completed}
              theme={theme}
              onTheme={setTheme}
              edge={edge}
              onEdge={setEdge}
            />
        </div>
      </div>

      {/* Who the step is waiting on, and the one action that fits them */}
      <StepGate
        step={step.id}
        merchant={merchant}
        runComplete={completed >= step.tasks.length}
        states={handoffs}
        onStates={setHandoffs}
        precondition={precondition}
      />

      {/* Agent trace — the same ink as the rest of the page, so it reads as
          part of the surface rather than a hole punched through it. */}
      <div className="border-t border-border p-2.5">
        <div className="overflow-hidden rounded-xl border border-border/70 bg-secondary/45">
          <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
            <Terminal className="h-3.5 w-3.5 text-primary" />
            <span className="font-mono text-[11px] font-medium text-muted-foreground">
              agent · {merchant.id}
            </span>
          </div>
          <div
            ref={logRef}
            className="max-h-40 space-y-1 overflow-y-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed"
          >
            {completed === 0 && status !== "running" ? (
              <p className="text-muted-foreground/70">
                {"// press play to watch the agent work this step"}
              </p>
            ) : (
              step.tasks.slice(0, Math.max(completed, runningTaskIndex + 1)).map((task, i) => {
                const isDone = i < completed
                const isRunning = i === runningTaskIndex
                return (
                  <div key={task.label} className="animate-trace-in">
                    <span className="text-muted-foreground/55">
                      {String(i + 1).padStart(2, "0")}{"  "}
                    </span>
                    <span className={cn(isDone ? "text-primary" : "text-muted-foreground")}>
                      {traceFor(step.id, i, merchant, draft.lines, draft.serviceId) ?? task.output}
                    </span>
                    {isRunning && <span className="animate-caret text-primary">{" ▋"}</span>}
                  </div>
                )
              })
            )}
            {status === "done" && (
              <div className="animate-trace-in pt-0.5 text-success">
                {/* The mono face has no U+2713, which rendered as tofu. */}
                {"ok  agent run complete — "}
                {/* Read from LIVE state, not the static map: once a handoff is
                    settled the trace must stop saying it is waiting on them. */}
                {(() => {
                  const w = waitingOn(step.id, merchant.id, handoffs, merchant.currentStep)
                  return w === "acquirer"
                    ? "waiting on your decision"
                    : w === "merchant"
                      ? "waiting on the merchant"
                      : w === "ingenico"
                        ? "waiting on Ingenico"
                        : "nothing further required"
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The old "Your call / No action needed" footer lived here. It said
          "No action needed" on every step the acquirer did not own, including
          the ones where they must chase a merchant — and it restated in prose
          what the handoff panel now shows with live state. Two answers to one
          question is worse than one. */}

      {acquirerActionable && (
        <div className="border-t border-border bg-secondary/30 px-5 py-4">
          <button
            onClick={onOpenSignoff}
            className="inline-flex items-center gap-1.5 rounded-lg bg-warning/15 px-3 py-2 text-xs font-semibold text-warning-foreground transition-colors hover:bg-warning/25"
          >
            <UserCheck className="h-3.5 w-3.5" />
            Open the full {step.name === "Branding" ? "branding approval" : "sign-off"} screen
          </button>
        </div>
      )}
    </div>
  )
}
