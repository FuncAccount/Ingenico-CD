"use client"

import { useMemo, useState } from "react"
import {
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"

const SECTORS = [
  "Hospitality",
  "Retail",
  "Pharmacy",
  "Health & Fitness",
  "Automotive",
  "Leisure",
]

const VOLUME_BANDS = [
  "Under €500k / yr",
  "€500k – €2m / yr",
  "€2m – €5m / yr",
  "€5m – €10m / yr",
  "Over €10m / yr",
]

function recommend(sector: string, volume: string): string | null {
  if (!sector && !volume) return null
  if (sector === "Hospitality")
    return "3× A920 + softPOS — mobile-first, pay-at-table for similar hospitality merchants."
  if (sector === "Retail")
    return volume.includes("10m") || volume.includes("5m")
      ? "8× Move 5000 — multi-lane countertop for high-volume retail."
      : "4× A920 — flexible countertop and queue-busting for retail floors."
  if (sector === "Pharmacy")
    return "2× Desk 5000 — fixed countertop with compliant receipt handling."
  if (sector === "Health & Fitness")
    return "4× softPOS — phone-based tap-to-pay, no hardware to manage."
  if (sector === "Automotive")
    return "6× Desk 5000 — service-desk countertop with high-ticket handling."
  if (sector === "Leisure")
    return "3× Move 5000 + softPOS — portable across sites plus phone backup."
  return "Recommendation forms as you add sector and volume."
}

export function SubmitMerchant({
  onSubmitted,
}: {
  onSubmitted: () => void
}) {
  const [name, setName] = useState("")
  const [sector, setSector] = useState("")
  const [location, setLocation] = useState("")
  const [volume, setVolume] = useState("")
  const [terminals, setTerminals] = useState("")
  const [phase, setPhase] = useState<"form" | "kickoff" | "done">("form")

  const recommendation = useMemo(
    () => recommend(sector, volume),
    [sector, volume],
  )

  const canSubmit = name && sector && location && volume

  function handleSubmit() {
    setPhase("kickoff")
    setTimeout(() => setPhase("done"), 1600)
  }

  if (phase !== "form") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="rounded-2xl glass p-8 text-center">
          {phase === "kickoff" ? (
            <>
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
              </span>
              <h2 className="mt-5 text-xl font-semibold text-foreground">
                Agent kicking off underwriting
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Verifying identity and parsing documents for{" "}
                <span className="font-medium text-foreground">{name}</span>…
              </p>
            </>
          ) : (
            <>
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
                <CheckCircle2 className="h-7 w-7 text-success" />
              </span>
              <h2 className="mt-5 text-xl font-semibold text-foreground">
                {name} submitted
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                The agent has started underwriting automatically. Your merchant
                is now in the portfolio at{" "}
                <span className="font-mono font-semibold text-primary">02 Underwrite</span>{" "}
                and will return to you for regulated sign-off.
              </p>
              <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                <button
                  onClick={onSubmitted}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  View in portfolio
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Submit a merchant
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You own the customer. Add the details and the agent recommends the
          right kit as you go.
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Form */}
        <div className="rounded-2xl glass p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Business name" className="sm:col-span-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Harbour Bakehouse"
                className="input-base"
              />
            </Field>

            <Field label="Sector">
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className="input-base"
              >
                <option value="">Select sector</option>
                {SECTORS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Location">
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, country"
                className="input-base"
              />
            </Field>

            <Field label="Expected card volume">
              <select
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                className="input-base"
              >
                <option value="">Select band</option>
                {VOLUME_BANDS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Terminals needed (optional)">
              <input
                value={terminals}
                onChange={(e) => setTerminals(e.target.value)}
                placeholder="Override the recommendation"
                className="input-base"
              />
            </Field>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
            <p className="text-xs text-muted-foreground">
              Submitting starts underwriting automatically.
            </p>
            <button
              disabled={!canSubmit}
              onClick={handleSubmit}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
                canSubmit
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "cursor-not-allowed bg-secondary text-muted-foreground",
              )}
            >
              Submit merchant
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Live agent panel */}
        <aside className="h-fit rounded-xl border border-primary/25 bg-primary/[0.04] p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-semibold text-foreground">
                Ingenico agent
              </span>
              <span className="mt-0.5 text-[11px] font-medium text-primary">
                Step 01 · Augment
              </span>
            </div>
          </div>

          <div className="mt-4 space-y-3 text-sm">
            {recommendation ? (
              <div className="rounded-lg border border-primary/20 bg-card p-3.5">
                <p className="text-xs font-medium text-primary">
                  Recommended kit
                </p>
                <p className="mt-1 text-sm text-foreground">{recommendation}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pick a sector and volume and I&apos;ll recommend terminals from
                similar merchants in your book.
              </p>
            )}

            {name && (
              <p className="text-xs text-muted-foreground">
                Once you submit, I&apos;ll verify{" "}
                <span className="font-medium text-foreground">{name}</span>,
                parse documents, score risk, and hand the regulated call back to
                you.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  )
}
