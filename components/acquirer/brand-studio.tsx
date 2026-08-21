"use client"

// The branding studio — design surface + live proof + the gate that decides
// whether the design may be approved.
//
// The previous version of this step rendered "apply device theme" as rows of
// text and claimed a preview it never drew. You cannot approve a look you
// cannot see, so the proof is the centre of this screen and the controls sit
// beside it.

import { useMemo, useState } from "react"
import { AlertTriangle, Check, Info, Lock, Wand2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Merchant } from "@/lib/acquirer-data"
import { brandingSettled, type BrandFocus } from "@/lib/artifacts"
import {
  ACQUIRER,
  DISPLAY_NAME_LIMIT,
  blockers,
  checkBrand,
  estateDrift,
  contrast,
  markVariantFor,
  readableOn,
  receiptProof,
  type BrandRule,
  type BrandTheme,
} from "@/lib/branding"

/* ------------------------------------------------------------------ swatches */

// A short palette keeps the studio a design tool rather than a colour picker.
// Two of these deliberately fail contrast against white ink, so the gate has
// something real to catch.
const SWATCHES = [
  "#0A1E3C",
  "#7A1E2B",
  "#1F6F4A",
  "#2B2F77",
  "#B04A2F",
  "#E8C547",
  "#3C3C3C",
  "#00B9E4",
]

/* -------------------------------------------------------------------- device */

type ScreenId = "welcome" | "amount" | "pin" | "approved"

const SCREENS: { id: ScreenId; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "amount", label: "Amount" },
  { id: "pin", label: "PIN entry" },
  { id: "approved", label: "Approved" },
]

/** The terminal. Drawn rather than photographed so it always reflects the
 *  current theme instead of a screenshot taken at some earlier setting. */
function Terminal({ theme, screen }: { theme: BrandTheme; screen: ScreenId }) {
  const ink = theme.ink
  const ground = theme.primary
  // The PIN screen is deliberately NOT brand-coloured: PIN entry runs in the
  // device's secure mode, which no brand theme can reach. Showing it themed
  // would misrepresent what the customer will see.
  const secure = screen === "pin"

  return (
    <div className="flex flex-col items-center">
      <div className="w-[188px] rounded-[22px] border border-border bg-[#15171c] p-2 shadow-lg">
        {/* speaker + camera furniture, so it reads as hardware */}
        <div className="mx-auto mb-1.5 flex h-1.5 w-10 items-center justify-center rounded-full bg-white/15" />
        <div
          className="relative flex h-[236px] w-full flex-col overflow-hidden rounded-[12px]"
          style={{ background: secure ? "#101319" : ground, color: secure ? "#FFFFFF" : ink }}
        >
          {screen === "welcome" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 text-center">
              {theme.logoSupplied ? (
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-[15px] font-black"
                  style={{ background: ink, color: ground }}
                >
                  {theme.displayName.trim().charAt(0).toUpperCase() || "?"}
                </div>
              ) : null}
              <p className="text-[13px] font-bold leading-tight">
                {theme.displayName.slice(0, DISPLAY_NAME_LIMIT) || "—"}
              </p>
              <p className="text-[9px] opacity-70">Present card to pay</p>
            </div>
          )}

          {screen === "amount" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-3">
              <p className="text-[9px] uppercase tracking-wide opacity-70">Total</p>
              <p className="text-[30px] font-black leading-none tabular-nums">€24.80</p>
              <p className="mt-1 text-[9px] opacity-70">Tap, insert or swipe</p>
            </div>
          )}

          {screen === "pin" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3">
              <p className="text-[9px] uppercase tracking-wide text-white/60">Enter PIN</p>
              <div className="flex gap-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-2 w-2 rounded-full",
                      i < 2 ? "bg-white" : "border border-white/40",
                    )}
                  />
                ))}
              </div>
              <p className="mt-1 px-2 text-center text-[8px] leading-snug text-white/45">
                Secure mode — brand theming is suppressed by the device
              </p>
            </div>
          )}

          {screen === "approved" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: ink, color: ground }}
              >
                <Check className="h-5 w-5" strokeWidth={3} />
              </span>
              <p className="text-[13px] font-bold">Approved</p>
              <p className="text-[9px] tabular-nums opacity-70">€24.80 · 0X41B9</p>
            </div>
          )}

          {/* Co-brand footer: your mark, on every screen the theme can reach. */}
          {!secure && (
            <div
              className="flex items-center justify-center border-t py-1"
              style={{ borderColor: `${ink}22` }}
            >
              {/* Rendered in the authorised variant the rule measures, at full
                  opacity. Dimming it would make the proof disagree with the
                  contrast figure printed in the checks below. */}
              <span
                className="text-[7px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: markVariantFor(theme.primary).hex }}
              >
                {ACQUIRER.name}
              </span>
            </div>
          )}
        </div>
        <div className="mx-auto mt-1.5 h-1 w-8 rounded-full bg-white/15" />
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">AXIUM A920 · 480×800</p>
    </div>
  )
}

