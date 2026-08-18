"use client"

import { useMemo, useState } from "react"
import { Battery, Plug, TriangleAlert } from "lucide-react"
import {
  CURRENT_FIRMWARE,
  fleetDevices,
  fleetSummary,
  licenceLines,
  MODELS,
  type DeviceState,
  type FleetDevice,
} from "@/lib/devices"
import { acquirerOf, ALL_JOURNEYS } from "@/lib/estate"
import { cn } from "@/lib/utils"

const ALL = "All"

const STATE_META: Record<DeviceState, { label: string; tone: string }> = {
  online: { label: "Online", tone: "bg-success/15 text-success" },
  degraded: { label: "Degraded", tone: "bg-warning/15 text-warning-foreground" },
  offline: { label: "Offline", tone: "bg-destructive/12 text-destructive" },
  // Deliberately neutral. A terminal still in its box has not failed, and
  // colouring it like a fault would send someone to fix nothing.
  "not-activated": { label: "Not activated", tone: "bg-secondary text-muted-foreground" },
}

export function FleetView() {
  const devices = useMemo(() => fleetDevices(ALL_JOURNEYS, acquirerOf), [])
  const licences = useMemo(
    () => ALL_JOURNEYS.reduce((n, m) => n + licenceLines(m).reduce((s, l) => s + l.qty, 0), 0),
    [],
  )
  const s = fleetSummary(devices, licences)

  const [state, setState] = useState<DeviceState | typeof ALL>(ALL)
  const [book, setBook] = useState<string>(ALL)

  const books = useMemo(
    () => [ALL, ...Array.from(new Set(devices.map((d) => d.acquirer))).sort()],
    [devices],
  )
  // Attention first. An unordered fleet list gives no reason to start at the
  // top, and the default order put 20 boxed terminals — the one group that
  // needs nothing — above every fault in the estate.
  const RANK: Record<DeviceState, number> = {
    offline: 0,
    degraded: 1,
    online: 2,
    "not-activated": 3,
  }
  const shown = devices
    .filter((d) => (state === ALL || d.state === state) && (book === ALL || d.acquirer === book))
    .sort((a, b) => RANK[a.state] - RANK[b.state] || (b.declineRate ?? 0) - (a.declineRate ?? 0))

  // Availability is measured over devices that CAN be available. Including
  // boxed stock would flatter it with units that are incapable of failing.
  const availability = s.activated > 0 ? Math.round((s.online / s.activated) * 1000) / 10 : null

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          Terminal management
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Fleet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {s.total} terminals across {s.merchants} merchants. {s.licences} softPOS
          licences run on merchants&apos; own phones and are not counted as
          hardware here.
        </p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Availability"
          value={availability === null ? "—" : `${availability}%`}
          sub={`${s.online} online of ${s.activated} activated`}
        />
        <Stat
          label="Needing attention"
          value={String(s.degraded + s.offline)}
          sub={`${s.degraded} degraded · ${s.offline} offline`}
          tone={s.degraded + s.offline > 0 ? "warn" : undefined}
        />
        <Stat
          label="Not activated"
          value={String(s.notActivated)}
          sub="shipped or installing — no uptime to report yet"
        />
        <Stat
          label="Firmware behind"
          value={String(s.firmwareBehind)}
          sub={`running below ${CURRENT_FIRMWARE}`}
        />
      </div>

      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        {s.online} online + {s.degraded} degraded + {s.offline} offline +{" "}
        {s.notActivated} not activated = {s.total}. Availability excludes the
        last group by design, so it answers &ldquo;is the working estate
        working&rdquo; rather than being diluted by stock in transit.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Filter
          label="State"
          value={state}
          options={[ALL, "online", "degraded", "offline", "not-activated"]}
          onChange={(v) => setState(v as DeviceState | typeof ALL)}
          render={(v) => (v === ALL ? ALL : STATE_META[v as DeviceState].label)}
        />
        <Filter label="Book" value={book} options={books} onChange={setBook} />
      </div>

      <div className="glass overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[52rem]">
          <thead>
            <tr className="border-b border-border/60 text-left">
              <Th>Serial</Th>
              <Th>Merchant</Th>
              <Th>State</Th>
              <Th right>Last seen</Th>
              <Th right>Txns 7d</Th>
              <Th right>Declines</Th>
              <Th right>Power</Th>
              <Th right>Firmware</Th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 40).map((d) => (
              <DeviceRow key={d.serial} d={d} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Showing {Math.min(40, shown.length)} of {shown.length} matching
        {shown.length !== s.total && ` · ${s.total} in the fleet`}. A decline
        rate is withheld below 20 transactions in the window — a percentage off
        four taps measures noise, not the terminal.
      </p>
    </main>
  )
}

