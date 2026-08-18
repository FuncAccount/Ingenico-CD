"use client"

import { useMemo, useState } from "react"
import {
  BadgeCheck,
  CheckCircle2,
  FileText,
  Fingerprint,
  Gauge,
  MessageSquareReply,
  Palette,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react"
import {
  MERCHANTS,
  bandTone,
  stepById,
  type Merchant,
} from "@/lib/acquirer-data"
import { decisionAtStep, signOffQueue } from "@/lib/decisions"
import { useDecisions } from "@/components/acquirer/decisions-provider"
import { fmtDateTime } from "@/lib/handoffs"
import { cn } from "@/lib/utils"

export function SignOff({
  focusId,
  onBackToPortfolio,
}: {
  focusId?: string
  onBackToPortfolio: () => void
}) {
  // The working set: everyone who was waiting on you. Membership is stable on
  // purpose — a merchant disappearing the instant you sign would take the
  // confirmation with it and you could not review what you just did. What
  // changes is each one's recorded decision, read from the shared store.
  const queue = useMemo(() => signOffQueue(MERCHANTS), [])
  const [selectedId, setSelectedId] = useState<string>(
    focusId && queue.some((m) => m.id === focusId)
      ? focusId
      : (queue[0]?.id ?? ""),
  )
  const { decisions, record } = useDecisions()

  const selected = queue.find((m) => m.id === selectedId)

  if (!selected) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
          <CheckCircle2 className="h-7 w-7 text-success" />
        </span>
        <h1 className="mt-5 text-xl font-semibold text-foreground">
          Nothing awaiting your sign-off
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The agent will surface the next regulated decision here.
        </p>
        <button
          onClick={onBackToPortfolio}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Back to portfolio
        </button>
      </div>
    )
  }

  // Scoped to the gate the merchant is actually standing at, so an underwriting
  // sign-off cannot silently satisfy a branding approval further down the line.
  const decision = decisionAtStep(decisions, selected.id, selected.currentStep)
  const isBranding = selected.currentStep === 4
  const step = stepById(selected.currentStep)

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Decisions awaiting you
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The agent has done the analysis. You own the final regulated call.
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Queue */}
        <aside className="flex flex-col gap-2">
          {queue.map((m) => {
            const d = decisionAtStep(decisions, m.id, m.currentStep)
            const branding = m.currentStep === 4
            const active = m.id === selectedId
            return (
              <button
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className={cn(
                  "flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors",
                  active
                    ? "border-primary/40 bg-primary/[0.04]"
                    : "border-border bg-card hover:border-primary/25",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{m.name}</span>
                  {!d ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-warning">
                      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                      Open
                    </span>
                  ) : d.kind === "signed" ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-success">
                      <CheckCircle2 className="h-3 w-3" />
                      Signed
                    </span>
                  ) : (
                    // Sending it back is not an approval, so it must not wear
                    // the success tick. The work is parked, not finished.
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                      <MessageSquareReply className="h-3 w-3" />
                      Sent back
                    </span>
                  )}
                </div>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {branding ? (
                    <Palette className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                  {branding ? "Branding approval" : "Underwriting sign-off"}
                </span>
              </button>
            )
          })}
        </aside>

        {/* Detail */}
        <div className="rounded-2xl glass glass-hover">
          {/* header */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-6">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 font-mono text-xs font-semibold",
                    bandTone(step.band),
                  )}
                >
                  {step.code} {step.name} · {step.band}
                </span>
              </div>
              <h2 className="mt-2 text-xl font-semibold text-foreground">
                {selected.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {selected.sector} · {selected.location} · {selected.size}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1.5 text-xs font-semibold text-warning">
              <TriangleAlert className="h-3.5 w-3.5" />
              {isBranding ? "Branding approval needed" : "Regulated sign-off needed"}
            </span>
          </div>

          {isBranding ? (
            <BrandingBody merchant={selected} />
          ) : (
            <UnderwritingBody merchant={selected} />
          )}

          {/* Decision panel */}
          <div className="border-t border-border bg-secondary/40 p-6">
            {!decision ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {isBranding
                    ? "Approve the receipts and on-device branding, or send it back for changes."
                    : "The agent's analysis is complete. Record your regulated decision."}
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={() => record(selected.id, "signed", selected.currentStep)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <BadgeCheck className="h-4 w-4" />
                    {isBranding ? "Approve branding" : "Sign off"}
                  </button>
                  <button
                    onClick={() => record(selected.id, "returned", selected.currentStep)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
                  >
                    <MessageSquareReply className="h-4 w-4" />
                    Request more from merchant
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full",
                    decision.kind === "signed" ? "bg-success/15" : "bg-muted",
                  )}
                >
                  {decision.kind === "signed" ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <MessageSquareReply className="h-5 w-5 text-muted-foreground" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {decision.kind === "signed"
                      ? isBranding
                        ? "Branding approved"
                        : "Signed off"
                      : "Sent back to merchant"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {decision.kind === "signed"
                      ? "The agent is advancing this merchant to the next step."
                      : "The agent has asked the merchant for more information and will re-surface this when ready."}{" "}
                    {/* Stamped when the decision was taken, not re-derived at
                        render, so it keeps reporting the real moment. */}
                    <span className="text-muted-foreground/80">
                      Recorded {fmtDateTime(decision.atIso)}.
                    </span>
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Fingerprint
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-4">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/12 text-success">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-sm text-foreground">{value}</p>
      </div>
    </div>
  )
}

function UnderwritingBody({ merchant }: { merchant: Merchant }) {
  const uw = merchant.underwriting
  if (!uw) return null
  const riskTone =
    uw.riskBand === "Low"
      ? "text-success"
      : uw.riskBand === "Medium"
        ? "text-warning"
        : "text-destructive"
  return (
    <div className="p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Completed by the agent
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <AgentRow icon={Fingerprint} label="Identity" value={uw.identity} />
        <AgentRow icon={FileText} label="Documents" value={uw.documents} />
        <div className="flex items-start gap-3 rounded-lg border border-border p-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/12 text-success">
            <Gauge className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Risk score
            </p>
            <p className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono text-lg font-semibold text-foreground tabular-nums">
                {uw.riskScore}
              </span>
              <span className={cn("text-sm font-semibold", riskTone)}>
                {uw.riskBand}
              </span>
            </p>
          </div>
        </div>
      </div>

      {uw.edgeCase && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="text-xs font-semibold text-warning">
              Edge case flagged for your review
            </p>
            <p className="mt-1 text-sm text-foreground">{uw.edgeCase}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function BrandingBody({ merchant }: { merchant: Merchant }) {
  return (
    <div className="p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Prepared by the agent
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <AgentRow
          icon={Palette}
          label="On-device branding"
          value="Merchant logo and colours applied to the terminal welcome screen."
        />
        <AgentRow
          icon={FileText}
          label="Receipt template"
          value="Localised receipt header, VAT line and return policy applied."
        />
        {/* Receipt preview */}
        <div className="sm:col-span-2 flex justify-center rounded-lg border border-dashed border-border bg-secondary/40 p-6">
          <div className="w-52 rounded-md bg-card p-4 shadow-sm">
            <p className="text-center text-sm font-semibold text-foreground">
              {merchant.name}
            </p>
            <p className="text-center text-[10px] text-muted-foreground">
              {merchant.location}
            </p>
            <div className="my-3 border-t border-dashed border-border" />
            <div className="space-y-1.5 font-mono text-[10px] text-muted-foreground">
              <div className="flex justify-between">
                <span>Sale</span>
                <span>€24.00</span>
              </div>
              <div className="flex justify-between">
                <span>VAT 21%</span>
                <span>€4.17</span>
              </div>
              <div className="flex justify-between font-semibold text-foreground">
                <span>Total</span>
                <span>€24.00</span>
              </div>
            </div>
            <div className="my-3 border-t border-dashed border-border" />
            <p className="text-center text-[9px] text-muted-foreground">
              Powered by Ingenico
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
