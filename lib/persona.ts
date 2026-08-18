/**
 * WHO IS LOOKING.
 *
 * Two parties use this platform and they are not two skins on one screen —
 * they answer different questions and, more importantly, they are allowed to
 * do different things.
 *
 *   Acquirer  — owns the merchant relationship. The only party that may sign a
 *               regulated decision. Works one merchant at a time.
 *   Ingenico  — operates the platform and the estate. Runs the agent, builds
 *               and ships the devices, and carries the fleet. Works across
 *               every acquirer at once.
 *
 * The boundary is held here as DATA rather than left to each screen to
 * remember, because the failure mode is silent: a screen that simply omits an
 * action it should not offer looks identical to a screen where someone forgot
 * to build it. A named limit can be rendered; an omission cannot.
 */
export type Persona = "acquirer" | "ingenico"

export type PersonaProfile = {
  id: Persona
  /** Short label for the switch itself. */
  label: string
  /** The organisation this person works for. */
  org: string
  user: string
  initials: string
  /** Badge shown beside the wordmark, so the product names its own audience. */
  chip: string
  /** One line: what this person is here to do. */
  remit: string
  /**
   * Whether this party may take a regulated sign-off. Only the acquirer may.
   * Ingenico can prepare, evidence and chase one — it cannot take it.
   */
  maySignRegulated: boolean
  /**
   * The standing edge of this role, phrased as a property of the ROLE and never
   * of any one merchant. Always rendered, so the absence of a control reads as
   * a decision rather than an unfinished screen.
   */
  boundary: string
}

export const PERSONAS: Record<Persona, PersonaProfile> = {
  acquirer: {
    id: "acquirer",
    label: "Acquirer",
    org: "Northgate Acquiring",
    user: "Priya Nair",
    initials: "PN",
    chip: "Agentic Acquirer",
    remit: "Submit merchants, sign the regulated calls, watch your own book.",
    maySignRegulated: true,
    boundary:
      "Device build, key injection and fleet operations sit with Ingenico. You see their state; you do not run them.",
  },
  ingenico: {
    id: "ingenico",
    label: "Ingenico",
    org: "Ingenico · Deployment & Operations",
    user: "Marc Lefèvre",
    initials: "ML",
    chip: "Deployment & Ops",
    remit:
      "Run the agent across every acquirer's onboarding, and clear what it cannot.",
    maySignRegulated: false,
    boundary:
      "Regulated sign-off stays with the acquirer. You can prepare a decision and chase it — you cannot take it.",
  },
}

export function personaProfile(p: Persona): PersonaProfile {
  return PERSONAS[p]
}
