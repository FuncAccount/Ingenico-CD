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
  Minus,
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
  FileStack,
  Info,
} from "lucide-react"
import {
  MERCHANTS,
  PIPELINE,
  bandTone,
  statusTone,
  type Merchant,
  type PipelineStep,
  laneState,
  shipRisk,
  REJOIN_STEP,
  type StepId,
} from "@/lib/acquirer-data"
import { cn } from "@/lib/utils"
import {
  artifactFor,
  artifactOutcome,
  blockingFinding,
  taskExceptions,
  type ExceptionContext,
  defaultBasket,
  taskDetail,
  taskSkipped,
  traceFor,
} from "@/lib/artifacts"
import {
  ArtifactInspector,
  type OrderDraft,
} from "@/components/acquirer/artifact-inspector"
import { StepGate } from "@/components/acquirer/step-gate"
import { ownerOf, waitingOn, type HandoffState } from "@/lib/handoffs"
import { blockers, checkBrand, defaultTheme, type BrandTheme } from "@/lib/branding"
import { defaultAcceptance, type AcceptanceState } from "@/lib/scheme-acceptance"
import { pendingReleases, type Releases } from "@/lib/releases"
import { edgeResolved, outstandingDocuments, type EdgeResolution } from "@/lib/underwriting"
import { useLiveMerchant } from "@/components/acquirer/demo-provider"
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
  // One choke point. Every child of this screen reads `current`, so applying
  // the simulated arrival here means the risk panel, the sign-off gate, the
  // trace and the timeline all move together — none of them can be left
  // asserting the file is still incomplete after the documents land.
  const current = useLiveMerchant(merchant ?? MERCHANTS[3])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [focusStep, setFocusStep] = useState<StepId>(current.currentStep)

  // When the merchant changes, refocus on their current step.
  useEffect(() => {
    setFocusStep(current.currentStep)
  }, [current.id, current.currentStep])

  const tone = statusTone(current.status)

  // LIFTED OUT OF THE COCKPIT so the rail can see it. The brand rules are
  // computed from this live theme, and the rail marker makes a claim about the
  // same step the cockpit does — left inside the cockpit, the rail could only
  // have read a second copy, and the two would disagree the moment anyone
  // edited the design. One source, both surfaces.
  const [theme, setTheme] = useState<BrandTheme>(() => defaultTheme(current))
  const exceptionCtx = useMemo(() => ({ brandRules: checkBrand(theme) }), [theme])

  // Which steps are carrying an unresolved finding, so the marker cannot show
  // a tick over one. Positional state alone could never know this: it only
  // tracks how far the agent has travelled, not what it found on the way.
  const findingSteps = useMemo(() => {
    const s = new Set<StepId>()
    for (const st of PIPELINE) {
      if (blockingFinding(st.id, current, exceptionCtx)) s.add(st.id)
    }
    return s
  }, [current, exceptionCtx])

  // Delegates to the model so the risk lane is read from `riskLane` rather
  // than from a position on the build path it no longer shares.
  function stepState(step: PipelineStep): StepState {
    return laneState(current, step)
  }

  const focused = PIPELINE.find((s) => s.id === focusStep)!
  const focusedState = stepState(focused)

  const doneCount = PIPELINE.filter((s) => stepState(s) === "done").length
  const pct = Math.round((doneCount / PIPELINE.length) * 100)

  // Grouped by lane, not sliced by index, so adding a step to a lane cannot
  // silently land it in the wrong branch of the fork.
  const riskLane = PIPELINE.filter((s) => s.lane === "risk")
  const buildLane = PIPELINE.filter((s) => s.lane === "build")
  const firstForkId = Math.min(...riskLane.concat(buildLane).map((s) => s.id))
  const spine = {
    before: PIPELINE.filter((s) => s.lane === "spine" && s.id < firstForkId),
    after: PIPELINE.filter((s) => s.lane === "spine" && s.id > firstForkId),
  }

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
        <div className="flex flex-col">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pipeline
          </p>
          {/* Stated here, above the diagram, rather than between the lanes and
              the rejoin — a paragraph dropped in there severs the very lines it
              is describing. */}
          <p className="px-1 pb-3 pt-1 text-[10px] leading-relaxed text-muted-foreground">
            Both lanes run at the same time and rejoin at Ship.
          </p>

          {/* Capture — the shared trunk, centred so the fork below it can
              descend symmetrically into both lanes. */}
          {spine.before.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              state={stepState(step)}
              isFocus={step.id === focusStep}
              onFocus={setFocusStep}
              connector="none"
              hasFinding={findingSteps.has(step.id)}
            />
          ))}

          {/* Lane names sit between the trunk and the arch. They are centred in
              each half (25% / 75%) while the trunk runs at 50%, so the line
              passes cleanly BETWEEN them and capture stays visibly connected to
              the fork. Below the arch they would be an arrow target, which
              reads as the branch stopping short of the step it feeds. */}
          <div className="relative flex gap-2 py-1">
            <span
              aria-hidden
              className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-border"
            />
            <LaneHeader label="Risk" />
            <LaneHeader label="Build" />
          </div>

          {/* THE FORK. Two columns side by side, because the whole point is
              that neither waits for the other — stacking them vertically is
              what made the old rail assert an order that does not exist. */}
          <ForkArch />
          <div className="flex items-stretch gap-2">
            <LaneColumn
              steps={riskLane}
              stepState={stepState}
              focusStep={focusStep}
              onFocus={setFocusStep}
              findingSteps={findingSteps}
            />
            <LaneColumn
              steps={buildLane}
              stepState={stepState}
              focusStep={focusStep}
              onFocus={setFocusStep}
              findingSteps={findingSteps}
            />
          </div>

          <RejoinArch />

          {/* Rejoined spine. */}
          {spine.after.map((step, i) => (
            <StepRow
              key={step.id}
              step={step}
              state={stepState(step)}
              isFocus={step.id === focusStep}
              onFocus={setFocusStep}
              connector={i === spine.after.length - 1 ? "none" : "down"}
              hasFinding={findingSteps.has(step.id)}
            />
          ))}
        </div>

        {/* Right: the agent trace cockpit for the focused step */}
        <StepCockpit
          step={focused}
          state={focusedState}
          merchant={current}
          onOpenSignoff={() => onOpenSignoff(current)}
          theme={theme}
          setTheme={setTheme}
          exceptionCtx={exceptionCtx}
        />
      </div>
    </div>
  )
}

