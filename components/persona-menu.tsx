"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { PERSONAS, personaProfile, type Persona } from "@/lib/persona"

/**
 * The product badge beside the wordmark IS the switch — there is no second
 * toggle. The badge already names which of the two products you are in
 * ("Agentic Acquirer" / "Deployment & Ops"), so a separate control sitting
 * next to it would be a second statement of the same fact, and the two could
 * drift.
 *
 * The menu names each seat's ORGANISATION and its LIMIT, because switching
 * seat is not a view preference: it changes who you are acting as and what
 * you are permitted to sign.
 */
export function PersonaMenu({
  persona,
  onChange,
}: {
  persona: Persona
  onChange: (p: Persona) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const me = personaProfile(persona)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", away)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("pointerdown", away)
      document.removeEventListener("keydown", esc)
    }
  }, [open])

  return (
    <div ref={box} className="relative hidden sm:block">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
          "bg-primary/12 text-primary hover:bg-primary/20",
        )}
      >
        {me.chip}
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="glass-solid absolute left-0 top-full z-50 mt-2 w-[19rem] rounded-2xl p-1.5 shadow-xl"
        >
          <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Switch seat
          </p>
          {(Object.keys(PERSONAS) as Persona[]).map((id) => {
            const p = personaProfile(id)
            const on = id === persona
            return (
              <button
                key={id}
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  onChange(id)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors",
                  on ? "bg-primary/10" : "hover:bg-secondary",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "ring-1 ring-border",
                  )}
                >
                  {on && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-foreground">
                    {p.chip}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {p.org} · {p.user}
                  </span>
                  {/* The limit travels with the seat. Reading it before you
                      switch is the point: it tells you what you will and will
                      not be able to do once you are in there. */}
                  <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                    {p.maySignRegulated
                      ? "Signs the regulated decisions."
                      : "Cannot sign regulated decisions."}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
