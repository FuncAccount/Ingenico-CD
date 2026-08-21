"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronDown,
  Clock,
  Cpu,
  FileSearch,
  Lock,
  Minus,
  Store,
  Pause,
  PartyPopper,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserCheck,
  Wrench,
  Plug,
  FileStack,
  Info,
} from "lucide-react"
import {
  PIPELINE,
  bandTone,
  statusTone,
  type Merchant,
  type PipelineStep,
  laneState,
  blockingPredecessor,
  openingStep,
  NO_SESSION_PROGRESS,
  REJOIN_STEP,
  type StepId,
} from "@/lib/acquirer-data"
import { decisionAtStep, liveDecisionAtStep } from "@/lib/decisions"
import { decisionBasis } from "@/lib/decision-basis"
import { useDecisions } from "@/components/acquirer/decisions-provider"
import { useBrandTheme } from "@/components/acquirer/brand-theme-provider"
import { InProgressTag, PulseDot } from "@/components/acquirer/in-progress-tag"
import { DelegationChip, DelegationTrace, type Beat } from "@/components/acquirer/delegation-trace"
import { clearanceLine, shipClearance } from "@/lib/ship-clearance"
import { cn } from "@/lib/utils"
import {
  artifactFor,
  artifactOutcome,
  blockingFinding,
  haltedSteps,
  outstandingChecks as countOutstandingChecks,
  stepHasRun,
  stepUnresolved,
  taskExceptions,
  type ExceptionContext,
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
import { useProgress } from "@/components/acquirer/progress-provider"
import { useBook } from "@/components/acquirer/book-provider"
import { defaultAcceptance, type AcceptanceState } from "@/lib/scheme-acceptance"
import { pendingReleases, type Releases } from "@/lib/releases"
import { CAPTURE_STEP, edgeResolved, outstandingDocuments, type EdgeResolution } from "@/lib/underwriting"
import { withClearedFindings } from "@/lib/demo-fixes"
import { useDemo, useLiveMerchant, responseKey } from "@/components/acquirer/demo-provider"
import { DemoInbound } from "@/components/acquirer/demo-control"
import { exceptionDetailMissing, exceptionOnStep } from "@/lib/exceptions"
import { ExceptionPanel } from "@/components/acquirer/exception-panel"

type StepState = "done" | "active" | "upcoming"

const STATE_WORD: Record<StepState, string> = {
  done: "complete",
  active: "in progress",
  upcoming: "not started",
}

/**
 * One step of the header track — and the reason the header now has a track at
 * all rather than a bar.
 *
 * What sat here was `<div style={{ width: `${pct}%` }} />`: a single fill over
 * `doneCount / 11`. The count was honest (it came from `laneState`, same as
 * everything else) but the SHAPE was not, in two ways that compounded.
 *
 * A continuous fill claims a POSITION ALONG ONE PATH. The pipeline forks, and
 * the sentence directly beneath the bar says so — "Both lanes run at the same
 * time and rejoin at Ship." At 36% the fill edge landed in the middle of the
 * bar, which corresponded to no step, no lane and no moment; a merchant with
 * the whole build lane done and the whole risk lane untouched drew the exact
 * same bar as one halfway down both. The estate table had already been through
 * this and fixed it — its MiniTrack draws the fork as two rows sharing one
 * span — so the flat bar was the last surface still asserting a single file of
 * eleven sequential steps, on the one page that draws the fork full size.
 *
 * And it carried NO PER-STEP DATA. A percentage is an aggregate; there was
 * nothing in it that could be pointed at a step, which is why the bar and the
 * diagram could not be connected even in principle. Each segment is now a step
 * — its width comes from the lane it sits in, its tone from the same
 * `stepState` the rail reads, and clicking it focuses that step in the diagram
 * below. The link is the data, not a coincidence of layout.
 */
function TrackSeg({
  step,
  state,
  focused,
  thin,
  onFocus,
}: {
  step: PipelineStep
  state: StepState
  focused: boolean
  /** Lane segments are lighter than trunk segments: two of them stack in the
   *  height one trunk step occupies, which is what makes the fork read as one
   *  span rather than as extra steps. */
  thin?: boolean
  onFocus: (id: StepId) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onFocus(step.id)}
      title={`${step.code} ${step.name} — ${STATE_WORD[state]}`}
      aria-label={`${step.code} ${step.name}, ${STATE_WORD[state]}. Show this step in the diagram`}
      aria-current={focused ? "step" : undefined}
      className={cn(
        "min-w-0 flex-1 rounded-full transition-all hover:opacity-70",
        thin ? "h-[5px]" : "h-2.5",
        state === "done"
          ? "bg-primary"
          : state === "active"
            ? "bg-primary/60"
            : "bg-border",
        focused && "ring-2 ring-primary/50 ring-offset-2 ring-offset-background",
      )}
    />
  )
}

/**
 * Why a step's run is refused, in the refusal's own words.
 *
 * Every field travels WITH the reason rather than being decided at the point
 * of display, because there is now more than one kind of block and they mean
 * opposite things: a held dispatch is a warning about a file that failed its
 * checks, an unreached step is the ordinary state of work that has not started.
 * When the label was a single hardcoded string, focusing an unreached build
 * step showed "Release withheld" — Ship's wording, on a step that dispatches
 * nothing.
 */