function DeviceRow({ d }: { d: FleetDevice }) {
  const meta = STATE_META[d.state]
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-secondary/50">
      <Td>
        <span className="font-mono text-[12px] text-foreground">{d.serial}</span>
        <span className="block text-[11px] text-muted-foreground">{d.model}</span>
      </Td>
      <Td>
        <span className="text-[12px] text-foreground">{d.merchant}</span>
        <span className="block text-[11px] text-muted-foreground">
          {d.acquirer} · {d.city}
        </span>
      </Td>
      <Td>
        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", meta.tone)}>
          {meta.label}
        </span>
      </Td>
      <Td right>
        {/* Never contacted and contacted long ago are different facts. */}
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {d.lastSeenHours === null
            ? "never"
            : d.lastSeenHours === 0
              ? "now"
              : `${d.lastSeenHours}h ago`}
        </span>
      </Td>
      <Td right>
        <span className="text-[12px] tabular-nums text-foreground">
          {d.state === "not-activated" ? "—" : d.txns7d.toLocaleString("en-GB")}
        </span>
      </Td>
      <Td right>
        <span
          className={cn(
            "text-[12px] tabular-nums",
            d.declineRate !== null && d.declineRate > 6
              ? "font-medium text-destructive"
              : "text-muted-foreground",
          )}
        >
          {d.declineRate === null ? "—" : `${d.declineRate}%`}
        </span>
      </Td>
      <Td right>
        {/* Branches on the MODEL, not on whether a reading exists. A boxed
            A920 has a battery and simply has not reported yet — rendering it
            as "Mains" was a false claim about the hardware itself, and the
            two absences look identical in the data. */}
        <span className="inline-flex items-center gap-1 text-[12px] tabular-nums text-muted-foreground">
          {!MODELS[d.model].battery ? (
            <>
              <Plug className="h-3 w-3" />
              Mains
            </>
          ) : d.batteryPct === null ? (
            <>
              <Battery className="h-3 w-3" />
              Not reported
            </>
          ) : (
            <>
              <Battery className={cn("h-3 w-3", d.batteryPct < 20 && "text-warning")} />
              {d.batteryPct}%
            </>
          )}
        </span>
      </Td>
      <Td right>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[12px] tabular-nums",
            d.firmwareCurrent ? "text-muted-foreground" : "text-warning-foreground",
          )}
        >
          {!d.firmwareCurrent && <TriangleAlert className="h-3 w-3 text-warning" />}
          {d.firmware}
        </span>
      </Td>
    </tr>
  )
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: "warn"
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums",
          tone === "warn" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  )
}

function Filter({
  label,
  value,
  options,
  onChange,
  render,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
  render?: (v: string) => string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="glass-pill flex flex-wrap items-center gap-1 rounded-full p-1">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            aria-pressed={value === o}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
              value === o
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {render ? render(o) : o}
          </button>
        ))}
      </div>
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
        right && "text-right",
      )}
    >
      {children}
    </th>
  )
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={cn("px-4 py-3 align-middle", right && "text-right")}>{children}</td>
}
