"use client"

import { useMemo, useState } from "react"
import { ArrowDownLeft, Check, MapPin, Radio, Wrench } from "lucide-react"
import { PIPELINE, stepById, type Merchant, type StepId } from "@/lib/acquirer-data"
import { acquirerOf, estateRows, ingenicoRole, type IngenicoRole } from "@/lib/estate"
import { useDecisions } from "@/components/acquirer/decisions-provider"
import {
  ConfigPane,
  OrderPane,
  ShipPane,
  TestPane,
} from "@/components/ingenico/deployment-workspace"
import { cn } from "@/lib/utils"

const ROLE_META: Record<IngenicoRole, { label: string; icon: typeof Wrench; hint: string }> = {
  inbound: {
    label: "Reported to us",
    icon: ArrowDownLeft,
    hint: "Decided by the acquirer. We are told the outcome.",
  },
  owned: { label: "Our work", icon: Wrench, hint: "Ingenico acts on this step." },
  field: { label: "On site", icon: MapPin, hint: "Happens at the merchant. We support." },
}

export function IngenicoJourney({
  merchant,
  onSelectMerchant,
}: {
  merchant?: Merchant
  onSelectMerchant: (m: Merchant | undefined) => void
}) {
  const { decisions } = useDecisions()
  const rows = useMemo(() => estateRows(decisions), [decisions])
  const live = merchant ? rows.find((r) => r.merchant.id === merchant.id)?.merchant : undefined
  const [step, setStep] = useState<StepId | null>(null)

  if (!live) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Merchant journey
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a journey from any book to see it from the deployment side.
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <button
              key={r.merchant.id}
              onClick={() => onSelectMerchant(r.merchant)}
              className="glass glass-hover rounded-2xl p-3.5 text-left"
            >
              <span className="block text-[13px] font-medium text-foreground">
                {r.merchant.name}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {r.acquirer} · step {r.merchant.currentStep}
              </span>
            </button>
          ))}
        </div>
      </main>
    )
  }

  const book = acquirerOf(live)
  const active: StepId = step ?? live.currentStep

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-5">
        <button
          onClick={() => onSelectMerchant(undefined)}
          className="text-[11px] font-medium text-primary hover:underline"
        >
          All journeys
        </button>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          {live.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {book} · {live.sector} · {live.location} · {live.terminals}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        <nav className="flex flex-col gap-1">
          {PIPELINE.map((s) => {
            const role = ingenicoRole(s.id)
            const Icon = ROLE_META[role].icon
            const done = s.id < live.currentStep
            const here = s.id === live.currentStep
            const on = s.id === active
            return (
              <button
                key={s.id}
                onClick={() => setStep(s.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors",
                  on ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-secondary",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    done
                      ? "bg-success/15 text-success"
                      : here
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground",
                  )}
                >
                  {done ? <Check className="h-3 w-3" /> : s.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-foreground">
                    {s.name}
                  </span>
                  <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                    <Icon className="h-3 w-3" />
                    {ROLE_META[role].label}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>

        <section>
          <StepPane merchant={live} step={active} book={book} />
        </section>
      </div>
    </main>
  )
}

function StepPane({
  merchant,
  step,
  book,
}: {
  merchant: Merchant
  step: StepId
  book: string
}) {
  const role = ingenicoRole(step)
  const meta = stepById(step)
  const reached = merchant.currentStep >= step

  return (
    <div className="flex flex-col gap-4">
      <div className="glass rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-foreground">
            {step}. {meta.name}
          </h2>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              role === "owned"
                ? "bg-primary/12 text-primary"
                : "bg-secondary text-muted-foreground",
            )}
          >
            {ROLE_META[role].label}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {ROLE_META[role].hint}
        </p>
      </div>

      {!reached ? (
        <div className="glass rounded-2xl p-4">
          {/* Not started is not the same as nothing to report. Saying which
              step the journey is actually on stops this reading as a blank. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Not started. {merchant.name} is on step {merchant.currentStep} —{" "}
            {stepById(merchant.currentStep).name}.
          </p>
        </div>
      ) : role === "inbound" ? (
        <InboundPane merchant={merchant} step={step} book={book} />
      ) : step === 3 ? (
        <OrderPane merchant={merchant} />
      ) : step === 5 ? (
        <ConfigPane merchant={merchant} />
      ) : step === 6 ? (
        <TestPane merchant={merchant} />
      ) : step === 7 ? (
        <ShipPane merchant={merchant} />
      ) : step === 8 ? (
        <FieldPane merchant={merchant} />
      ) : (
        <GoLivePane merchant={merchant} />
      )}
    </div>
  )
}

function InboundPane({
  merchant,
  step,
  book,
}: {
  merchant: Merchant
  step: StepId
  book: string
}) {
  const events = merchant.events.filter((e) => e.step === step)
  const line: Record<number, string> = {
    1: `${book} submitted the merchant and the expected volume.`,
    2: `${book} completed KYC and underwriting. We receive the outcome, not the file.`,
    4: `The branding pack arrived from ${book} and is attached to the build.`,
  }
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <ArrowDownLeft className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold text-foreground">Signal received</h3>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{line[step]}</p>

      {events.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
          {events.map((e, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                {e.time}
              </span>
              <span className="text-[12px] text-foreground">{e.text}</span>
            </li>
          ))}
        </ul>
      )}

      {/* The absence of a control is the statement. Without naming it, this
          screen looks like one where the buttons were never built. */}
      <p className="mt-3 rounded-xl bg-secondary px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Nothing to action. This decision sits with {book} under their licence —
        we hold the outcome so the build can proceed, and we cannot revisit it.
      </p>
    </div>
  )
}

function FieldPane({ merchant }: { merchant: Merchant }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold text-foreground">Installation on site</h3>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {merchant.terminalCount} unit{merchant.terminalCount === 1 ? "" : "s"} delivered to{" "}
        {merchant.location}. The merchant powers them on; keys inject at first
        connection. Nothing reports here until a device calls home — until then
        it has no uptime to show, which is different from being offline.
      </p>
    </div>
  )
}

function GoLivePane({ merchant }: { merchant: Merchant }) {
  const liveNow = merchant.currentStep >= 9
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-primary" />
        <h3 className="text-[13px] font-semibold text-foreground">Go-live</h3>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {liveNow
          ? `${merchant.name} is transacting. Its devices have moved out of onboarding and into the fleet, where they are monitored for the life of the estate.`
          : `Not yet live. Devices appear in the fleet once they have connected.`}
      </p>
    </div>
  )
}