/* The fork drawn as a real branch.
 *
 *  GEOMETRY, so the arms actually meet the step circles: every step centres its
 *  circle in its own column, so with two `flex-1` lanes in a `gap-2` (8px) row
 *  the circles land at `25% - 2px` and `75% + 2px` — symmetric about the trunk
 *  at 50%. The arms are pinned to exactly those x positions; anything
 *  hand-tuned drifts the moment the rail is resized.
 *
 *  Built from a bordered box with rounded corners rather than an SVG: an SVG
 *  would need either a fixed viewBox (wrong at other widths) or
 *  `preserveAspectRatio="none"`, which stretches the arrowheads into wedges.
 *  A border arch scales cleanly at any width. */
const LEFT_ARM = "left-[calc(25%-2px)]" // centre of the left lane column
const RIGHT_ARM = "right-[calc(25%-2px)]" // mirror image, so the fork is symmetric

/** Arrowhead. A CSS border triangle, not a glyph — U+25BE renders as tofu in
 *  this font stack. */
function ArrowDown({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute h-0 w-0 border-l-[3.5px] border-r-[3.5px] border-t-[5px] border-l-transparent border-r-transparent border-t-border",
        className,
      )}
    />
  )
}

/** One line in, two lines out — the split into the parallel lanes.
 *  The trunk descends from the centred capture step, then the arch carries it
 *  out to both lanes and drops an arrowhead into each. */
function ForkArch() {
  return (
    <div aria-hidden className="relative h-8">
      <span className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-border" />
      <div
        className={cn(
          "absolute bottom-1.5 top-3 rounded-t-[14px] border-l border-r border-t border-border",
          LEFT_ARM,
          RIGHT_ARM,
        )}
      />
      <ArrowDown className={cn("bottom-0 -translate-x-1/2", LEFT_ARM)} />
      <ArrowDown className={cn("bottom-0 translate-x-1/2", RIGHT_ARM)} />
    </div>
  )
}

/** Two lines in, one line out — the lanes merging back onto the spine at Ship.
 *  The exact mirror of the fork, so the regroup is as legible as the split:
 *  both arms curve inwards to the centre and a single trunk continues down. */
function RejoinArch() {
  return (
    <div aria-hidden className="relative h-8">
      <div
        className={cn(
          "absolute top-0 h-5 rounded-b-[14px] border-b border-l border-r border-border",
          LEFT_ARM,
          RIGHT_ARM,
        )}
      />
      <span className="absolute bottom-1.5 left-1/2 top-5 w-px -translate-x-1/2 bg-border" />
      <ArrowDown className="bottom-0 left-1/2 -translate-x-1/2" />
    </div>
  )
}

/** One branch of the fork. The trailing filler keeps a SHORT lane connected:
 *  the risk lane is one step against the build lane's four, so without it the
 *  regroup would appear to start from nothing on the left. */
