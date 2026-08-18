import {
  LayoutGrid,
  FilePlus2,
  ShieldCheck,
  Route,
  Boxes,
  PackageCheck,
  Radio,
} from "lucide-react"
import type { Persona } from "./persona"

/**
 * NAVIGATION, PER AUDIENCE.
 *
 * The two personas run the SAME shape of product — a book of merchants, a
 * queue of approvals, a per-merchant journey — because they are two seats
 * around one onboarding. What differs is the scope of the book (one acquirer's
 * vs every acquirer's), what each seat is allowed to approve, and the fact
 * that only Ingenico carries the physical estate once a terminal is live.
 *
 * Screens are two separate unions rather than one shared list. A single union
 * would let `screen = "submit"` survive a switch into Ingenico, rendering a
 * merchant-submission form for the party that never submits merchants.
 */
export type AcquirerScreen = "portfolio" | "submit" | "signoff" | "journey"
export type IngenicoScreen = "estate" | "deploy" | "journey" | "fleet"
export type AnyScreen = AcquirerScreen | IngenicoScreen

export type NavItem = {
  id: string
  label: string
  icon: typeof LayoutGrid
  /** Which count, if any, rides on this tab. Named so the badge cannot end up
   *  captioning a number from a different queue. */
  badge?: "signoff" | "deploy" | "fleet"
}

export const ACQUIRER_NAV: { id: AcquirerScreen; label: string; icon: typeof LayoutGrid; badge?: NavItem["badge"] }[] = [
  { id: "portfolio", label: "Portfolio", icon: LayoutGrid },
  { id: "submit", label: "Submit merchant", icon: FilePlus2 },
  { id: "signoff", label: "Sign-off", icon: ShieldCheck, badge: "signoff" },
  { id: "journey", label: "Merchant journey", icon: Route },
]

export const INGENICO_NAV: { id: IngenicoScreen; label: string; icon: typeof LayoutGrid; badge?: NavItem["badge"] }[] = [
  { id: "estate", label: "Estate", icon: Boxes },
  { id: "deploy", label: "Deployments", icon: PackageCheck, badge: "deploy" },
  { id: "journey", label: "Merchant journey", icon: Route },
  { id: "fleet", label: "Fleet", icon: Radio, badge: "fleet" },
]

export function homeScreen(p: Persona): AnyScreen {
  return p === "acquirer" ? "portfolio" : "estate"
}
