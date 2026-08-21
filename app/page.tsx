"use client"

import { useMemo, useState } from "react"
import { TopNav } from "@/components/acquirer/top-nav"
import { PortfolioOverview } from "@/components/acquirer/portfolio-overview"
import { SubmitMerchant } from "@/components/acquirer/submit-merchant"
import { SignOff } from "@/components/acquirer/sign-off"
import { MerchantJourney } from "@/components/acquirer/merchant-journey"
import { type Merchant } from "@/lib/acquirer-data"
import { BookProvider, useBook } from "@/components/acquirer/book-provider"
import { applyDecisions, awaitingSignOff } from "@/lib/decisions"
import { DecisionsProvider, useDecisions } from "@/components/acquirer/decisions-provider"
import { ProgressProvider, useProgress } from "@/components/acquirer/progress-provider"
import { BrandThemeProvider, useBrandTheme } from "@/components/acquirer/brand-theme-provider"
import { haltedByMerchant } from "@/lib/artifacts"
import { DemoProvider } from "@/components/acquirer/demo-provider"
import { Dashboard } from "@/components/ingenico/dashboard"
import { Deployments } from "@/components/ingenico/deployments"
import { Estate } from "@/components/ingenico/estate"
import { IngenicoJourney } from "@/components/ingenico/ingenico-journey"
import { estateRows, ALL_JOURNEYS, acquirerOf, laneOf } from "@/lib/estate"
import { fleetDevices } from "@/lib/devices"
import type { Persona } from "@/lib/persona"
import type { AcquirerScreen, IngenicoScreen, AnyScreen } from "@/lib/nav"

export default function Page() {
  return (
    <DecisionsProvider>
      {/* Outermost of the state providers: the book is what the others annotate.
          Holds the writable merchant list (so a submission has somewhere to go)
          and the order per merchant (so editing the kit survives the navigation
          to sign-off, which unmounts the journey). */}
      <BookProvider>
      {/* Above the screen switch below, so completing a step survives the
          navigation to the screen that completes it — see ProgressProvider. */}
      <ProgressProvider>
        {/* Same reason, for the brand design: the cockpit and the sign-off
            screen are two screens in the switch below, and while the design
            lived in the cockpit, "Approve branding" over on the sign-off screen
            was committing a decision about a design it had never seen. */}
        <BrandThemeProvider>
          <DemoProvider>
            <PlatformApp />
          </DemoProvider>
        </BrandThemeProvider>
      </ProgressProvider>
      </BookProvider>
    </DecisionsProvider>
  )
}

function PlatformApp() {
  const [persona, setPersona] = useState<Persona>("acquirer")
  // One screen per seat, not one shared value. Switching seat should not carry
  // "submit merchant" into a product that never submits merchants, and coming
  // back should land where you left.
  const [acqScreen, setAcqScreen] = useState<AcquirerScreen>("portfolio")
  const [ingScreen, setIngScreen] = useState<IngenicoScreen>("dashboard")

  const [selected, setSelected] = useState<Merchant | undefined>(undefined)
  // The open order. Not a screen — a journey is what an order opens into, so
  // this rides ON TOP of the deployments screen rather than beside it.
  const [openOrder, setOpenOrder] = useState<Merchant | undefined>(undefined)
  const [signoffFocus, setSignoffFocus] = useState<string | undefined>(undefined)

  const { decisions } = useDecisions()
  const { merchants } = useBook()

  const signoffCount = useMemo(
    () => awaitingSignOff(merchants, decisions),
    [merchants, decisions],
  )

  // Badges derive from the same records their screens render, so a tab can
  // never advertise a number the page underneath disagrees with.
  const deployCount = useMemo(
    () => estateRows(decisions).filter((r) => laneOf(r) === "ingenico").length,
    [decisions],
  )
  const fleetCount = useMemo(
    () =>
      fleetDevices(ALL_JOURNEYS, acquirerOf).filter(
        (d) => d.state === "offline" || d.state === "degraded",
      ).length,
    [],
  )

  /* Halts feed the status here too. This list is what gets handed to the
     journey, so without it a file could arrive at its own cockpit labelled
     "On track" while the rail beneath the label drew the halt. */
  const { themeFor } = useBrandTheme()
  /* `playedFor` travels with `themeFor`, for the same reason: a brand finding
     needs both the live theme it is measured against AND the fact that the
     agent ran. Without the second, the rules convict a step nobody has played. */
  const { playedFor } = useProgress()
  const halted = useMemo(
    () => haltedByMerchant(merchants, themeFor, (m) => playedFor(m.id)),
    [merchants, themeFor, playedFor],
  )
  const live = useMemo(
    () => applyDecisions(merchants, decisions, halted),
    [merchants, decisions, halted],
  )
  const selectedLive = selected ? live.find((m) => m.id === selected.id) : undefined

  function navigate(s: AnyScreen) {
    if (persona === "acquirer") {
      if (s === "signoff") setSignoffFocus(undefined)
      setAcqScreen(s as AcquirerScreen)
    } else {
      // Clicking a tab always lands on that tab's own view, never on a drill-in
      // left over from last time.
      setOpenOrder(undefined)
      setIngScreen(s as IngenicoScreen)
    }
  }

  function openIngenicoOrder(m: Merchant) {
    setOpenOrder(m)
    setIngScreen("deploy")
  }

  return (
    <div className="min-h-screen">
      <TopNav
        active={persona === "acquirer" ? acqScreen : ingScreen}
        onNavigate={navigate}
        counts={{ signoff: signoffCount, deploy: deployCount, fleet: fleetCount }}
        persona={persona}
        onPersonaChange={setPersona}
      />

      {persona === "acquirer" ? (
        <>
          {acqScreen === "portfolio" && (
            <PortfolioOverview
              onSubmit={() => setAcqScreen("submit")}
              onOpenMerchant={(m) => {
                setSelected(m)
                setAcqScreen("journey")
              }}
              onOpenSignoff={(m) => {
                setSignoffFocus(m.id)
                setAcqScreen("signoff")
              }}
              // No focus id — the tile counts the queue, it does not name a
              // merchant, so opening it must not pick one on your behalf.
              onOpenQueue={() => {
                setSignoffFocus(undefined)
                setAcqScreen("signoff")
              }}
            />
          )}
          {acqScreen === "submit" && (
            <SubmitMerchant
              // The form owns the fields; the book owns the record. Passing the
              // created merchant back means "View in portfolio" can land on a
              // book that already contains it, rather than on the old one.
              onSubmitted={() => setAcqScreen("portfolio")}
              onOpenMerchant={(m) => {
                setSelected(m)
                setAcqScreen("journey")
              }}
            />
          )}
          {acqScreen === "signoff" && (
            <SignOff focusId={signoffFocus} onBackToPortfolio={() => setAcqScreen("portfolio")} />
          )}
          {acqScreen === "journey" && (
            <MerchantJourney
              merchant={selectedLive}
              onSelectMerchant={setSelected}
              onOpenSignoff={(m) => {
                setSignoffFocus(m.id)
                setAcqScreen("signoff")
              }}
            />
          )}
        </>
      ) : (
        <>
          {ingScreen === "dashboard" && (
            <Dashboard onGo={(s) => navigate(s)} onOpenOrder={openIngenicoOrder} />
          )}
          {ingScreen === "deploy" &&
            (openOrder ? (
              <IngenicoJourney merchant={openOrder} onSelectMerchant={setOpenOrder} />
            ) : (
              <Deployments onOpenOrder={openIngenicoOrder} />
            ))}
          {ingScreen === "estate" && <Estate />}
        </>
      )}
    </div>
  )
}
