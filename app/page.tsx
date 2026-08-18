"use client"

import { useMemo, useState } from "react"
import { TopNav } from "@/components/acquirer/top-nav"
import { PortfolioOverview } from "@/components/acquirer/portfolio-overview"
import { SubmitMerchant } from "@/components/acquirer/submit-merchant"
import { SignOff } from "@/components/acquirer/sign-off"
import { MerchantJourney } from "@/components/acquirer/merchant-journey"
import { MERCHANTS, type Merchant } from "@/lib/acquirer-data"
import { applyDecisions, awaitingSignOff } from "@/lib/decisions"
import { DecisionsProvider, useDecisions } from "@/components/acquirer/decisions-provider"
import { EstateView } from "@/components/ingenico/estate-view"
import { IngenicoJourney } from "@/components/ingenico/ingenico-journey"
import { FleetView } from "@/components/ingenico/fleet-view"
import {
  DeploymentsView,
  pendingReleases,
  type Releases,
} from "@/components/ingenico/deployments-view"
import { estateRows, ALL_JOURNEYS, acquirerOf } from "@/lib/estate"
import { fleetDevices } from "@/lib/devices"
import type { Persona } from "@/lib/persona"
import type { AcquirerScreen, IngenicoScreen, AnyScreen } from "@/lib/nav"

export default function Page() {
  return (
    <DecisionsProvider>
      <PlatformApp />
    </DecisionsProvider>
  )
}

function PlatformApp() {
  const [persona, setPersona] = useState<Persona>("acquirer")
  // One screen per seat, not one shared value. Switching seat should not carry
  // "submit merchant" into a product that never submits merchants, and coming
  // back should land where you left.
  const [acqScreen, setAcqScreen] = useState<AcquirerScreen>("portfolio")
  const [ingScreen, setIngScreen] = useState<IngenicoScreen>("estate")

  const [selected, setSelected] = useState<Merchant | undefined>(undefined)
  const [ingSelected, setIngSelected] = useState<Merchant | undefined>(undefined)
  const [signoffFocus, setSignoffFocus] = useState<string | undefined>(undefined)
  const [releases, setReleases] = useState<Releases>({})

  const { decisions } = useDecisions()

  const signoffCount = useMemo(() => awaitingSignOff(MERCHANTS, decisions), [decisions])

  // Both badges derive from the same records their screens render, so a tab
  // can never advertise a number the page underneath disagrees with.
  const deployCount = useMemo(
    () => pendingReleases(estateRows(decisions), releases).length,
    [decisions, releases],
  )
  const fleetCount = useMemo(
    () =>
      fleetDevices(ALL_JOURNEYS, acquirerOf).filter(
        (d) => d.state === "offline" || d.state === "degraded",
      ).length,
    [],
  )

  const live = useMemo(() => applyDecisions(MERCHANTS, decisions), [decisions])
  const selectedLive = selected ? live.find((m) => m.id === selected.id) : undefined

  function navigate(s: AnyScreen) {
    if (persona === "acquirer") {
      if (s === "signoff") setSignoffFocus(undefined)
      setAcqScreen(s as AcquirerScreen)
    } else {
      setIngScreen(s as IngenicoScreen)
    }
  }

  function openIngenicoMerchant(m: Merchant) {
    setIngSelected(m)
    setIngScreen("journey")
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
            />
          )}
          {acqScreen === "submit" && (
            <SubmitMerchant onSubmitted={() => setAcqScreen("portfolio")} />
          )}
          {acqScreen === "signoff" && (
            <SignOff
              focusId={signoffFocus}
              onBackToPortfolio={() => setAcqScreen("portfolio")}
            />
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
          {ingScreen === "estate" && <EstateView onOpen={openIngenicoMerchant} />}
          {ingScreen === "deploy" && (
            <DeploymentsView
              releases={releases}
              onRelease={(id) =>
                setReleases((r) => ({
                  ...r,
                  // Stamped when the release is taken, not formatted at render.
                  [id]: new Date().toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                }))
              }
              onOpen={openIngenicoMerchant}
            />
          )}
          {ingScreen === "journey" && (
            <IngenicoJourney merchant={ingSelected} onSelectMerchant={setIngSelected} />
          )}
          {ingScreen === "fleet" && <FleetView />}
        </>
      )}
    </div>
  )
}