function LaneColumn({
  steps,
  stepState,
  focusStep,
  onFocus,
  findingSteps,
}: {
  steps: PipelineStep[]
  stepState: (step: PipelineStep) => StepState
  focusStep: StepId
  onFocus: (id: StepId) => void
  findingSteps: Set<StepId>
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {steps.map((step, i) => (
        <StepRow
          key={step.id}
          step={step}
          state={stepState(step)}
          isFocus={step.id === focusStep}
          onFocus={onFocus}
          connector={i === steps.length - 1 ? "none" : "down"}
          dense
          hasFinding={findingSteps.has(step.id)}
        />
      ))}
      <div className="relative min-h-3 flex-1">
        <span
          aria-hidden
          className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-border"
        />
      </div>
    </div>
  )
}

/** One step in the rail. Extracted so the capture step, both fork lanes and
 *  the rejoined spine render through the SAME component — three copies of this
 *  markup would be three places for the state styling to drift apart. */
function StepRow({
  step,
  state,
  isFocus,
  onFocus,
  connector,
  dense,
  hasFinding,
}: {
  step: PipelineStep
  state: StepState
  isFocus: boolean
  onFocus: (id: StepId) => void
  connector: "down" | "none"
  dense?: boolean
  /** The step is behind us but something in its artefacts is unresolved. */
  hasFinding?: boolean
}) {
  // Only meaningful once the step is behind us: an upcoming step's artefacts
  // describe work nobody has done, and marking it would report a failure
  // against a step the agent has not reached.
  const flagged = hasFinding && state === "done"
  return (
    <div className="flex flex-col items-center">
      {/* THE WHOLE NODE IS THE TARGET — circle included.
          The marker used to sit outside the button, so the most icon-like,
          most obviously "the step" part of the node was the one part that did
          not respond to a click. A reader aiming at the numbered disc hit
          nothing and read the step as inert. The button now wraps marker and
          card together; it carries no box of its own, so the two keep exactly
          the positions they had (the fork arches and lane arrowheads are
          measured against the marker's centre and must not shift). */}
      <button
        onClick={() => onFocus(step.id)}
        className="group flex w-full cursor-pointer flex-col items-center focus:outline-none"
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-all",
            flagged
              ? "border-warning bg-warning/15 text-warning"
              : state === "done"
              ? "border-primary bg-primary text-primary-foreground"
              : state === "active"
                ? "border-primary bg-primary/15 text-primary glow-primary"
                : "border-border bg-card text-muted-foreground",
            // Feedback ON the marker, so it is visibly part of the target
            // rather than a decoration that happens to sit above one.
            "group-hover:ring-2 group-hover:ring-primary/25",
            "group-focus-visible:ring-2 group-focus-visible:ring-primary/60",
          )}
        >
          {/* The tick is withheld, not overdrawn: it is the whole claim this
              marker makes, and a step carrying an unresolved finding has not
              earned it. Amber rather than red — the step ran and produced its
              work, and red is already spoken for by a task that failed. */}
          {flagged ? (
            <AlertTriangle className="h-4 w-4" />
          ) : state === "done" ? (
            <Check className="h-4 w-4" />
          ) : (
            step.code
          )}
          {/* Folding the marker into the button makes it part of the button's
              accessible name, and a bare tick contributes nothing to that.
              Prefixed with "Step" because the header badge already uses the
              bare word "Complete" for a different claim — that one counts
              releases too, and two unqualified "Complete"s on one screen are
              ambiguous to a reader and to any text assertion. */}
          {state !== "upcoming" && (
            <span className="sr-only">
              {flagged
                ? "Step has an unresolved finding"
                : state === "done"
                  ? "Step complete"
                  : "Step in progress"}
            </span>
          )}
        </span>
        <div
          className={cn(
            "mt-1.5 w-full rounded-lg border text-center transition-all",
            dense ? "px-1.5 py-1.5" : "px-3 py-2",
            isFocus
              ? "border-primary/50 bg-primary/[0.06]"
              : "border-transparent group-hover:border-border group-hover:bg-secondary/50",
            "group-focus-visible:border-primary/50 group-focus-visible:bg-primary/[0.06]",
          )}
        >
          {/* NO `truncate` in a lane column: at half width "Underwrite" clipped
              to "Underw…", and a step whose name is cut to nonsense reads as a
              rendering fault rather than a narrow column. These names are one or
              two short words, so wrapping is safe. */}
          <div className="flex items-center justify-center gap-1.5">
            <span
              className={cn(
                "font-semibold leading-tight",
                dense ? "text-[13px]" : "text-sm",
                state === "upcoming" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {step.name}
            </span>
            {ownerOf(step.id) === "acquirer" && (
              <UserCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
            <span
              className={cn(
                "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold",
                bandTone(step.band),
              )}
            >
              {step.band}
            </span>
            {!dense && <OwnerBadge step={step.id} compact />}
          </div>
        </div>
      </button>
      {connector === "down" && (
        <span
          className={cn("h-5 w-px", state === "done" ? "bg-primary/60" : "bg-border")}
        />
      )}
    </div>
  )
}

/** Names a branch of the fork. Without it the two columns are just two lists
 *  and the reader has to infer why they sit side by side. */
function LaneHeader({ label }: { label: string }) {
  return (
    <p className="min-w-0 flex-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </p>
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
  theme,
  setTheme,
  exceptionCtx,
}: {
  step: PipelineStep
  state: StepState
  merchant: Merchant
  onOpenSignoff: () => void
  theme: BrandTheme
  setTheme: (t: BrandTheme) => void
  exceptionCtx: ExceptionContext
}) {
  // Null unless the risk lane is genuinely outstanding — see the banner below.
  const rejoinRisk = shipRisk(merchant)

  // How many tasks have completed. Upcoming steps start at 0 (preview),
  // done steps start fully complete, the active step invites you to play.
  const initialProgress = state === "done" ? step.tasks.length : 0
  const [completed, setCompleted] = useState(initialProgress)
  const [status, setStatus] = useState<RunStatus>(
    state === "done" ? "done" : "idle",
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  /** Steps reset by hand, and so driven live from here rather than read back
   *  as history.
   *
   *  Two things consult it. This component is rendered ONCE with no `key`, so
   *  it survives step navigation while the effect below re-derives progress
   *  from the pipeline — without the flag a reset stage came back reading
   *  "Complete" while its handoffs and output stayed cleared, the badge
   *  asserting a run whose results were gone. And `StepGate` falls back to
   *  `settledState` for any step behind the merchant's position, so the gate
   *  reported "Step clear · Returned by Ingenico" no matter what the reset
   *  did to the handoff map.
   *
   *  Never auto-cleared. A reset stage stays live for the rest of the session,
   *  which is what lets you run it AND then work its handoffs by hand — the
   *  behaviour the button exists to expose. */
  const resetSteps = useRef<Set<StepId>>(new Set())

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

  // The underwriting determination lives here rather than inside the panel
  // that draws it, because the sign-off gate has to read it. `theme` used to
  // sit beside it and now arrives as a prop — it went one level higher still,
  // so the rail marker and this cockpit judge the design by the same rules.
  const [edge, setEdge] = useState<EdgeResolution | undefined>(undefined)

  // Scheme acceptance. Lifted for the same reason: the requested set and the
  // instructions already sent have to survive stepping away from the panel.
  const [acceptance, setAcceptance] = useState<AcceptanceState>(() =>
    defaultAcceptance(merchant),
  )

  // What the acquirer has actually released. Lifted for a third reason on top
  // of survival: the step badge has to read it, or it reports "Complete" over
  // a dispatch nobody has sent.
  const [releases, setReleases] = useState<Releases>({})

  // The order draft is shared by the basket, stock, delivery and pricing
  // artefacts, so changing a quantity moves every downstream figure.
  const [draft, setDraft] = useState<OrderDraft>(() => ({
    lines: defaultBasket(merchant),
    serviceId: "standard",
    requestedIso: null,
  }))

  // What this stage can WRITE, derived from the artefacts it actually
  // produces rather than a hardcoded step number. `theme`, `edge` and `draft`
  // are hoisted here so later steps can read them, which means a reset has to
  // know which stage OWNS each one — and a hardcoded map would quietly go
  // stale the moment an artefact moved to a different step, leaving state
  // behind that the button claimed to have cleared.
  const stageWrites = useMemo(() => {
    const kinds = new Set(
      step.tasks.map((_, i) => artifactFor(step.id, i, merchant)?.kind).filter(Boolean),
    )
    return {
      draft:
        kinds.has("basket") ||
        kinds.has("stock") ||
        kinds.has("delivery") ||
        kinds.has("pricing"),
      theme: kinds.has("brand"),
      edge: kinds.has("edge"),
      acceptance: kinds.has("acceptance"),
    }
  }, [step.id, step.tasks, merchant])

  const stagePrefix = `${merchant.id}:${step.id}:`

  // Read during render rather than held in state: every mutation of the set is
  // paired with a state update in the same handler, so the render that follows
  // always sees the current value — and as a dependency it would re-trigger
  // the navigation effect below.
  const stageReset = resetSteps.current.has(step.id)

  // Is there anything to reset? Derived by comparing against the pristine
  // values rather than tracked with a "touched" flag, which would have to be
  // cleared in every path that resets and goes wrong the first time one is
  // missed. Nothing to undo means the control does not offer itself.
  // `completed > 0`, not "differs from the pipeline baseline": now that a
  // reset lands at zero, comparing against a done step's baseline of 4/4 left
  // the control on screen forever, offering to clean a stage already clean.
  // Any progress showing is progress that can be cleared.
  const stageDirty =
    completed > 0 ||
    Object.keys(handoffs).some((k) => k.startsWith(stagePrefix)) ||
    (stageWrites.edge && edge !== undefined) ||
    (stageWrites.theme &&
      JSON.stringify(theme) !== JSON.stringify(defaultTheme(merchant))) ||
    (stageWrites.acceptance &&
      JSON.stringify(acceptance) !== JSON.stringify(defaultAcceptance(merchant))) ||
    (stageWrites.draft &&
      JSON.stringify(draft) !==
        JSON.stringify({
          lines: defaultBasket(merchant),
          serviceId: "standard",
          requestedIso: null,
        }))

  // Reset the run whenever the focused step (or merchant) changes.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    // A hand-reset step stays reset until it is run again, rather than being
    // re-derived back to "done" from the merchant's pipeline position.
    const wasReset = resetSteps.current.has(step.id)
    const showDone = state === "done" && !wasReset
    setCompleted(showDone ? step.tasks.length : 0)
    setStatus(showDone ? "done" : "idle")
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
    // An instruction sent about one merchant must never show against another.
    setAcceptance(defaultAcceptance(merchant))
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
  /** Re-run the trace from the first task. PROGRESS ONLY — a chase already
   *  sent, a palette already chosen and a basket already edited all stand,
   *  because watching the agent work again is not the same as undoing it. */
  function replay() {
    if (timer.current) clearTimeout(timer.current)
    setCompleted(0)
    setStatus("running")
  }

  /** Put the stage back to how it was before anyone touched it.
   *
   *  This used to be the SAME CALL as `replay`, so the two buttons did one
   *  thing under two names and the stage could never be returned to a clean
   *  state — handoffs, the determination, the palette and the basket all
   *  survived, so a second run showed the leftovers of the first rather than
   *  the real first-run behaviour.
   *
   *  Lands PENDING — zero tasks run, status idle — even on a step the
   *  merchant has already moved past. Restoring a completed step to
   *  "Complete" was the same defect one level up: the button cleared the
   *  handoffs and the saved output, then put the badge back to a verdict
   *  nothing on screen still supported, and the first-run behaviour it exists
   *  to expose stayed invisible. Idle rather than running, because the point
   *  is to reach the state you can press Play from — auto-running would
   *  immediately spend the clean state it just restored. */
  function restart() {
    if (timer.current) clearTimeout(timer.current)
    resetSteps.current.add(step.id)
    setCompleted(0)
    setStatus("idle")
    setSelected(0)

    // Only THIS stage's handoffs. The map is shared across every step, so
    // clearing all of it would silently undo a chase raised on another one.
    setHandoffs((prev) => {
      const next: Record<string, HandoffState> = {}
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith(stagePrefix)) next[k] = v
      }
      return next
    })

    // Only the outputs this stage owns — resetting the determination from the
    // Order stage would discard an underwriting decision made two steps back.
    if (stageWrites.draft) {
      setDraft({ lines: defaultBasket(merchant), serviceId: "standard", requestedIso: null })
    }
    if (stageWrites.theme) setTheme(defaultTheme(merchant))
    if (stageWrites.acceptance) setAcceptance(defaultAcceptance(merchant))
    if (stageWrites.edge) setEdge(undefined)
  }

  const acquirerActionable =
    (step.acquirerRole === "signs-off" || step.acquirerRole === "approves") &&
    state === "active" &&
    merchant.status === "Needs sign-off"

  const runningTaskIndex = status === "running" ? completed : -1

  // Counted from the same predicate the task rows render, so the header and
  // the list cannot disagree about how many tasks this order actually has.
  const skippedCount = step.tasks.filter((_, i) => taskSkipped(step.id, i, merchant)).length
  const runnableCount = step.tasks.length - skippedCount

  // Read out of this step's own artefacts. A step can finish every task and
  // still not have passed — the run is what turns the finding up.
  const finding = useMemo(
    () => blockingFinding(step.id, merchant, exceptionCtx),
    [step.id, merchant, exceptionCtx],
  )

  // Per-task census of failures the artefacts themselves record. Same call the
  // step badge resolves through, so a row cannot show a tick under a badge
  // reporting a finding, nor the reverse.
  const exceptions = useMemo(
    () => taskExceptions(step.id, merchant, step.tasks.length, exceptionCtx),
    [step.id, merchant, step.tasks.length, exceptionCtx],
  )

  // Counted with the ROW'S OWN predicate rather than the map's size, so the
  // header cannot report a number the list does not show: an artefact exists
  // whether or not the agent has reached it, and a task that failed or halted
  // already states a stronger outcome on its row.
  const exceptionCount = useMemo(
    () =>
      [...exceptions.keys()].filter(
        (i) => i < completed && blocker?.taskIndex !== i && finding?.taskIndex !== i,
      ).length,
    [exceptions, completed, blocker, finding],
  )
  // A halted task ran and produced nothing. Counting it as complete gave
  // "5/5 tasks" directly above a panel saying the run had stopped.
  const haltedCount = finding?.taskIndex !== undefined ? 1 : 0

  // Checks this step ASKED FOR that have not come back yet.
  //
  // "Every task ran" and "every answer arrived" are different claims, and the
  // parallel lanes made the gap between them routine: KYC dispatches a liveness
  // check to a provider and the file legitimately moves on. The badge read
  // "Complete" directly above a spinner saying otherwise — the same defect this
  // file already fixed for held dispatches and halted runs, one register lower.
  // Counted off the artefacts themselves so the badge and the panel beneath it
  // are reading one source and cannot drift apart.
  const outstandingChecks = useMemo(() => {
    let n = 0
    for (let i = 0; i < step.tasks.length; i++) {
      const a = artifactFor(step.id, i, merchant)
      if (a?.kind === "checks") n += a.rows.filter((r) => r.state === "running").length
    }
    return n
  }, [step.id, merchant, step.tasks.length])

  // Commits this step has PREPARED that the acquirer has not released yet.
  //
  // Third instance of one defect, now in its most consequential form: the
  // badge said "Complete · 4/4 tasks" over a CRM write and a merchant notice
  // that were both still sitting there unsent. The agent finishing its work
  // and the work having left are different claims, and on the step that closes
  // the file the difference is a customer either being told they are live or
  // not. Counted off the artefacts, like the two above it.
  const heldReleases = useMemo(
    () => pendingReleases(step.id, merchant, completed, releases),
    [step.id, merchant, completed, releases],
  )

  // What stops the acquirer's own decision on THIS step. Different steps are
  // blocked by different things, so this is computed per step rather than by
  // one shared "is everything fine" flag that could not name its own blocker.
  const precondition = useMemo<string | null>(() => {
    // Checked BEFORE the edge case. An unscoreable file is not a decision the
    // acquirer can take at all, so inviting them to resolve the edge case
    // first would walk them up to a sign-off that must not happen — and the
    // edge case here is itself a consequence of the missing ownership
    // statement, so it cannot be determined until that document lands.
    if (step.id === 2) {
      const missing = outstandingDocuments(merchant)
      if (missing.length > 0) {
        return `Risk is not scored — ${missing.length} mandatory document${
          missing.length === 1 ? "" : "s"
        } outstanding. There is no assessment to sign off yet.`
      }
    }
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
                : // A step where nothing applied is not a success. Green here
                  // would read as work delivered on an order that had none.
                  status === "done" && runnableCount > 0
                  ? // A halt stops the journey; a finding lets it continue
                    // with something to answer. Same colour for both would
                    // make the stop look survivable.
                    finding?.taskIndex !== undefined
                    ? "border-destructive/40 bg-destructive/12 text-destructive"
                    : finding
                      ? "border-warning/40 bg-warning/15 text-warning-foreground"
                      : "border-success/30 bg-success/10 text-success"
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
                  status === "done" && runnableCount > 0
                    ? finding?.taskIndex !== undefined
                      ? "bg-destructive"
                      : finding
                        ? "bg-warning"
                        : // Waiting is not a warning. Amber here would raise an
                          // alarm about a check that is proceeding normally, and
                          // green would assert a result nobody has returned.
                          outstandingChecks > 0
                          ? "bg-muted-foreground/60"
                          : // A held release is not an alarm either — nothing
                            // has gone wrong, the acquirer simply has not
                            // pressed it yet — but green would claim the step
                            // had finished, which is the thing it has not done.
                            heldReleases > 0
                            ? "bg-primary"
                            : "bg-success"
                    : blocker
                      ? "bg-destructive"
                      : "bg-muted-foreground/60",
                )}
              />
            )}
            {status === "running"
              ? "Agent working"
              : status === "done"
                ? runnableCount === 0
                  ? "Not applicable"
                  : // Every task ran, but the run turned something up. Saying
                    // "Complete" over a held dispatch would be the badge
                    // contradicting the record directly beneath it.
                    finding?.taskIndex !== undefined
                    ? "Halted"
                    : finding
                      ? "Finding"
                      : // Reports the outstanding count rather than a verdict:
                        // the step is genuinely waiting, not finished and not
                        // stuck, and that is a third thing.
                        outstandingChecks > 0
                        ? `${outstandingChecks} awaiting`
                        : // Named as YOURS, not as a bare count: an
                          // outstanding check is waiting on someone else,
                          // whereas this is waiting on the reader.
                          heldReleases > 0
                          ? `${heldReleases} to release`
                          : "Complete"
                : // "Ready" on a blocked step is a false all-clear: this is the
                  // one step that cannot be run to completion.
                  blocker
                  ? "Blocked"
                  : "Ready"}
          </span>
        </div>

        {/* The PRIMARY source only.
        
            The enrichment sources were briefly drawn here too, as a
            "Corroborated against" chip row — and the screenshot killed it: the
            registry, the CRM and web research are all tools as well as sources,
            so three of the four names appeared twice on consecutive lines. Two
            near-identical chip rows read as a rendering fault, and the
            tool/source distinction is far too fine to be worth that. The chips
            below already say whose system each one is, which is the part a
            reader acts on; corroboration is now stated in the step's own
            mission line instead.
        
            What survives here is the one source no tool row can express: the
            merchant's own bundle is not a system the agent operates, it is the
            material the application is made of. Drawn as a band rather than a
            pill for the same reason — on capture it outweighs everything
            layered on top of it. */}
        {step.sources
          ?.filter((s) => s.role === "primary")
          .map((s) => (
            <div
              key={s.name}
              className="relative mt-4 flex gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2"
            >
              <FileStack className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">{s.name}</span>
                <span className="ml-1.5 rounded bg-foreground/8 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
                  primary source
                </span>
                <span className="mt-0.5 block">{s.detail}</span>
              </p>
            </div>
          ))}

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

        {/* A precondition, not an achievement. Kept visually quieter than the
            integration note above it: that one describes work being done, this
            one describes work that happened before the step opened. */}
        {step.assumes && (
          <div className="mt-2 flex gap-2 rounded-lg border border-border/70 bg-secondary/50 px-3 py-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Assumes </span>
              {step.assumes}
            </p>
          </div>
        )}
      </div>

      {/* THE REJOIN. Ship is where the two lanes meet, so it is the one step
          that can be reached with the other lane unfinished. Deliberately a
          warning and not a block (a product decision), which means the banner
          carries the entire claim: it is non-dismissible, names the actual
          state rather than a generic "not ready", and says what shipping now
          would mean. `shipRisk` returns null when cleared, so this cannot
          render as an empty box implying a check that found nothing. */}
      {step.lane === "spine" && step.id === REJOIN_STEP && rejoinRisk && (
        <div className="border-b border-border px-5 py-4">
          <div className="flex gap-2.5 rounded-lg border border-destructive/40 bg-destructive/[0.07] px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-semibold text-foreground">{rejoinRisk.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {rejoinRisk.detail} The build lane does not wait for underwriting, so reaching this
                step is not itself an approval.
              </p>
            </div>
          </div>
        </div>
      )}

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
          {/* Gated on "is there anything to undo", not on progress alone: a
              chase raised before the run was played is still a change to the
              stage, and the control has to be reachable to clear it. */}
          {stageDirty && status !== "running" && (
            <button
              onClick={restart}
              title="Clear this stage's progress, handoffs and saved output, back to its untouched state"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset stage
            </button>
          )}
        </div>
        {/* The denominator counts tasks that CAN run here. On a software-only
            order the ship step has four tasks and none of them apply, so a
            plain 4/4 would report a completed step that never happened —
            the skipped ones are named separately rather than absorbed. */}
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {skippedCount > 0 ? (
            runnableCount === 0 ? (
              <>0 tasks apply · {skippedCount} skipped</>
            ) : (
              <>
                {/* Clamped for the same reason as the halted branch below. */}
                {Math.max(0, Math.min(completed, step.tasks.length) - skippedCount)}/
                {runnableCount} tasks · {skippedCount} skipped
                {exceptionCount > 0 &&
                  ` · ${exceptionCount} exception${exceptionCount === 1 ? "" : "s"}`}
              </>
            )
          ) : (
            <>
              {/* Clamped at 0. The subtraction assumes the halted task sits
                  INSIDE `completed`, which is false when the run halts before
                  ever reaching it — a file that stops on its first task showed
                  "-1/4 tasks", a negative count of work done. */}
              {Math.max(0, Math.min(completed, step.tasks.length) - haltedCount)}/
              {step.tasks.length} tasks
              {haltedCount > 0 && " · 1 halted"}
              {/* Appended, never deducted. Unlike a halted task, a task with an
                  exception ran and produced its artefact — shrinking the
                  numerator would deny work the agent actually did. What is
                  wrong is the result, and that is what the suffix names. */}
              {exceptionCount > 0 &&
                ` · ${exceptionCount} exception${exceptionCount === 1 ? "" : "s"}`}
              {/* Appended rather than deducted from the count: unlike a halted
                  task, a task awaiting release DID run and did produce its
                  artefact. Shrinking the numerator would deny the agent work
                  it actually did; the outstanding thing is the dispatch. */}
              {heldReleases > 0 && ` · ${heldReleases} to release`}
            </>
          )}
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
            // A task that cannot run on this order is neither done nor
            // pending. It takes precedence over both, or a green tick ends up
            // asserting work the artefact beside it says never happened.
            const isSkipped = taskSkipped(step.id, i, merchant)
            // The agent reached this task and REFUSED to produce its output,
            // because the evidence it needs is not on file. That is neither
            // done nor failed: nothing went wrong, and nothing was produced.
            // A tick here would credit the agent with a score it declined to
            // compute — the exact claim this stop exists to prevent.
            const isHalted = finding?.taskIndex === i && !isRunning
            // The task RAN, produced its artefact, and that artefact records a
            // failure. Gated on `isDone` because before the task runs there is
            // no result to report — the artefacts are derived from the merchant
            // and exist whether or not the agent has reached them, so an
            // ungated read would condemn work nobody has started. Ranked below
            // failed and halted: those already state a stronger outcome, and
            // two verdicts on one row is worse than the tick was.
            const exception =
              isDone && !isFailed && !isHalted && !isSkipped ? exceptions.get(i) : undefined
            const isPending = i >= completed && !isRunning && !isFailed && !isHalted
            const art = artifactFor(step.id, i, merchant)
            const outcome = artifactOutcome(art)
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
                    isSkipped
                      ? "border-dashed border-border bg-transparent text-muted-foreground"
                      : isFailed
                        ? "border-destructive/45 bg-destructive/15 text-destructive"
                        : isHalted
                          ? "border-destructive/45 bg-destructive/15 text-destructive"
                          : exception
                            ? "border-destructive/45 bg-destructive/15 text-destructive"
                            : isDone
                              ? "border-success/40 bg-success/15 text-success"
                              : isRunning
                                ? "border-primary bg-primary/15 text-primary"
                                : "border-border bg-secondary text-muted-foreground",
                  )}
                >
                  {isSkipped ? (
                    <Minus className="h-3.5 w-3.5" />
                  ) : isFailed ? (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  ) : isHalted ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : exception ? (
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
                    {taskDetail(step.id, i, merchant, task.detail)}
                  </p>
                  {isFailed && (
                    <p className="mt-1 text-xs font-medium leading-relaxed text-destructive">
                      Failed · {blocker.summary}
                    </p>
                  )}
                  {isHalted && !isFailed && (
                    <p className="mt-1 text-xs font-medium leading-relaxed text-destructive">
                      Halted · {finding!.headline}
                    </p>
                  )}
                  {/* Named "Exception", not "Failed": the task did its job and
                      the thing it examined is what fell short. The detail is on
                      the row rather than behind the click, because a red mark
                      whose reason is hidden only tells you to go looking. */}
                  {exception && (
                    <p className="mt-1 text-xs font-medium leading-relaxed text-destructive">
                      Exception · {exception.headline}
                      <span className="block font-normal text-muted-foreground">
                        {exception.detail}
                      </span>
                    </p>
                  )}
                  {/* The verdict, on the row. Naming the artefact told you
                      where to look but not what it found, so "did the load
                      work?" needed a click. GATED ON `isDone`: a headline like
                      "Load successful" on a task that has not run yet would
                      report a result for work nobody has done — and it is
                      withheld when the task failed, halted or was skipped,
                      each of which already states its own outcome above and
                      would otherwise be contradicted by the artefact's. */}
                  {/* `!exception` too: a records artefact whose own outcome is
                      the failure would otherwise print the same verdict twice,
                      once as an exception and once as its headline. */}
                  {isDone && !isSkipped && !isFailed && !isHalted && !exception && outcome && (
                    <p
                      className={cn(
                        "mt-1 text-xs font-medium leading-relaxed",
                        outcome.state === "ok" && "text-success",
                        outcome.state === "warn" && "text-warning",
                        outcome.state === "fail" && "text-destructive",
                      )}
                    >
                      {outcome.headline}
                    </p>
                  )}
                  {/* Name the artefact on the row, so the claim and the thing
                      that backs it are never more than a click apart. */}
                  <span
                    className={cn(
                      "mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                      isSkipped
                        ? "bg-secondary text-muted-foreground"
                        : art
                          ? "bg-primary/10 text-primary"
                          : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {isSkipped ? (
                      "Skipped — no hardware on this order"
                    ) : art ? (
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
              acceptance={acceptance}
              onAcceptance={setAcceptance}
              stepId={step.id}
              taskIndex={selected}
              releases={releases}
              onReleases={setReleases}
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
        wasReset={stageReset}
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
