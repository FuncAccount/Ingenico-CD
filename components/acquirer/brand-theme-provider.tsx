"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { Merchant } from "@/lib/acquirer-data"
import { defaultTheme, type BrandTheme } from "@/lib/branding"

/**
 * THE MERCHANT'S BRAND DESIGN, held above the screen switch.
 *
 * It was `useState` inside `MerchantJourney`, which made it invisible to the
 * sign-off screen — so "Approve branding" there committed a decision about a
 * design that surface had never seen, and could not have shown you. Approving
 * a thing you cannot look at is not an approval.
 *
 * Keyed by merchant, and storing ONLY overrides: an absent entry means "nobody
 * has touched this merchant's design", which is a different and more useful
 * claim than holding a copy of the default. It is also what lets `hasOverride`
 * answer "is there anything to reset" without comparing structures.
 */
interface BrandThemeContextValue {
  /** The live design for this merchant — their edit if they made one, the
   *  agent's proposal otherwise. */
  themeFor: (merchant: Merchant) => BrandTheme
  setTheme: (merchantId: string, theme: BrandTheme) => void
  /** Drop the override, returning to the agent's proposal. Deleting the key
   *  rather than writing the default back, so "unedited" stays expressible. */
  resetTheme: (merchantId: string) => void
  hasOverride: (merchantId: string) => boolean
}

/** No default value — a screen mounting outside the provider would silently
 *  read the agent's proposal and report it as the merchant's live design. */
const BrandThemeContext = createContext<BrandThemeContextValue | null>(null)

export function BrandThemeProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, BrandTheme>>({})

  const themeFor = useCallback(
    (merchant: Merchant) => overrides[merchant.id] ?? defaultTheme(merchant),
    [overrides],
  )

  const setTheme = useCallback((merchantId: string, theme: BrandTheme) => {
    setOverrides((prev) => ({ ...prev, [merchantId]: theme }))
  }, [])

  const resetTheme = useCallback((merchantId: string) => {
    setOverrides((prev) => {
      if (!(merchantId in prev)) return prev
      const next = { ...prev }
      delete next[merchantId]
      return next
    })
  }, [])

  const hasOverride = useCallback((merchantId: string) => merchantId in overrides, [overrides])

  const value = useMemo(
    () => ({ themeFor, setTheme, resetTheme, hasOverride }),
    [themeFor, setTheme, resetTheme, hasOverride],
  )

  return <BrandThemeContext.Provider value={value}>{children}</BrandThemeContext.Provider>
}

export function useBrandTheme(): BrandThemeContextValue {
  const ctx = useContext(BrandThemeContext)
  if (!ctx) throw new Error("useBrandTheme must be used inside <BrandThemeProvider>")
  return ctx
}
