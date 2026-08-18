"use client"

import { useMemo, useState } from "react"
import { MERCHANTS } from "@/lib/acquirer-data"
import { ALL_JOURNEYS, acquirerOf } from "@/lib/estate"
import {
  availabilityPct,
  fleetDevices,
  fleetSummary,
  licenceLines,
  MODELS,
  type DeviceState,
} from "@/lib/devices"
import { sitesFrom, HEALTH_META, type Site } from "@/lib/geo"
import { EstateMap, HealthDot } from "@/components/ingenico/estate-map"
import { cn } from "@/lib/utils"

const ALL = "All acquirers"

export function Estate() {
  const [book, setBook] = useState<string>(ALL)
  const [selected, setSelected] = useState<Site | null>(null)

  const devices = useMemo(() => fleetDevices(ALL_JOURNEYS, acquirerOf), [])
  const licences = useMemo(
    () => MERCHANTS.flatMap(licenceLines).reduce((n, l) => n + l.qty, 0),
    [],
  )

  const books = useMemo(() => [ALL, ...new Set(devices.map((d) => d.acquirer))].sort(), [devices])
  const shown = book === ALL ? devices : devices.filter((d) => d.acquirer === book)
  const sites = useMemo(() => sitesFrom(shown), [shown])
  const summary = fleetSummary(shown, licences)
  const avail = availabilityPct(summary)
  const failing = sites.filter((s) => s.health === "failing")

  // A selection made under one filter must not survive a filter that excludes
  // it, or the detail panel describes a site the map no longer shows.
  const active = selected && sites.some((s) => s.merchant === selected.merchant) ? selected : null

  return (
    <main className="mx-auto max-w-[1500px] px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Estate
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Fleet across every acquirer
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {shown.length} terminals at {sites.length} sites.{" "}
          {failing.length === 0 ? (
            "No site is reporting an outage."
          ) : (
            <span className="font-medium text-destructive">
              {failing.length} site{failing.length === 1 ? "" : "s"} reporting an outage.
            </span>
          )}
        </p>
      </header>

      {/* Acquirers are the clients. Filtering the estate by client is the
          primary cut, so it sits above the map rather than inside it. */}
      <div className="mb-5 flex flex-wrap gap-2">
        {books.map((b) => {
          const on = b === book
          const n = b === ALL ? devices.length : devices.filter((d) => d.acquirer === b).length
          return (
            <button
              key={b}
              onClick={() => setBook(b)}
              aria-pressed={on}
              className={cn(
                "glass-pill rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {b}
              <span className={cn("ml-1.5 tabular-nums", on ? "opacity-80" : "opacity-60")}>{n}</span>
            </button>
          )
        })}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Available"
          value={avail === null ? "—" : `${avail}%`}
          note={
            avail === null
              ? "Nothing activated yet"
              : `${summary.online} of ${summary.activated} activated`
          }
          tone={avail !== null && avail < 95 ? "warn" : "plain"}
        />
        <Stat label="Offline" value={String(summary.offline)} note="No contact" tone={summary.offline ? "bad" : "plain"} />
        <Stat label="Degraded" value={String(summary.degraded)} note="Reporting faults" tone={summary.degraded ? "warn" : "plain"} />
        <Stat
          label="Not activated"
          value={String(summary.notActivated)}
          note="Shipped, never switched on"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <section className="glass rounded-2xl p-3">
          <EstateMap sites={sites} selected={active} onSelect={setSelected} />
        </section>

        <section className="flex flex-col gap-3">
          {active ? (
            <SiteDetail
              site={active}
              devices={shown.filter((d) => d.merchant === active.merchant)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="glass rounded-2xl p-4">
              <h2 className="text-sm font-semibold text-foreground">Sites</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Outages first. Select a site on the map or in this list.
              </p>
              <ul className="mt-3 max-h-[600px] divide-y divide-border/60 overflow-y-auto">
                {sites.map((s) => (
                  <li key={`${s.merchant}-${s.city}`}>
                    <button
                      onClick={() => setSelected(s)}
                      className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
                    >
                      <HealthDot health={s.health} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {s.merchant}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {s.city} · {s.acquirer}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[13px] tabular-nums text-foreground">{s.total}</span>
                        {s.fault && (
                          <span className={cn("block text-[10px]", HEALTH_META[s.health].text)}>
                            {s.fault}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function SiteDetail({
  site,
  devices,
  onClose,
}: {
  site: Site
  devices: ReturnType<typeof fleetDevices>
  onClose: () => void
}) {
  const STATE_META: Record<DeviceState, { label: string; cls: string }> = {
    online: { label: "Online", cls: "text-success" },
    degraded: { label: "Degraded", cls: "text-warning" },
    offline: { label: "Offline", cls: "text-destructive" },
    "not-activated": { label: "Not activated", cls: "text-muted-foreground" },
  }

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <HealthDot health={site.health} />
            <h2 className="truncate text-sm font-semibold text-foreground">{site.merchant}</h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {site.city} · {site.acquirer}
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Back to list
        </button>
      </div>

      {site.fault ? (
        <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {site.fault}
        </p>
      ) : (
        <p className="mt-3 rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          {site.health === "pending"
            ? "Terminals delivered but not yet switched on."
            : "Nothing outstanding at this site."}
        </p>
      )}

      <ul className="mt-3 max-h-[420px] divide-y divide-border/60 overflow-y-auto">
        {devices.map((d) => (
          <li key={d.serial} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[11px] text-foreground">{d.serial}</span>
              <span className="block text-[11px] text-muted-foreground">
                {MODELS[d.model].label} · {d.connectivity}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={cn("block text-[11px] font-medium", STATE_META[d.state].cls)}>
                {STATE_META[d.state].label}
              </span>
              <span className="block text-[10px] tabular-nums text-muted-foreground">
                {d.lastSeenHours === null
                  ? "never seen"
                  : d.lastSeenHours < 1
                    ? "seen just now"
                    : `seen ${d.lastSeenHours}h ago`}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Stat({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string
  value: string
  note: string
  tone?: "plain" | "warn" | "bad"
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums",
          tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
    </div>
  )
}
