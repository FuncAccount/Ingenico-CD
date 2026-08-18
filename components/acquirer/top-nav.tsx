"use client"

import { cn } from "@/lib/utils"
import { AgentBar } from "@/components/acquirer/agent-bar"
import { PersonaMenu } from "@/components/persona-menu"
import { personaProfile, type Persona } from "@/lib/persona"
import {
  ACQUIRER_NAV,
  INGENICO_NAV,
  homeScreen,
  type AnyScreen,
} from "@/lib/nav"

export type { AcquirerScreen as Screen } from "@/lib/nav"

export function TopNav({
  active,
  onNavigate,
  counts,
  persona,
  onPersonaChange,
}: {
  active: AnyScreen
  onNavigate: (s: AnyScreen) => void
  /** One count per badged tab. Keyed by badge id so a tab can never end up
   *  captioning another queue's number. */
  counts: { signoff: number; deploy: number; fleet: number }
  persona: Persona
  onPersonaChange: (p: Persona) => void
}) {
  const me = personaProfile(persona)
  const isAcquirer = persona === "acquirer"
  const nav = isAcquirer ? ACQUIRER_NAV : INGENICO_NAV

  return (
    <header className="sticky top-0 z-30 border-b border-white/60 bg-white/55 backdrop-blur-2xl backdrop-saturate-150 edge-lit">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-6">
        <button
          onClick={() => onNavigate(homeScreen(persona))}
          className="flex items-center gap-3"
          aria-label="Ingenico platform home"
        >
          {/* Ingenico wordmark: lowercase, under its signature overline bar */}
          <span className="relative inline-block pt-1.5">
            <span className="absolute left-0 top-0 h-[2px] w-[58%] rounded-full bg-foreground" />
            <span className="text-[19px] font-semibold lowercase leading-none tracking-tight text-foreground">
              ingenico
            </span>
          </span>
        </button>
        <span className="hidden h-6 w-px bg-border sm:block" />
        {/* The badge that names the product is also the control that changes
            it. A separate toggle beside it would state the same fact twice. */}
        <PersonaMenu persona={persona} onChange={onPersonaChange} />

        <nav className="glass-pill ml-1 hidden items-center gap-1 rounded-full p-1 md:flex">
          {nav.map((item) => {
            const Icon = item.icon
            const isActive = active === item.id
            const badge = item.badge ? counts[item.badge] : 0
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={cn(
                  "relative flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground glow-soft"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
                {badge > 0 && (
                  <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-warning-foreground">
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {/* The agent bar answers questions about one acquirer's book. Under
              the Ingenico seat it would be answering across every acquirer,
              which is a different index and not yet built. */}
          {isAcquirer && <AgentBar onNavigate={onNavigate} />}
          <div className="hidden text-right sm:block">
            <p className="text-xs font-medium text-foreground">{me.user}</p>
            <p className="text-[11px] text-muted-foreground">{me.org}</p>
          </div>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-foreground ring-1 ring-border">
            {me.initials}
          </span>
        </div>
      </div>
    </header>
  )
}