/* ------------------------------------------------------------------- receipt */

function Receipt({ theme, merchant }: { theme: BrandTheme; merchant: Merchant }) {
  const lines = receiptProof(theme, merchant)
  return (
    <div className="flex flex-col items-center">
      <div className="w-[188px] rounded-sm bg-white px-3 py-3 font-mono text-[9px] leading-[1.5] text-[#1a1a1a] shadow-md">
        {lines.map((l, i) =>
          l.align === "split" ? (
            <div key={i} className="flex justify-between gap-2">
              <span className={cn(l.weight === "bold" && "font-bold", l.system && "text-[#777]")}>
                {l.text}
              </span>
              <span className={cn("tabular-nums", l.weight === "bold" && "font-bold", l.system && "text-[#777]")}>
                {l.right}
              </span>
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                "text-center",
                l.weight === "bold" && "font-bold",
                l.system && "text-[#777]",
                !l.text && "h-2",
              )}
            >
              {l.text}
            </div>
          ),
        )}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">58 mm thermal proof</p>
    </div>
  )
}

/* --------------------------------------------------------------------- rules */

function RuleRow({ rule, onFix }: { rule: BrandRule; onFix: (r: BrandRule) => void }) {
  // `fixed` is muted and padlocked on purpose: it is a standing property of the
  // platform, not a check that examined this merchant, and it must not borrow
  // the green of something that was actually measured and passed.
  const tone =
    rule.state === "pass"
      ? { Icon: Check, cls: "text-success", ring: "bg-success/12" }
      : rule.state === "fail"
        ? { Icon: AlertTriangle, cls: "text-destructive", ring: "bg-destructive/12" }
        : rule.state === "fixed"
          ? { Icon: Lock, cls: "text-muted-foreground", ring: "bg-secondary" }
          : { Icon: Info, cls: "text-warning-foreground", ring: "bg-warning/15" }

  return (
    <div className="flex gap-2.5 px-3 py-2.5">
      <span
        className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", tone.ring)}
      >
        <tone.Icon className={cn("h-3 w-3", tone.cls)} strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-xs font-semibold text-foreground">{rule.label}</p>
          {rule.state === "fail" && rule.blocking && (
            <span className="rounded bg-destructive/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-destructive">
              Blocks approval
            </span>
          )}
          {rule.state === "advisory" && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              Advisory
            </span>
          )}
          {rule.state === "fixed" && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              Not configurable
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{rule.detail}</p>
        <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {rule.source}
        </p>
        {rule.fix && rule.state === "fail" && (
          <button
            onClick={() => onFix(rule)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            <Wand2 className="h-3 w-3" />
            {rule.fix.label}
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------- main */

/**
 * What the merchant actually sent us, item by item.
 *
 * This is the `assets` face of the step and it is deliberately NOT the theme
 * editor: "pull the assets" and "design with them" are different acts, and
 * rendering the same editor for both made the journey look stuck. An item the
 * merchant never supplied is named as a gap with the fallback that will ship
 * in its place — a silent default here is how a house-style receipt reaches a
 * customer under the merchant's name.
 */
function AssetInventory({ theme, merchant }: { theme: BrandTheme; merchant: Merchant }) {
  const items: { label: string; value: string | null; source: string; fallback?: string }[] = [
    {
      label: "Logo artwork",
      value: theme.logoSupplied ? "Received — vector, transparent ground" : null,
      source: "merchant onboarding upload",
      fallback: "Display name set in the brand typeface",
    },
    { label: "Brand colour", value: theme.primary.toUpperCase(), source: "sampled from supplied artwork" },
    { label: "Display name", value: theme.displayName, source: "merchant submission" },
    { label: "Receipt footer", value: theme.receiptFooter || null, source: "merchant submission", fallback: "Footer left blank on the printed receipt" },
    { label: "Trading address", value: merchant.location, source: "registered company record" },
  ]
  const missing = items.filter((i) => i.value === null).length

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Received from the merchant
          </p>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold",
              missing ? "bg-warning/15 text-warning-foreground" : "bg-success/12 text-success",
            )}
          >
            {missing ? `${missing} not supplied` : "Complete"}
          </span>
        </div>
        <div className="divide-y divide-border/50">
          {items.map((i) => (
            <div key={i.label} className="flex items-start justify-between gap-4 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-foreground">{i.label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{i.source}</p>
              </div>
              <div className="shrink-0 text-right">
                {i.value === null ? (
                  <>
                    <p className="text-[11px] font-medium text-warning-foreground">Not supplied</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{i.fallback}</p>
                  </>
                ) : (
                  <p className="max-w-[15rem] break-words text-[11px] text-foreground">{i.value}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Assets are taken as received. Nothing here is edited at this task — the design that uses
        them is drafted in <span className="font-medium text-foreground">Draft the device theme</span>.
      </p>
    </div>
  )
}

export function BrandStudio({
  merchant,
  theme,
  onTheme,
  focus,
}: {
  merchant: Merchant
  theme: BrandTheme
  onTheme: (t: BrandTheme) => void
  /** Which face of the studio to render. See `BrandFocus`. */
  focus: BrandFocus
}) {
  const [screen, setScreen] = useState<ScreenId>("welcome")
  const rules = useMemo(() => checkBrand(theme), [theme])
  const blocked = blockers(rules)
  /* Two different questions, deliberately two values. `settled` asks whether a
     band has ever been approved onto hardware — which is what disarms the gate;
     `drift` asks whether the current design has since moved away from it, and is
     null when it has not. A merchant can be settled with no drift (the common
     case), and that must render as neither an alarm nor a blocking count. */
  const settled = brandingSettled(merchant)
  const drift = useMemo(() => estateDrift(merchant, theme), [merchant, theme])

  const set = <K extends keyof BrandTheme>(k: K, v: BrandTheme[K]) => onTheme({ ...theme, [k]: v })

  if (focus === "assets") return <AssetInventory theme={theme} merchant={merchant} />

  return (
    <div className="space-y-4">
      {/* Proof first. The design is the subject of this step, so it leads. */}
      <div className="rounded-xl border border-border/70 bg-secondary/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Live proof
          </p>
          <div className="flex gap-1 rounded-lg bg-background/70 p-0.5">
            {SCREENS.map((s) => (
              <button
                key={s.id}
                onClick={() => setScreen(s.id)}
                aria-pressed={screen === s.id}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  screen === s.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-center gap-6">
          <Terminal theme={theme} screen={screen} />
          <Receipt theme={theme} merchant={merchant} />
        </div>
      </div>

      {/* Controls — only on the theme task. On the checks task the design is
          the thing being judged, and putting its editor beside the verdict
          invites you to change the subject rather than answer the question. */}
      {focus === "theme" && (
      <div className="rounded-xl border border-border/70 bg-white/60 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Design
        </p>

        <div className="space-y-3.5">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-foreground">
              Brand colour
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SWATCHES.map((c) => {
                const active = theme.primary.toLowerCase() === c.toLowerCase()
                // Surface the consequence on the control itself, so a failing
                // choice is visible before it is made rather than after.
                const weak = contrast(c, readableOn(c)) < 4.5
                return (
                  <button
                    key={c}
                    onClick={() => onTheme({ ...theme, primary: c, ink: readableOn(c) })}
                    aria-label={`Brand colour ${c}${weak ? " — low contrast" : ""}`}
                    aria-pressed={active}
                    className={cn(
                      "relative h-8 w-8 rounded-lg border-2 transition-transform",
                      active ? "scale-110 border-foreground" : "border-border/60 hover:scale-105",
                    )}
                    style={{ background: c }}
                  >
                    {weak && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-warning text-[7px] font-bold text-warning-foreground">
                        !
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="dn" className="text-[11px] font-medium text-foreground">
                Display name
              </label>
              <span
                className={cn(
                  "font-mono text-[10px] tabular-nums",
                  theme.displayName.length > DISPLAY_NAME_LIMIT
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {theme.displayName.length}/{DISPLAY_NAME_LIMIT}
              </span>
            </div>
            <input
              id="dn"
              value={theme.displayName}
              onChange={(e) => set("displayName", e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>

          <div>
            <label htmlFor="rf" className="mb-1.5 block text-[11px] font-medium text-foreground">
              Receipt footer
            </label>
            <input
              id="rf"
              value={theme.receiptFooter}
              onChange={(e) => set("receiptFooter", e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={theme.logoSupplied}
              onChange={(e) => set("logoSupplied", e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--primary)]"
            />
            <span className="text-[11px] leading-relaxed text-foreground">
              Merchant artwork on file
              <span className="block text-muted-foreground">
                Untick to see what ships if they never send a logo.
              </span>
            </span>
          </label>
        </div>
      </div>
      )}

      {/* DRIFT, not a breach. Sits above the checks because it reframes them:
          once terminals are in the field, a failing rule is no longer a thing
          you can approve your way out of. */}
      {drift && (
        <div className="rounded-xl border border-warning/40 bg-warning/8 p-3">
          <p className="text-xs font-semibold text-warning">
            Estate does not match this design
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-foreground/80">
            {drift.terminalCount}{" "}
            {drift.terminalCount === 1 ? "terminal is" : "terminals are"} in the field
            branded{" "}
            <span className="font-mono font-semibold">{drift.approved}</span>, the band
            this merchant was approved on. The studio is showing{" "}
            <span className="font-mono font-semibold">{drift.proposed}</span>.
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Changing the design here does not change hardware already installed — it
            schedules a refresh. The checks below describe the proposed design, not the
            devices on the counter.
          </p>
        </div>
      )}

      {/* Gate — the whole subject of the checks task, and a summary on the
          theme task so a failing edit is visible while it is being made. */}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-white/60">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Brand checks
          </p>
          {/* "N blocking" is a claim about what CANNOT PROCEED, so it is
              withheld once branding is settled: the build passed this gate and
              the terminals shipped, and a red count there sent people to
              re-approve something no approval can reach. The rules still render
              — they describe the proposed design honestly — but the headline
              says what they now are. */}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold",
              settled
                ? "bg-secondary text-muted-foreground"
                : blocked.length
                  ? "bg-destructive/12 text-destructive"
                  : "bg-success/12 text-success",
            )}
          >
            {settled
              ? "Reference only"
              : blocked.length
                ? `${blocked.length} blocking`
                : "All clear"}
          </span>
        </div>
        <div className="divide-y divide-border/50">
          {rules.map((r) => (
            <RuleRow
              key={r.id}
              rule={r}
              onFix={(rule) => rule.fix && onTheme(rule.fix.apply(theme))}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