type RunBlock = {
  /** Short status word for the step badge. */
  badge: string
  /** What the disabled run button says instead of "Play agent run". */
  action: string
  /** The full sentence, naming what is being waited on. */
  reason: string
  /** Neutral = not its turn yet, warning = held, destructive = something failed. */
  tone: "neutral" | "warning" | "destructive"
}

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
  // The book, so the picker offers merchants submitted this session and every
  // row reflects an edited basket.
  const { merchants: book } = useBook()
  // `merchant` is already the live record from the page; the fallback only
  // matters when the journey is opened with nothing selected.
  const current = useLiveMerchant(merchant ?? book[3] ?? book[0])
  const [pickerOpen, setPickerOpen] = useState(false)
  /* The focus state used to be declared here and opened the file on
     `current.currentStep`. It now lives below `flaggedSteps`, because deciding
     where to open a file requires knowing which steps are actually reachable,
     and that set is not computed until then. */

  const tone = statusTone(current.status)

  // LIFTED OUT OF THE COCKPIT so the rail can see it. The brand rules are
  // computed from this live theme, and the rail marker makes a claim about the
  // same step the cockpit does — left inside the cockpit, the rail could only
  // have read a second copy, and the two would disagree the moment anyone
  // edited the design. One source, both surfaces.
  // ...and lifted again, out of this component and into a provider, so the
  // SIGN-OFF SCREEN can read it too. While it lived here, "Approve branding"
  // over there committed a decision about a design that surface had never seen.
  // Keyed per merchant inside the provider, which is why the merchant-change
  // effect below no longer has to reset it: each file carries its own.
  const { themeFor, setTheme: writeTheme, resetTheme, hasOverride } = useBrandTheme()
  const theme = themeFor(current)
  const setTheme = useCallback(
    (t: BrandTheme) => writeTheme(current.id, t),
    [writeTheme, current.id],
  )
  const exceptionCtx = useMemo(() => ({ brandRules: checkBrand(theme) }), [theme])

  /* AN APPROVAL IS EVIDENCE ABOUT A PARTICULAR DESIGN, NOT A PERMANENT
     PROPERTY OF THE STEP.

     Approve the branding, then correct the design, and the approval on file is
     about something that no longer exists — yet it went on rendering as a
     settled green row, and a settled row shows no controls, so there was no way
     to approve the corrected design. The gate reported the work done while
     displaying work nobody had signed.

     One writer, here, above every step: the design is a property of the
     merchant, so a check that only ran on the focused step would miss an edit
     made anywhere else. `reconcile` returns the same object when nothing has
     moved, which is what keeps this effect from re-firing on its own output. */
  const { reconcile } = useDecisions()
  useEffect(() => {
    reconcile(
      current.id,
      new Map(PIPELINE.map((s) => [s.id, decisionBasis(s.id, current, theme)])),
    )
  }, [current, theme, reconcile])

  /* WHAT THIS SESSION HAS FINISHED, AND WHAT IT HAS RUN, per merchant.

     `merchant.currentStep` is a fixture and is never written — completing a
     step used to change nothing at all, so an approved B1 kept reporting itself
     as unfinished and the file never advanced. This is the missing write.

     Keyed by merchant id because progress belongs to a file, not to the screen:
     without the key, finishing B1 for one merchant would mark B1 done for
     whoever you looked at next.

     Held in a provider ABOVE the screen switch, not in this component. It was
     `useState` here, and because `app/page.tsx` renders one screen at a time,
     opening the full sign-off screen unmounted this journey and took the record
     with it — so approving a step destroyed the evidence of every step already
     done, and Ship kept withholding a shipment whose prerequisites had all
     passed. See ProgressProvider.

     Read FIRST, above every derivation below, because findings, check counts
     and the rail all now depend on what has actually run. */
  const { progressFor, markDone, clearStep, playedFor, markPlayed, resetFor } = useProgress()
  const progressed = progressFor(current.id)
  const played = playedFor(current.id)
  /* Stages explicitly reset. A third set rather than a subtraction from the two
     above, because those can only retire progress made THIS session — a step
     the fixture already places behind the merchant's position was never in
     either, so clearing it was a no-op and the rail went on drawing a solid
     completion tick beside a cockpit reading "Ready · 0/4 tasks". */
  const wasReset = resetFor(current.id)

  // Which steps are carrying an unresolved finding, so the marker cannot show
  // a tick over one. Positional state alone could never know this: it only
  // tracks how far the agent has travelled, not what it found on the way.
  //
  // This set now drives the STATE MODEL as well as the marker. It used to feed
  // the marker alone, which is why Branding could draw a halt while Configure
  // and Test — which consume its output — drew ticks beneath it.
  const findingSteps = useMemo(
    () => haltedSteps(current, exceptionCtx, played),
    [current, exceptionCtx, played],
  )

  /* Steps whose checks came back WITHOUT an answer. Kept out of the set above
     on purpose — that one drives the state model, and a registry that did not
     reply must not push the file's position backwards. This only reaches the
     rail marker, so the tick is withheld where the panel says something is
     unresolved, and nothing else changes. */
  const unresolvedSteps = useMemo(() => {
    const out = new Set<StepId>()
    for (const s of PIPELINE) {
      if (stepUnresolved(s.id, current, exceptionCtx, played)) out.add(s.id)
    }
    return out
  }, [current, exceptionCtx, played])

  /* What the RAIL marks: a finding or an unresolved check. Merged once here
     rather than at each call site, because the trunk and the two lane columns
     draw the same pipeline — KYC is a lane step, so a merge applied only to the
     trunk would leave the very node this fix is about still ticked green. */
  const flaggedSteps = useMemo(
    () => new Set<StepId>([...findingSteps, ...unresolvedSteps]),
    [findingSteps, unresolvedSteps],
  )

  /* WHERE TO OPEN THE FILE. See `openingStep`: a file records the step its
     attention sits on, which is regularly a step nobody can act on yet, so
     opening there lands the reader on a disabled run control and an empty
     artefact pane while the real work sits behind them. */
  const [focusStep, setFocusStep] = useState<StepId>(() => openingStep(current, flaggedSteps))

  /* THE HALTS ARE READ THROUGH A REF ON PURPOSE — do not "fix" this by adding
     `flaggedSteps` to the dependency array.
  
     The trigger for re-landing is the FILE CHANGING, not the halts changing.
     The halts move constantly during normal use: every run, every resolved
     check, every brand edit produces a new set. In the deps that would re-fire
     the landing mid-session and yank the panel out from under someone who had
     deliberately opened a different step — the reader would lose their place
     for pressing a button that worked. The ref keeps the trigger narrow while
     still reading a current set when it does fire. */
  const haltsRef = useRef(flaggedSteps)
  haltsRef.current = flaggedSteps

  /* Deps are the FILE'S IDENTITY AND RECORDED POSITION, exactly as before —
     not `current` itself, which `useLiveMerchant` hands back as a fresh object
     on every update and which would therefore re-land the reader continuously. */
  useEffect(() => {
    setFocusStep(openingStep(current, haltsRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id, current.currentStep])

  // How many checks each step is still waiting on, so the rail marker cannot
  // show a finished tick over one either.
  //
  // The rail was the worst of the three surfaces: KYC dispatches a liveness
  // check, the file moves on, and R1 drew a solid tick �� the strongest claim
  // the marker can make — over a check nobody had answered. The merchant is
  // legitimate and simply waiting on a provider, and nothing on the rail said
  // so, so the wait was invisible until someone opened the one task holding
  // the open row.
  const awaitingSteps = useMemo(() => {
    const m = new Map<StepId, number>()
    for (const st of PIPELINE) {
      const n = countOutstandingChecks(st.id, current, played)
      if (n > 0) m.set(st.id, n)
    }
    return m
  }, [current, played])

  /* Recorded when a run STARTS, which is what makes it usable as evidence that
     a check happened at all. Reported up here beside `markStepDone` because the
     rail reads it too: without it the rail would keep drawing "not started"
     under a cockpit that had just run. */
  const markStepPlayed = useCallback(
    (id: StepId) => markPlayed(current.id, id),
    [markPlayed, current.id],
  )

  const markStepDone = useCallback((id: StepId) => markDone(current.id, id), [markDone, current.id])
  // The counterpart, for a stage reset. Reported UP for the same reason
  // `markStepDone` is: the rail reads this set, and a reset it cannot see left
  // the amber finding marker sitting on a stage that had just been cleared.
  const clearStepDone = useCallback((id: StepId) => clearStep(current.id, id), [clearStep, current.id])

  // Delegates to the model so the risk lane is read from `riskLane` rather
  // than from a position on the build path it no longer shares.
  function stepState(step: PipelineStep): StepState {
    /* BOTH SETS, because they answer two different questions.
    
       `flaggedSteps` (findings + unresolved) decides whether a step may draw
       its own tick: KYC waiting on a registry that never replied is not
       finished, and it used to show a solid tick over that unanswered check.
    
       `findingSteps` decides what STOPS THE STEPS BEHIND IT. Fixing the tick
       above by passing the union here as well overshot — it made an unanswered
       check veto its whole lane, so Summit Sports ran R3 Underwriting to 4/4
       with the badge reading "Complete" and "Step clear" while the rail kept
       R2 and R3 as plain circles and the progress count sat at 4/11. Nothing
       had been judged against that merchant; one provider had simply not
       answered.
    
       The two are now named separately at the call site, so neither question
       can quietly borrow the other's answer. */
    return laneState(current, step, progressed, flaggedSteps, wasReset)
  }

  const focused = PIPELINE.find((s) => s.id === focusStep)!
  const focusedState = stepState(focused)

  const doneCount = PIPELINE.filter((s) => stepState(s) === "done").length
  /* `pct` is gone with the bar it drove. As a width it claimed a position on a
     path that forks; as a caption beside "4/11 steps" it was that same fraction
     said twice. The per-lane counts below are the figure "4 of 11" actually
     hides — all of build done and none of risk reads identically to steady
     progress on both, and those are not the same file. */
  const doneIn = (steps: PipelineStep[]) =>
    steps.filter((s) => stepState(s) === "done").length

  // Grouped by lane, not sliced by index, so adding a step to a lane cannot
  // silently land it in the wrong branch of the fork.
  const riskLane = PIPELINE.filter((s) => s.lane === "risk")
  const buildLane = PIPELINE.filter((s) => s.lane === "build")
  /* Split by ARRAY POSITION, like REJOIN_STEP. This was `s.id < firstForkId`
     with `firstForkId = min(lane ids)`, which only ever worked by coincidence:
     the risk lane runs 10 → 11 → 2, so that minimum is Underwriting's 2, which
     happens to fall between capture (1) and Ship (7). Renumber any step, or add
     a lane step with a lower id, and every spine step lands in `before` — the
     rejoin trunk would silently vanish. */
  const forkAt = PIPELINE.findIndex((s) => s.lane !== "spine")
  const spine = {
    before: PIPELINE.slice(0, forkAt),
    after: PIPELINE.slice(forkAt).filter((s) => s.lane === "spine"),
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
              {book.map((m) => (
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

      {/* Progress track — the same shape, steps and states as the diagram below.
          Widths are FLEX UNITS TAKEN FROM THE LANES, never fixed: the fork band
          is `flex-[N]` where N is the longer lane, so three risk steps occupy
          exactly the width four build steps do. Sharing extent is what says
          "at the same time"; laid end to end they would read as seven more
          sequential steps, which is the picture this replaced. */}
      <div className="mt-5 flex items-center gap-4">
        <div
          className="flex flex-1 items-center gap-1.5"
          role="group"
          aria-label={`Pipeline progress: ${doneCount} of ${PIPELINE.length} steps complete. Risk lane ${doneIn(riskLane)} of ${riskLane.length}, build lane ${doneIn(buildLane)} of ${buildLane.length}, running in parallel.`}
        >
          {spine.before.map((s) => (
            <TrackSeg
              key={s.id}
              step={s}
              state={stepState(s)}
              focused={s.id === focusStep}
              onFocus={setFocusStep}
            />
          ))}
          <span className="h-5 w-px shrink-0 bg-border" />
          <div
            className="flex flex-col gap-1.5"
            style={{ flex: Math.max(riskLane.length, buildLane.length) }}
          >
            {([["Risk", riskLane], ["Build", buildLane]] as const).map(
              ([label, lane]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                  </span>
                  <span className="w-7 shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">
                    {doneIn(lane)}/{lane.length}
                  </span>
                  <div className="flex flex-1 gap-1">
                    {lane.map((s) => (
                      <TrackSeg
                        key={s.id}
                        step={s}
                        state={stepState(s)}
                        focused={s.id === focusStep}
                        onFocus={setFocusStep}
                        thin
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
          <span className="h-5 w-px shrink-0 bg-border" />
          {spine.after.map((s) => (
            <TrackSeg
              key={s.id}
              step={s}
              state={stepState(s)}
              focused={s.id === focusStep}
              onFocus={setFocusStep}
            />
          ))}
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {doneCount}/{PIPELINE.length} steps
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
              hasFinding={flaggedSteps.has(step.id)}
          awaiting={awaitingSteps.get(step.id) ?? 0}
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
              findingSteps={flaggedSteps}
            awaitingSteps={awaitingSteps}
            />
            <LaneColumn
              steps={buildLane}
              stepState={stepState}
              focusStep={focusStep}
              onFocus={setFocusStep}
              findingSteps={flaggedSteps}
            awaitingSteps={awaitingSteps}
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
              hasFinding={flaggedSteps.has(step.id)}
          awaiting={awaitingSteps.get(step.id) ?? 0}
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
                onStepDone={markStepDone}
                onStepCleared={clearStepDone}
                resetTheme={() => resetTheme(current.id)}
                themeEdited={hasOverride(current.id)}
          /* The same two sets the rail is given, in the same order. This used
             to receive `findingSteps` alone while the rail got the union, and
             that single mismatch is what let the gate open a step the rail
             would then never record as done. */
          awaiting={blockingPredecessor(current, focused, progressed, flaggedSteps, wasReset)}
          progressed={progressed}
          played={played}
          onPlayed={markStepPlayed}
          wasReset={wasReset}
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
  awaitingSteps,
}: {
  steps: PipelineStep[]
  stepState: (step: PipelineStep) => StepState
  focusStep: StepId
  onFocus: (id: StepId) => void
  // Readonly: a renderer has no business adding to the finding set.
  findingSteps: ReadonlySet<StepId>
  /** Step id → checks dispatched and not yet returned. A count, not a flag,
   *  because the marker has to say how many are outstanding. */
  awaitingSteps: Map<StepId, number>
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
          // Already merged by the caller — see `flaggedSteps`.
          hasFinding={findingSteps.has(step.id)}
          awaiting={awaitingSteps.get(step.id) ?? 0}
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
  awaiting = 0,
}: {
  step: PipelineStep
  state: StepState
  isFocus: boolean
  onFocus: (id: StepId) => void
  connector: "down" | "none"
  dense?: boolean
  /** The step is behind us but something in its artefacts is unresolved. */
  hasFinding?: boolean
  /** The step ran, but checks it dispatched have not come back. */
  awaiting?: number
}) {
  // Only meaningful once the step is behind us: an upcoming step's artefacts
  // describe work nobody has done, and marking it would report a failure
  // against a step the agent has not reached.
  const flagged = hasFinding && state === "done"
  // Same rule, same reason. And ranked BELOW a finding: both are amber, but a
  // finding is something to answer and this is something to wait out, so when
  // a step carries both the marker shows the one that needs a person.
  const pending = !flagged && state === "done" && awaiting > 0
  // The CHIP is gated more widely than the marker, and the two differ on
  // purpose. The marker for an `active` step already carries the primary glow
  // meaning "the agent is working here" — a true, distinct claim — so amber
  // must not overwrite it. But the check is out either way, and the portfolio
  // says so on its row: a reader who opens Ravenswood from that row has to
  // find the same fact here, or the two surfaces read as disagreeing.
  const awaitingChip = !flagged && state !== "upcoming" && awaiting > 0
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
              : pending
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
          ) : pending ? (
            // The tick is withheld here too, and for a nearer reason: the
            // step's checks have not come back, so a tick would report a
            // verdict nobody has returned. NOT the warning triangle either —
            // nothing has gone wrong. A pulse, because a static mark is what
            // let this read as finished in the first place.
            <PulseDot />
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
                : pending
                  ? `Step ran, ${awaiting} check${awaiting === 1 ? "" : "s"} still in progress`
                  : state === "done"
                    ? "Step complete"
                    : // Was "Step in progress", which the pending state above
                      // now needs: a check out with a provider and the agent
                      // mid-run are different things and cannot share a name.
                      // Matches the header badge, which already says this.
                      "Agent working on this step"}
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
            {/* The words, on the rail itself. The pulsing marker says
                something is still moving but not what, and this is the one
                view a reader scans without opening anything — if the wait is
                not named here it is not named anywhere they will look. */}
            {awaitingChip && (
              <InProgressTag label={dense ? "In progress" : `${awaiting} in progress`} />
            )}
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
  onStepDone,
  onStepCleared,
  resetTheme,
  themeEdited,
  awaiting,
  progressed,
  played,
  onPlayed,
  wasReset,
}: {
  step: PipelineStep
  state: StepState
  merchant: Merchant
  onOpenSignoff: () => void
  theme: BrandTheme
  setTheme: (t: BrandTheme) => void
  exceptionCtx: ExceptionContext
  /** Report this step finished, so the journey can advance. Reported UP rather
   *  than held here because the rail, the ship gate and the next step all need
   *  it — a copy kept in this component would be invisible to every one of
   *  them, which is how completing a step came to change nothing. */
  onStepDone: (id: StepId) => void
  /** Un-report it, for a reset. The rail draws from the same set, so without
   *  this a cleared stage kept its tick — and its finding marker. */
  onStepCleared: (id: StepId) => void
  /** Drop the brand override for this merchant, back to the agent's proposal. */
  resetTheme: () => void
  /** Whether anyone has edited this merchant's design. Asked of the provider
   *  rather than compared structurally here, so "unedited" has one definition. */
  themeEdited: boolean
  /** The step in front of this one that is still open, when this one is not
   *  reachable yet. Passed in rather than computed here because only the
   *  parent holds the session's progress. */
  awaiting: PipelineStep | null
  /** The session's completed steps, for the Ship clearance gate. Same set the
   *  rail draws from, so the gate and the ticks cannot disagree. */
  progressed: ReadonlySet<StepId>
  /** Steps whose agent run has been played. Separate from `progressed` because
   *  a halted run never completes, so the two diverge exactly on the files that
   *  matter here. */
  played: ReadonlySet<StepId>
  onPlayed: (id: StepId) => void
  /** Stages explicitly reset, so the ship gate cannot clear a dispatch against
   *  a build step this very screen is showing as never run. */
  wasReset: ReadonlySet<StepId>
}) {
  // Null unless the risk lane is genuinely outstanding — see the banner below.
  /* Computed for every step, not just Ship, because the Play gate below reads
     it too — and both must read the SAME evaluation. Two calls could not
     disagree today, but a panel saying "cleared" above a button saying
     "withheld" is the defect this app keeps producing, so there is one. */
  const clearance = useMemo(
    () => shipClearance(merchant, exceptionCtx, progressed, played, wasReset),
    [merchant, exceptionCtx, progressed, played, wasReset],
  )

  /* How many tasks have completed. Upcoming steps start at 0 (preview), done
     steps start fully complete, the active step invites you to play.
  
     THE EXCEPTION CASE. A step carrying an authored exception has already run —
     that is what produced the finding — so starting it at 0 put "Play agent
     run · 0/4 tasks" directly above a finding the run supposedly turned up.
     It resumes at the task that raised it, `taskIndex + 1`, because that task
     executed and the ones after it did not: the run stopped there. Anything
     higher would tick tasks the halt prevented; anything lower would hide the
     one that found the problem. */
  /* Read out of this step's own artefacts. A step can finish every task and
     still not have passed — the run is what turns the finding up.
  
     Declared HERE, above `initialProgress`, because that is now its first
     consumer: where the run stopped decides where the panel opens. */
  const finding = useMemo(
    () => blockingFinding(step.id, merchant, exceptionCtx, played),
    [step.id, merchant, exceptionCtx, played],
  )

  /* ASK THE TWO FUNCTIONS THAT ALREADY OWN THESE ANSWERS — DO NOT RE-ENUMERATE
     THE REGISTERS.
  
     This used to list the registers by hand: `exceptionOnStep` for an authored
     exception, then `locatedException` for the timeline-only one. Both are real
     registers, and the list was still wrong, because there is a THIRD — the
     document-bundle halt — and Orchard Lane is held by exactly that one. So the
     file opened at 0/5 while the task row beside it read "Halted · Bundle
     incomplete — 2 documents outstanding" and the artefact pane said "This task
     has not run yet", of a run that had plainly gone and stopped. A finding IS
     the record of a run.
  
     `stepHasRun` carries the warning this ignored — "THESE TWO LISTS MUST
     MATCH", written when `stepHasRun` and `blockingFinding` disagreed about
     Glasswing and produced this identical contradiction one function to the
     left. This was a third list, matching neither, and hand-enumerating
     registers is what guarantees the next one gets missed. Both functions are
     already used elsewhere in this very component — `stepHasRun` is passed to
     the gate below as "whether the agent has actually been here" — so the
     cockpit could state the fact in the handoff and deny it in the counter.
  
     Two questions, two owners: `stepHasRun` = did the agent come, `finding
     .taskIndex` = where did it stop. Neither is re-derived here. */
  const initialProgress =
    state === "done"
      ? step.tasks.length
      : /* A STEP NOBODY CAN START YET HAS NOT RUN — this outranks `stepHasRun`.
        
           `stepEvidenced` underneath it answers from LANE POSITION alone: a risk
           step counts as run once the lane's open position is past it. That is
           right within the lane and blind to the spine, so on Orchard — whose
           lane records R3 while 01 Merchant capture is halted — it reported KYC
           and Pricing as fully run, and without this guard the fix above would
           have shown 4/4 on two steps that cannot have started. An unreachable
           step drawn as complete is a worse lie than the one being fixed.
        
           The precondition belongs here rather than in `stepEvidenced`, whose
           comment explains why it takes no `halted` set: findings would depend
           on evidence which depended on findings. `laneState` has already
           resolved that cycle, and it is the same value the badge and the rail
           read, so this cannot disagree with them. */
        state === "upcoming"
        ? 0
        : !stepHasRun(merchant, step.id, played)
          ? 0
          : /* It ran. `taskIndex` names the task that raised the finding: it
             executed and the ones after it did not, so the run resumes there
             and no further. A finding WITHOUT an index records that the step
             ran but not where it stopped, so those resume fully run rather than
             at a guessed index — picking one would put a red mark on a task
             chosen at random. No finding at all means it ran clean (its checks
             may still be out), which is also fully run. */
          finding?.taskIndex !== undefined
          ? Math.min(finding.taskIndex + 1, step.tasks.length)
          : step.tasks.length
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

  /* The AUTHORED exception, if this is the step carrying it — the one with
     prose to show, which is why `ExceptionPanel` below takes this and not
     `finding`.
  
     It is deliberately NARROWER than `finding`: an authored exception is one of
     several ways a step can be held, and the sites that ask "is this task the
     held one" check `blocker?.taskIndex === i || finding?.taskIndex === i`
     precisely because this alone would miss the derived and document-bundle
     halts. Do not collapse the two — `initialProgress` reading a hand-listed
     subset like this one is the bug being fixed here. */
  const blocker = exceptionOnStep(merchant, step.id)
  /* The "no detail recorded" caption must know about DERIVED findings too, not
     just the hand-authored `EXCEPTIONS` map. Once status became derived, a
     merchant halted by a live brand rule was flagged Exception, found no
     authored entry, and announced that nothing had been recorded — on the very
     step that was displaying the reason. Read from the same theme the rules are
     measured against, so the caption and the finding cannot disagree. */
  const { themeFor: liveThemeFor } = useBrandTheme()
  const hasDerivedFinding = useMemo(
    () => haltedSteps(merchant, { brandRules: checkBrand(liveThemeFor(merchant)) }, played).size > 0,
    [merchant, liveThemeFor, played],
  )
  const detailMissing = exceptionDetailMissing(merchant, hasDerivedFinding)

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
  //
  // HELD IN THE BOOK, NOT HERE. As a `useState` it died with this component,
  // and `app/page.tsx` renders one screen at a time — so opening sign-off
  // unmounted the cockpit, and sign-off recomputed the kit from the fixture and
  // approved the device count as it stood BEFORE the edit. Keyed by merchant in
  // the provider, which also retires the reset-on-merchant-change effect this
  // used to need: that effect existed only because a single unkeyed slot would
  // otherwise show one merchant's basket against another, and it discarded
  // edits you meant to keep.
  const { orderFor, setOrder, resetOrder, orderEdited } = useBook()
  const draft = orderFor(merchant)
  const setDraft = useCallback<React.Dispatch<React.SetStateAction<OrderDraft>>>(
    (next) => setOrder(merchant, next),
    [setOrder, merchant],
  )

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
    // Asked of the provider, which knows whether an override exists at all, so
    // "edited" has one definition rather than a structural comparison here that
    // could drift from the one the reset performs.
    (stageWrites.theme && themeEdited) ||
    (stageWrites.acceptance &&
      JSON.stringify(acceptance) !== JSON.stringify(defaultAcceptance(merchant))) ||
    // Asked of the provider, like the theme above it: "an override exists" is
    // one definition, whereas a structural comparison here could drift from the
    // one the reset performs.
    (stageWrites.draft && orderEdited(merchant.id))

  // Reset the run whenever the focused step (or merchant) changes.
  //
  // NAVIGATION ONLY — and the guard below is the whole point. `state` has to be
  // read here (arriving at an already-done step should show it done) but it must
  // not TRIGGER this, because a run and a decision are different registers. With
  // `state` driving the effect, withdrawing an approval re-ran the reset and
  // wiped the agent run to 0/4: correct the brand colour and the cockpit threw
  // away four completed tasks and said "Run the agent first — there is nothing
  // to approve yet", with the corrected design sitting on screen beside it. The
  // artefacts had not gone anywhere; only the approval had. So the user fixed
  // the thing they were asked to fix and the gate locked them out.
  const navKey = `${merchant.id}:${step.id}`
  const lastNav = useRef<string | null>(null)
  useEffect(() => {
    // A decision changing is not a navigation. Bail before touching the run.
    if (lastNav.current === navKey) return
    lastNav.current = navKey
    if (timer.current) clearTimeout(timer.current)
    // A hand-reset step stays reset until it is run again, rather than being
    // re-derived back to "done" from the merchant's pipeline position.
    const wasReset = resetSteps.current.has(step.id)

    /* READ `initialProgress`, DO NOT RE-DERIVE IT.
    
       This used to be its own cruder rule — `state === "done" ? tasks.length :
       0` — which knew about finished steps and nothing else. A HALTED step is
       neither: it ran, and it stopped. So arriving at one reset it to zero and
       the panel said "This task has not run yet" beside its own finding
       ("Bundle incomplete — 2 documents outstanding"), a result only a run
       could have produced. An exception IS the record of a run.
    
       `initialProgress` twelve hundred lines up already handled all three cases
       and was used ONCE, in the `useState` initialiser — so the file opened
       correctly and the first navigation wrecked it. Since the landing rule now
       moves focus on arrival for blocked files, that navigation happens before
       the reader sees anything, which is why this looked like the default.
    
       One expression, two consumers. Re-deriving it here is what let them
       disagree, and the mount path being right is what made it invisible. */
    setCompleted(wasReset ? 0 : initialProgress)
    setStatus(!wasReset && state === "done" ? "done" : "idle")
    /* Open on the task that halted, not task 1. It is the one carrying the
       finding, and its artefact — the dossier naming the outstanding documents
       — is the reason to be on this step at all. Same principle as the landing
       rule one register up: put the reader where the work is. */
    setSelected(
      !wasReset && finding?.taskIndex !== undefined
        ? Math.min(finding.taskIndex, step.tasks.length - 1)
        : 0,
    )
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    /* `initialProgress` and `authored` are recomputed every render, but the
       `lastNav` guard above means only a genuine navigation gets past this
       point — so they cannot re-fire the reset mid-session. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navKey, state, step.tasks.length])

  // A different merchant means a different order, never the last one's basket.
  // The same applies to the underwriting determination: carrying it across
  // would attribute one merchant's decision to another.
  //
  // The brand design is absent from this list because it is no longer held
  // here: the provider keys it by merchant, so nothing can leak between files
  // and — better than the old behaviour — switching away and back no longer
  // discards an edit the acquirer had made.
  useEffect(() => {
    // The order is NOT reset here any more. It is keyed by merchant in the
    // book, so nothing can leak between files — and, better than the old
    // behaviour, switching away and back no longer throws away an edit. Same
    // reasoning as the brand design, which left this list for the same reason.
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

  /* THE WRITE THAT MAKES A FINDING ADMISSIBLE.
  
     Recorded when the run STARTS, not when it finishes, because a run that
     halts never finishes — gating findings on completion would mean the step
     can only report a problem once it has no problem. This is the one signal
     that separates "the agent looked" from "the agent approved". */
  function play() {
    onPlayed(step.id)
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
    // Same record as `play`. A replay is still a run, and on a step whose first
    // run was cleared by a stage reset this is the only thing that puts the
    // evidence back — without it, replaying would show the tasks executing
    // while the step went on insisting nothing had run.
    onPlayed(step.id)
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
   *  Lands PENDING — zero tasks run, status idle ��� even on a step the
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

    /* THE DECISION IS PART OF THE STAGE, AND WAS THE ONE THING RESET LEFT
       STANDING.

       Clearing the run, the handoffs and the artefacts while leaving the
       approval on file produced a stage that read 0/4 tasks with its acquirer
       row still ticked "Approved by you" — an approval of work the same button
       had just erased. And because a settled row draws no controls, the
       approval could not be given again, so the reset made the gate
       permanently unusable rather than fresh.

       WITHDRAWN, not superseded: superseding preserves a record of something
       that happened, which is right when the design moves underneath a real
       decision. A reset asserts the opposite — that this stage is being shown
       for the first time — so leaving a tombstone would contradict the very
       claim the button makes. */
    withdraw(merchant.id, step.id)

    /* And un-report the step, so the RAIL agrees. `resetSteps` is a ref inside
       this component, which the rail cannot read; it went on drawing the step
       as done, and — since the restored default design breaches a brand rule —
       drew the amber finding marker over it. That is the reported symptom: a
       warning on a stage that had just been cleared. */
    onStepCleared(step.id)

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
    // Drops the override rather than writing the default back, so the stage
    // returns to "nobody has touched this" and `orderEdited` goes false — the
    // same move `resetTheme` makes just below.
    if (stageWrites.draft) resetOrder(merchant.id)
    // Drops the override rather than writing the default back, so the stage
    // returns to "nobody has touched this" and `themeEdited` goes false.
    if (stageWrites.theme) resetTheme()
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

  // `finding` is declared above `initialProgress`, which is its first consumer.

  // Per-task census of failures the artefacts themselves record. Same call the
  // step badge resolves through, so a row cannot show a tick under a badge
  // reporting a finding, nor the reverse.
  const exceptions = useMemo(
    () => taskExceptions(step.id, merchant, step.tasks.length, exceptionCtx),
    [step.id, merchant, step.tasks.length, exceptionCtx],
  )

  /**
   * How far a task's round trip to an external system has got.
   *
   * ONE definition, read by the chip on the row and by the strip above the
   * artefact. Two copies of this would be two places for "is it back yet" to
   * drift, which is the defect that produced a badge reading Complete over a
   * spinner — the same mistake one register lower.
   *
   * Only a CLEAN completion with nothing outstanding counts as returned. A
   * failed, halted or still-open task did leave the agent, so `idle` would deny
   * a dispatch that happened, while `returned` would claim an answer that never
   * came back.
   */
  const beatOf = (i: number): Beat => {
    if (taskSkipped(step.id, i, merchant)) return "idle"
    const done = i < completed
    const running = i === runningTaskIndex
    if (!done && !running) return "idle"
    const art = artifactFor(step.id, i, merchant)
    const stalled =
      blocker?.taskIndex === i || finding?.taskIndex === i || exceptions.has(i)
    const open = art?.kind === "checks" ? art.rows.some((r) => r.state === "running") : false
    return done && !running && !stalled && !open ? "returned" : "sent"
  }

  /**
   * Where this step's work actually runs, counted off the tasks themselves.
   *
   * Read against `runsOn` so the banner and the per-task strips cannot
   * disagree. `external` is deliberately not counted on either side: a
   * statutory register is nobody's product, and folding it in would either
   * inflate "your systems" or invent an Ingenico dependency.
   */
  const boundaryLead = useMemo(() => {
    const runs = step.tasks.map((t) => t.delegate?.runsOn).filter(Boolean)
    const yours = runs.filter((r) => r === "acquirer").length
    const ingenico = runs.filter((r) => r === "ingenico").length
    if (yours > 0 && ingenico > 0) return "Mostly your systems."
    if (ingenico > 0 && yours === 0) return "Runs on Ingenico's, and does not have to."
    return "Runs inside your systems."
  }, [step.tasks])

  // Counted with the ROW'S OWN predicate rather than the map's size, so the
  // header cannot report a number the list does not show: an artefact exists
  // whether or not the agent has reached it, and a task that failed or halted
  // already states a stronger outcome on its row.
  const visibleExceptions = useMemo(
    () =>
      [...exceptions.entries()].filter(
        ([i]) => i < completed && blocker?.taskIndex !== i && finding?.taskIndex !== i,
      ),
    [exceptions, completed, blocker, finding],
  )
  const exceptionCount = visibleExceptions.filter(([, e]) => e.severity === "fail").length
  /* Counted and worded separately. Folding unresolved checks into "N
     exceptions" would report findings the checks never made, and the two ask
     for different things: an exception needs deciding, an unresolved check
     needs chasing. */
  const unresolvedCount = visibleExceptions.filter(([, e]) => e.severity === "warn").length
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
  // are reading one source and cannot drift apart — and now counted by the
  // SAME function the rail uses, for the same reason one register up.
  const outstandingChecks = useMemo(
    () => countOutstandingChecks(step.id, merchant, played),
    [step.id, merchant, played],
  )

  /* Whether the presenter has already answered THIS step's wait. Keyed by step
     because the two lanes can each be waiting, and one reply must not silently
     stand in for the other. */
  const {
    responsesIn,
    deliverResponse,
    resetResponse,
    checksResolved,
    resolveChecks,
    unresolveChecks,
    findingsCleared,
    clearFinding,
    restoreFinding,
    documentsArrived,
    supplyDocuments,
    resetDocuments,
  } = useDemo()

  /* THE DOCUMENT GAP IS ITS OWN DEAD END, and the only one with no way out.
  
     An incomplete bundle halts capture BEFORE anything runs, so the file opens
     at 0/5 tasks with the run refused. The lever that delivers the documents
     existed, but only inside the handoff card — which renders once a run has
     produced handoffs. A file halted on arrival therefore had no handoff, no
     lever, and nothing on the page that could move it: Orchard Lane read
     "Halted · Bundle incomplete" with an empty control row.
  
     Same demo treatment as its three siblings above, and worded as the merchant
     SENDING the documents rather than as an override — the gap closes because
     the paperwork arrived, not because anyone waived it. */
  const missingDocuments = useMemo(() => outstandingDocuments(merchant), [merchant])
  const documentsSupplied = Boolean(documentsArrived[merchant.id])
  const responseSimulated = Boolean(responsesIn[responseKey(merchant.id, step.id)])
  /* Same key shape, separate map: a step can have been waiting AND come back
     without an answer, so one flag could not describe both. */
  const checksSimulated = Boolean(checksResolved[responseKey(merchant.id, step.id)])
  const findingCleared = Boolean(findingsCleared[responseKey(merchant.id, step.id)])

  /* ASK WHETHER THE FINDING ON THIS PANEL WOULD GO AWAY — not whether the
     transform touches anything.
  
     My first gate compared object identity, which is a different question and
     answered yes far too often. B2 Branding on Nordwind carries a blocking
     BRAND RULE, derived from `checkBrand`, plus an unrelated open event
     ("Awaiting your branding approval"). Clearing closed the event, so identity
     changed, so the button appeared — and the brand rule, which lives nowhere
     near the timeline, survived untouched. The control announced a fix and the
     panel did not move. That is the exact defect the old comment claimed to
     prevent, reintroduced by testing the wrong thing.
  
     Three conditions, in order: there must BE a finding, the transform must
     have a handle on it, and re-deriving afterwards must come back clean. The
     last one is what makes this honest — the button cannot appear unless it
     demonstrably resolves the finding the reader is looking at.
  
     Findings with their own real remedy therefore drop out by themselves: a
     brand breach is fixed in the theme editor on this very screen, missing
     documents by the upload lever. Neither needs a special case here, and
     neither gets a button that would do nothing. */
  const canClearFinding = useMemo(() => {
    if (!finding) return false
    const cleared = withClearedFindings(merchant, {
      [responseKey(merchant.id, step.id)]: "probe",
    })
    if (cleared === merchant) return false
    return blockingFinding(step.id, cleared, exceptionCtx, played) === null
  }, [finding, merchant, step.id, exceptionCtx, played])

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

  /* What stops the AGENT RUN, as opposed to `precondition` below, which stops
     the acquirer's own decision. Two different acts: on most steps playing the
     agent is harmless analysis you can re-run, but Ship's tasks move physical
     hardware, and once a parcel is with a carrier no amount of withheld
     sign-off brings it back.
  
     Only Ship has one today, which is why this is a narrow named value rather
     than another enumeration — the last one of those was hand-listed for two
     steps and silently left the order button ungated. */
  const runBlocked = useMemo<RunBlock | null>(() => {
    /* A STEP THAT IS NOT YET REACHABLE CANNOT BE RUN.
    
       The rail lets you focus any step, which is right — reading ahead is not
       the same as acting — but focusing B4 also armed its Play button, so the
       last step of the lane could be run while the first was still open. The
       refusal NAMES the outstanding step: "not yet" alone leaves the reader
       guessing which of eight is holding them up, and a control that cannot
       say why it is disabled looks broken rather than deliberate. */
    if (awaiting) {
      return {
        badge: "Not started",
        action: `Waiting on ${awaiting.code}`,
        reason: `${awaiting.code} ${awaiting.name} has not finished. Steps on this lane run in order.`,
        // Neutral, not amber. Nothing has failed and nothing is being held —
        // this step simply has not had its turn, which is the ordinary state
        // of most of the pipeline. Amber here would put a warning on every
        // step the file has yet to reach.
        tone: "neutral",
      }
    }
    if (step.id !== REJOIN_STEP || clearance.granted) return null
    /* Nothing left to gate once the parcels have gone. Disabling Replay on a
       delivered shipment would offer to withhold something already in the
       merchant's hands — the control would be claiming a power it does not
       have. The panel above still reports the open findings. */
    if (clearance.released) return null
    return {
      badge: "Held",
      action: "Release withheld",
      reason: `${clearanceLine(clearance)} Ingenico cannot dispatch until every prior step passes.`,
      // Red only when something actually failed; amber when the file is merely
      // still in flight. Matches the clearance panel's own reading rather than
      // inventing a second opinion about the same hold.
      tone: clearance.failing ? "destructive" : "warning",
    }
  }, [step.id, clearance, awaiting])

  /* WHEN A STEP IS FINISHED — the write that was missing.
  
     Three conditions, and all three are needed. Tasks run (the work happened),
     no unresolved finding (a step that failed has not passed), and, where the
     acquirer owns a gate, their decision taken — otherwise the agent finishing
     its own tasks would advance a file through a sign-off nobody performed,
     which is the entire point of having a gate.
  
     `signed`, never merely "decided": returning a file to the merchant is an
     act, but it is not progress, and treating it as completion would let a
     rejection carry the file forward.
  
     Derived from `acquirerRole` rather than a list of step ids — a hand-kept
     list stops covering any step whose role changes later, and an unguarded
     gate does not look like an omission, it looks like an approval. */
  // The SHARED record, the same one StepGate and the sign-off screen write to
  // — so approving on either surface advances the file. A local copy here
  // would make this component's idea of "approved" a fourth opinion.
  const { decisions, withdraw } = useDecisions()
  // LIVE, not raw: a superseded approval must not finish the step. Reading the
  // raw record here would leave the stage ticked and the file advancing on the
  // strength of a decision taken against a design that has since been edited.
  const decision = liveDecisionAtStep(decisions, merchant.id, step.id)
  const needsDecision = step.acquirerRole === "signs-off" || step.acquirerRole === "approves"

  /* WHAT FINISHES A STEP.
  
     Read from DURABLE facts only. `completed` is how far the animation has
     played ON THIS VISIT — the navigation effect resets it to 0 whenever the
     focused step changes — so a rule that also required it to still read 4/4
     could never be satisfied alongside an approval, because approving means
     opening the sign-off screen, and coming back had already wiped the
     evidence. That is the reported bug exactly: approve B1, return, B1 still
     "in progress". Animation state cannot stand as the record of work.
  
     Which fact counts depends on who owns the step, so this is derived from
     `acquirerRole` rather than listing step ids:
  
     - A GATED step is finished by the DECISION, and by nothing else. The run
       is presentation; the gate's own `precondition` is what stops anyone
       signing off before the evidence is in, and it has already run by the
       time a decision exists.
     - An OBSERVED step is finished when the run reaches its last task, which
       is the only completion event it has.
  
     A blocker vetoes either — a step carrying an unresolved finding has not
     passed, however much of it ran. */
  const ranToEnd = completed >= step.tasks.length
  const stepFinished =
    !blocker && !runBlocked && (needsDecision ? decision?.kind === "signed" : ranToEnd)

  useEffect(() => {
    if (stepFinished) onStepDone(step.id)
  }, [stepFinished, step.id, onStepDone])

  /* AND THE REVERSE, for the one case that can un-finish a step already
     recorded: an approval superseded because its subject was edited.

     Deliberately narrow. The tempting version is to mirror the effect above and
     clear whenever `stepFinished` is false, but that reads `ranToEnd`, which is
     animation state — it is zero for a moment on every navigation, so the
     symmetric form would erase the progress of any observed step merely by
     looking at it. Only a supersession is a durable fact that revokes a
     completion, so only a supersession clears one. */
  const supersededHere =
    needsDecision && Boolean(decisionAtStep(decisions, merchant.id, step.id)?.supersededIso)
  useEffect(() => {
    if (supersededHere) onStepCleared(step.id)
  }, [supersededHere, step.id, onStepCleared])

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

    // GENERIC BACKSTOP — and the one that actually matters.
    //
    // Everything above names a blocker in its own step's terms, which reads
    // better than anything generic can. But an enumeration only covers the
    // steps somebody remembered to put on it, and this control COMMITS. Step
    // 03 was not on the list, so a delivery address that does not resolve to a
    // serviceable route left "Place the order" fully live — and the order got
    // placed against it, recorded as "Approved by you" with a timestamp. An
    // order that cannot be delivered is not a decision anyone is entitled to
    // take, and the step was already displaying the reason directly above the
    // button.
    //
    // So the last word goes to a rule that cannot be under-listed: if this
    // step is carrying an unresolved finding, its decision is not available.
    // Both reads come from the same calls the step badge and the rail marker
    // use, so the button cannot be live while the header above it says
    // Finding.
    //
    // One read, not two. A recorded exception is now reported by
    // `blockingFinding` itself, so asking `blocker` separately here would be a
    // second path to the same claim — and the two could only ever drift apart.
    // What arrives is the exception's own `summary` and `consequence`, which
    // is the part the acquirer needs: not merely that something failed, but
    // what placing anyway would cost.
    // Joined with exactly one sentence break. The two sources punctuate
    // differently and each is right on its own terms: an exception's `summary`
    // is a finished sentence because its own panel renders it alone, while a
    // derived headline ("2 of 5 checks failed") is a fragment. Editing either
    // set of strings would break the surface it was written for; normalising
    // at the join does not.
    if (finding) {
      return `${finding.headline.replace(/[.\s]+$/, "")}. ${finding.detail}`
    }
    return null
  }, [step.id, merchant, edge, theme, finding])

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
                      ? waitingOn(
                          step.id,
                          merchant.id,
                          handoffs,
                          merchant.currentStep,
                          // Without this the badge reported nobody waiting on a
                          // halted step, because position alone had already
                          // declared it settled.
                          finding !== null,
                        )
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
                      : // The count was already honest — "2 awaiting" — but it
                        // was printed in the success green, so the chrome said
                        // finished while the words said waiting and the chrome
                        // is what gets read at a glance.
                        outstandingChecks > 0 || unresolvedCount > 0
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
            ) : status === "done" && runnableCount > 0 && !finding && outstandingChecks > 0 ? (
              // Was a flat grey dot, on the reasoning that waiting is not a
              // warning. True, but grey is what "this step has not had its
              // turn" already looks like, so an open check rendered as nothing
              // happening — and the merchant went on waiting on a provider
              // with no one on this side able to see it. Amber and moving:
              // amber because the file IS held up, moving because that is what
              // separates it from the settled amber of a finding.
              <PulseDot />
            ) : (
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  status === "done" && runnableCount > 0
                    ? finding?.taskIndex !== undefined
                      ? "bg-destructive"
                      : finding
                        ? "bg-warning"
                        : // A held release is not an alarm either — nothing
                            // has gone wrong, the acquirer simply has not
                            // pressed it yet — but green would claim the step
                            // had finished, which is the thing it has not done.
                            heldReleases > 0
                            ? "bg-primary"
                            : // Settled amber, not the pulsing dot above: an
                              // unresolved check is not still travelling, it
                              // came back without an answer.
                              unresolvedCount > 0
                              ? "bg-warning"
                              : "bg-success"
                    : blocker
                      ? "bg-destructive"
                      : // The block states its own tone — see RunBlock. A step
                        // that has not had its turn is neutral, a held
                        // dispatch is amber, a real failure is red.
                        runBlocked
                        ? runBlocked.tone === "destructive"
                          ? "bg-destructive"
                          : runBlocked.tone === "warning"
                            ? "bg-warning"
                            : "bg-muted-foreground/60"
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
                        // stuck, and that is a third thing. "In progress"
                        // rather than "awaiting", which reads as stalled — the
                        // check is moving, just not here.
                        outstandingChecks > 0
                        ? `${outstandingChecks} in progress`
                        : // Named as YOURS, not as a bare count: an
                          // outstanding check is waiting on someone else,
                          // whereas this is waiting on the reader.
                          heldReleases > 0
                          ? `${heldReleases} to release`
                          : /* A check that came back with no answer. Ranked
                               last because every state above is a stronger
                               claim, but still above "Complete": the badge
                               was reading Complete over a task whose own row
                               said the registry never responded. Worded as
                               the gap it is, not as a finding — nothing was
                               judged and failed. */
                            unresolvedCount > 0
                            ? `${unresolvedCount} unresolved`
                            : "Complete"
                : // "Ready" on a blocked step is a false all-clear: this is the
                  // one step that cannot be run to completion.
                  blocker
                  ? "Blocked"
                  : // Nor on a step whose dispatch is being held. `blocker`
                    // only sees findings raised ON THIS STEP, and Ship's
                    // holds come from the eight steps behind it — so the
                    // badge read "Ready" directly above "Release withheld",
                    // the badge contradicting the record beneath it. Only
                    // the screenshot caught this; every text assertion
                    // passed.
                    runBlocked
                    ? runBlocked.badge
                    : /* Third instance of the same defect, and the one the
                         screenshot caught: "Ready" sat directly above a task
                         row reading "Halted · Bundle incomplete". `blocker`
                         and `runBlocked` both missed it — the first sees only
                         findings authored against this step, the second only
                         gates on the run — so a step halted BEFORE its first
                         run fell through every branch to the all-clear. The
                         count beside it already said "1 halted"; the badge is
                         now reading the same fact. */
                      finding
                      ? "Halted"
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
                  {/* DERIVED, not asserted. This lead was the literal string
                      "Runs inside your systems." on every step carrying an
                      integration note — which went false the moment one task on
                      KYC was served by Ingenico's own media scan, leaving a
                      banner contradicting the strip directly beneath it. */}
                  <span className="font-semibold">{boundaryLead} </span>
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

      {/* THE REJOIN GATE. Ship is where the lanes meet, so it is the only step
          reachable with the other lane unfinished — and the only one where
          getting it wrong puts hardware in the hands of a merchant nobody
          approved.
      
          Rendered in BOTH states, unlike the warning it replaces. A control
          that appears only on failure leaves the reader unable to tell a
          granted clearance from a check that never ran, and this one is
          granted silently by the checks themselves — so if it said nothing on
          a clean file, nothing on screen would record that the decision had
          been taken at all. */}
      {step.lane === "spine" && step.id === REJOIN_STEP && (
        <div className="border-b border-border px-5 py-4">
          {clearance.granted ? (
            <div className="flex gap-2.5 rounded-lg border border-success/40 bg-success/[0.07] px-3 py-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <div>
                <p className="text-sm font-semibold text-foreground">Cleared to release</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  All {clearance.checked.length} prior steps across both lanes have passed, so
                  clearance was granted automatically — there was nothing left to decide. Ingenico
                  books the carrier and ships from here.
                </p>
              </div>
            </div>
          ) : (
            <div
              /* Tone tracks the KIND of hold. An unfinished build step is not a
                 fraud finding, and painting both in alarm red would spend the
                 alarm colour on a file that is merely early. */
              className={`rounded-lg border px-3 py-2.5 ${
                clearance.failing
                  ? "border-destructive/40 bg-destructive/[0.07]"
                  : "border-warning/40 bg-warning/[0.07]"
              }`}
            >
              <div className="flex gap-2.5">
                {clearance.failing ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                ) : (
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {clearance.released ? "Released with findings still open" : "Release withheld"}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {clearance.released
                      ? "The parcels have already gone — this file cleared Ship before the findings below were raised, so there is no shipment left to hold. Whether the terminals stay on site is a recall decision now, not a clearance one."
                      : "Ingenico cannot dispatch without your clearance, and clearance needs every prior step on both lanes to pass. Reaching this step is not itself an approval — the build lane does not wait for the risk lane."}
                  </p>

                  {/* Each hold NAMED. A count alone ("2 outstanding") tells the
                      acquirer something is wrong but not what to do about it,
                      and the two kinds have different remedies. */}
                  <ul className="mt-2.5 flex flex-col gap-1.5">
                    {clearance.holds.map((h) => (
                      <li key={h.step.id} className="flex items-start gap-2 text-xs">
                        <span className="mt-px font-mono text-[10px] font-semibold text-muted-foreground">
                          {h.step.code}
                        </span>
                        <span className="min-w-0">
                          <span className="font-medium text-foreground">{h.step.name}</span>
                          <span className="text-muted-foreground">
                            {" — "}
                            {h.kind === "failed"
                              ? h.headline
                              : h.started
                                ? "in progress, not finished"
                                : "not started"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* Says what makes it move, so a withheld release does not
                      read as a dead end. */}
                  <p className="mt-2.5 text-xs text-muted-foreground">
                    {clearance.released
                      ? "Resolve the findings above. Doing so will not change this shipment, which has already left."
                      : clearance.failing
                        ? "Resolve the findings above. Release is granted automatically once every step passes."
                        : "No action needed here — release is granted automatically as the remaining steps pass."}
                  </p>
                </div>
              </div>
            </div>
          )}
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
            /* THE GATE THAT ACTUALLY MATTERS. The banner above states the
               position; this stops the parcels. Ship's tasks book a carrier
               and hand hardware over, so running them on a withheld file is
               the very outcome the clearance exists to prevent — a red notice
               above a live Play button is a warning, not a control. */
            <button
              onClick={play}
              disabled={runBlocked !== null}
              title={runBlocked?.reason}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 glow-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:bg-primary"
            >
              <Play className="h-3.5 w-3.5" />
              {/* The block names its own refusal. A single hardcoded label was
                  written when Ship was the only gate, so an unreached build
                  step announced "Release withheld" — Ship's wording, about a
                  dispatch that step has nothing to do with. */}
              {runBlocked
                ? runBlocked.action
                : completed >= step.tasks.length
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

          {/* THE LEVER THAT STOPS THE WALKTHROUGH DEAD-ENDING.
              A step showing "N in progress" is waiting on a provider this app
              does not control, so without a way to make the reply arrive the
              demo simply stops here: the run has happened, nothing is wrong,
              and no button on the screen advances it. Off-theme on purpose —
              it fabricates an answer, so it must not look like the product
              receiving one. */}
          {status !== "running" && outstandingChecks > 0 && (
            <DemoInbound
              label={
                outstandingChecks === 1
                  ? "Simulate: provider replies"
                  : `Simulate: provider replies (${outstandingChecks})`
              }
              onTrigger={() => deliverResponse(merchant.id, step.id)}
            />
          )}
          {status !== "running" && responseSimulated && (
            <DemoInbound
              label="Undo simulated reply"
              onTrigger={() => resetResponse(merchant.id, step.id)}
            />
          )}

          {/* THE SECOND DEAD-END, AND THE MORE COMMON ONE.
              The lever above answers a check still IN FLIGHT. This answers one
              that came back with NO verdict — a registry that never responded,
              an ownership question left open. Both leave a step that cannot be
              settled, but only the first had a way out, so a file showing
              "2 unresolved" simply stopped: nothing was in progress, so no
              button on the page applied to it. Off-theme like its sibling,
              because it fabricates the answer rather than receiving one. */}
          {status !== "running" && unresolvedCount > 0 && (
            <DemoInbound
              label={
                unresolvedCount === 1
                  ? "Simulate: outstanding check answered"
                  : `Simulate: outstanding checks answered (${unresolvedCount})`
              }
              onTrigger={() => resolveChecks(merchant.id, step.id)}
            />
          )}
          {status !== "running" && checksSimulated && (
            <DemoInbound
              label="Undo simulated answer"
              onTrigger={() => unresolveChecks(merchant.id, step.id)}
            />
          )}

          {/* THE THIRD DEAD-END: a hard failure, which is not a check at all.
              An address the carrier will not run to, an invoice rejected at the
              border, a MID range out of allocation, a brand rule in breach, a
              refund the terminals cannot send. Nothing in the app can clear any
              of these — the work happens outside it — so without this the
              walkthrough ends here. Worded as the outside fix LANDING rather
              than as an override, because "the problem was fixed" and "somebody
              waved it through" are different claims and only the first is
              true. */}
          {status !== "running" && canClearFinding && !findingCleared && (
            <DemoInbound
              label="Simulate: fixed outside the platform"
              onTrigger={() => clearFinding(merchant.id, step.id)}
            />
          )}
          {status !== "running" && findingCleared && (
            <DemoInbound
              label="Undo simulated fix"
              onTrigger={() => restoreFinding(merchant.id, step.id)}
            />
          )}

          {/* THE FOURTH DEAD-END, and the only one that blocked a step before
              it had run at all. The three levers above all answer something a
              run produced; this answers a gap that stops the run happening.
              Scoped to the capture step because that is where the bundle is
              assembled and where the chase is owned — offering it beside a
              downstream step would let the paperwork arrive somewhere that
              never asked for it. */}
          {status !== "running" && step.id === CAPTURE_STEP && missingDocuments.length > 0 && (
            <DemoInbound
              label={`Simulate: merchant sends the ${missingDocuments.length} outstanding document${
                missingDocuments.length === 1 ? "" : "s"
              }`}
              onTrigger={() => supplyDocuments(merchant.id)}
            />
          )}
          {status !== "running" &&
            step.id === CAPTURE_STEP &&
            documentsSupplied &&
            missingDocuments.length === 0 && (
              <DemoInbound
                label="Undo simulated documents"
                onTrigger={() => resetDocuments(merchant.id)}
              />
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
                {unresolvedCount > 0 && ` · ${unresolvedCount} unresolved`}
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
              {/* Same treatment, its own word. A check that came back with no
                  answer still ran, so it is appended, not deducted. */}
              {unresolvedCount > 0 && ` · ${unresolvedCount} unresolved`}
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
            // The task RAN and DISPATCHED a check that has not come back. Same
            // defect as the rail, one register lower: a green tick here reports
            // a verdict no provider has returned, and this row is the only
            // place the open check is visible at all.
            //
            // Ranked below every failure state above and gated on `isDone` for
            // the same reason `exception` is — the artefacts exist whether or
            // not the agent reached them, so an ungated read would show a task
            // nobody has started as waiting on something.
            const awaitingHere =
              isDone && !isFailed && !isHalted && !isSkipped && !exception && art?.kind === "checks"
                ? art.rows.filter((r) => r.state === "running").length
                : 0
            const tripBeat = beatOf(i)
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
                            ? exception.severity === "warn"
                              // An unresolved check is not a failed one. Amber
                              // says "nothing came back to compare against";
                              // red would say the comparison was made and lost.
                              ? "border-warning/45 bg-warning/15 text-warning"
                              : "border-destructive/45 bg-destructive/15 text-destructive"
                            : awaitingHere > 0
                              ? "border-warning/45 bg-warning/15 text-warning"
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
                  ) : awaitingHere > 0 ? (
                    <PulseDot />
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
                    <p
                      className={cn(
                        "mt-1 text-xs font-medium leading-relaxed",
                        exception.severity === "warn" ? "text-warning" : "text-destructive",
                      )}
                    >
                      {/* "Unresolved", not "Exception": nothing was found to be
                          wrong, the answer simply never arrived. Calling it an
                          exception would report a finding the check never
                          made. */}
                      {exception.severity === "warn" ? "Unresolved" : "Exception"} ·{" "}
                      {exception.headline}
                      <span className="block font-normal text-muted-foreground">
                        {exception.detail}
                      </span>
                    </p>
                  )}
                  {/* Says WHO is being waited on. Without it the amber reads as
                      a problem with the merchant, when the file is legitimate
                      and the delay is entirely on the provider's side. */}
                  {awaitingHere > 0 && (
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-medium leading-relaxed text-warning">
                      <InProgressTag />
                      <span className="font-normal text-muted-foreground">
                        {awaitingHere === 1 ? "1 check is" : `${awaitingHere} checks are`} still out
                        with the provider — nothing is needed from you.
                      </span>
                    </p>
                  )}
                  {/* Which tasks leave the agent, visible without opening any of
                      them. The absence of this chip is as informative as its
                      presence — on Underwriting the parse and the policy flag
                      carry none, because the agent really does do those. */}
                  {task.delegate && <DelegationChip delegate={task.delegate} beat={tripBeat} />}
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
        {/* `flex flex-col` is load-bearing, not tidiness: the inspector's empty
            state is `h-full`, which resolved against the whole 22rem and — once
            the strip above it took real height — pushed its text straight
            through the handoffs section below. The strip sizes to content, the
            inspector takes the remainder. */}
        <div className="flex min-h-[22rem] flex-col bg-white/35">
          {/* ABOVE the artefact, because it says where the artefact came from.
              Underneath it would read as a footnote to a result the agent had
              already been credited with producing. */}
          {step.tasks[selected]?.delegate && (
            <div className="shrink-0 border-b border-border px-5 py-4">
              <DelegationTrace
                delegate={step.tasks[selected].delegate}
                beat={beatOf(selected)}
              />
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col">
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
              // The same `blockingFinding` the badge and the task rows read, so
              // the handoff cannot report an approval over a step the panel
              // directly above it is calling blocked.
              hasFinding={finding !== null}
              /* Whether the agent has actually been here. Without it the panel
                 synthesised a settled handoff from position alone, so a step
                 nobody had run reported "Approved by you · date not recorded" —
                 a party recorded as having answered a request that was never
                 sent. Same `stepHasRun` the finding above and the check count
                 beside it read. */
              hasRun={stepHasRun(merchant, step.id, played)}
              /* The state model's own verdict, and the SAME `state` that decides
                 whether this card opens at 0/4 tasks or fully run. The panel
                 used to re-derive this from `merchant.currentStep` and
                 `riskLane.verdict`, which is the fixture's raw assertion before
                 `laneState` has applied the rules that can overturn it — so the
                 header could say "Ready · 0/4 tasks" while the handoffs beneath
                 it showed green and claimed an approval nobody had given. */
              laneDone={state === "done"}
              // What an approval taken here would be ABOUT, so the record can
              // later tell whether the design has moved underneath it.
              basis={decisionBasis(step.id, merchant, theme)}
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
            {status === "done" &&
              (finding ? (
                /* The run reached the end of its task list, but a step whose
                   own output records a failure has not "completed" in the
                   sense this line was claiming — and "waiting on your
                   decision" invited a decision the gate below has already
                   withdrawn. Both halves were wrong, so both are replaced:
                   the run STOPPED, and what it is waiting on is the fix, not
                   the acquirer. Warning tone, not success. */
                <div className="animate-trace-in pt-0.5 text-warning">
                  {`!!  agent run stopped — ${finding.headline.toLowerCase().replace(/\.$/, "")}`}
                </div>
              ) : findingCleared ? (
                /* The fix landed OUTSIDE, so neither of the other two lines is
                   true: the run did not clear this, and it did not complete
                   cleanly either — it stopped, and a person resolved the thing
                   it stopped on. Without this the step flipped from "agent run
                   stopped" straight to "agent run complete — nothing further
                   required", crediting the agent with work it had not done and
                   leaving no trace of the only event that actually moved the
                   file. The events written alongside carry the same sentence,
                   but nothing renders them today, so a receipt in the data is
                   not a receipt the reader can see. */
                <div className="animate-trace-in pt-0.5 text-success">
                  {"ok  finding resolved outside the platform — not by this run"}
                </div>
              ) : (
                <div className="animate-trace-in pt-0.5 text-success">
                  {/* The mono face has no U+2713, which rendered as tofu. */}
                  {"ok  agent run complete — "}
                  {/* Read from LIVE state, not the static map: once a handoff is
                      settled the trace must stop saying it is waiting on them. */}
                  {(() => {
                    // Already inside the `!finding` branch, so this is `false`
                    // by construction — passed anyway so the argument list
                    // cannot be read as "findings do not apply here".
                    const w = waitingOn(step.id, merchant.id, handoffs, merchant.currentStep, false)
                    return w === "acquirer"
                      ? "waiting on your decision"
                      : w === "merchant"
                        ? "waiting on the merchant"
                        : w === "ingenico"
                          ? "waiting on Ingenico"
                          : "nothing further required"
                  })()}
                </div>
              ))}
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
