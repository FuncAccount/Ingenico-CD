"use client"

import { ComposableMap, Geographies, Geography, Line, Marker } from "react-simple-maps"
import { coordsFor } from "@/lib/geo"
import { distanceLabel, WAREHOUSES, type Warehouse } from "@/lib/devices"
import type { Routing, RoutingLeg } from "@/lib/agent-work"
import { cn } from "@/lib/utils"

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"

/**
 * The sourcing decision drawn as a network.
 *
 * The point of the map is the SHAPE of the plan: which depots are lit, how far
 * the stock has to travel, and whether the order arrives as one lane or
 * several. A list of depot names cannot show that a plan reaches across the
 * continent while another stays local — the map can, at a glance.
 *
 * Depots that are NOT used are still drawn, hollow. Showing only the chosen
 * sites would make every plan look equally direct and hide the alternatives
 * the agent actually considered.
 */
export function NetworkMap({
  routing,
  destinationCity,
  merchantName,
  hoveredLeg,
  onHoverLeg,
}: {
  routing: Routing
  destinationCity: string
  merchantName: string
  hoveredLeg: string | null
  onHoverLeg: (id: string | null) => void
}) {
  const dest = coordsFor(destinationCity)
  const used = new Map(routing.legs.map((l) => [l.warehouse.id, l]))

  // Framed on the points actually in play, so a plan between Dublin and
  // Frankfurt is not drawn across an empty Mediterranean. A fixed European
  // frame wastes most of its height on sea for every short plan.
  const pts = [dest, ...WAREHOUSES.map((w) => coordsFor(w.city))]
  const lons = pts.map((p) => p[0])
  const lats = pts.map((p) => p[1])
  const midLon = (Math.min(...lons) + Math.max(...lons)) / 2
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const spanLon = Math.max(...lons) - Math.min(...lons)
  const spanLat = Math.max(...lats) - Math.min(...lats)
  // Scale from whichever axis is tighter, with headroom for the labels that
  // sit above the depot markers and below the destination.
  const scale = Math.min(760 / (spanLon + 12), 430 / (spanLat + 9)) * 52

  // The destination label goes on whichever side its lanes do NOT leave from.
  const meanLegLon =
    routing.legs.reduce((a, l) => a + coordsFor(l.warehouse.city)[0], 0) /
    Math.max(routing.legs.length, 1)
  const destLabelRight = meanLegLon < dest[0]

  // Air legs are drawn last so a long red lane is never buried under a road
  // lane; the exceptional mode must stay the most visible thing on the map.
  const ordered = [...routing.legs].sort(
    (a, b) => (a.service.mode === "air" ? 1 : 0) - (b.service.mode === "air" ? 1 : 0),
  )

  return (
    <div>
      <ComposableMap
        projection="geoAzimuthalEqualArea"
        projectionConfig={{ rotate: [-midLon, -midLat, 0], scale }}
        width={760}
        height={430}
        style={{ width: "100%", height: "auto" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="var(--color-secondary)"
                stroke="var(--color-border)"
                strokeWidth={0.5}
                style={{
                  default: { outline: "none" },
                  hover: { outline: "none" },
                  pressed: { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {ordered.map((leg) => {
          const on = hoveredLeg === leg.warehouse.id
          const air = leg.service.mode === "air"
          const units = leg.units.reduce((a, u) => a + u.qty, 0)
          return (
            <Line
              key={leg.warehouse.id}
              from={coordsFor(leg.warehouse.city)}
              to={dest}
              stroke={air ? "var(--color-destructive)" : "var(--color-primary)"}
              // Stroke width carries UNITS, so the lane doing most of the work
              // reads as the heavier one.
              strokeWidth={on ? 4 : 1.4 + Math.min(units, 12) * 0.22}
              strokeLinecap="round"
              // Air is dashed: mode is a different KIND of fact from volume,
              // so it cannot be encoded by the same channel as weight.
              strokeDasharray={air ? "6 4" : undefined}
              opacity={hoveredLeg && !on ? 0.25 : 0.9}
            />
          )
        })}

        {WAREHOUSES.map((w) => {
          const leg = used.get(w.id)
          const on = hoveredLeg === w.id
          return (
            <Marker
              key={w.id}
              coordinates={coordsFor(w.city)}
              onMouseEnter={() => leg && onHoverLeg(w.id)}
              onMouseLeave={() => onHoverLeg(null)}
              style={{ default: { cursor: leg ? "pointer" : "default" } }}
            >
              <rect
                x={-5}
                y={-5}
                width={10}
                height={10}
                transform="rotate(45)"
                fill={leg ? "var(--color-primary)" : "var(--color-background)"}
                stroke={leg ? "var(--color-primary)" : "var(--color-muted-foreground)"}
                strokeWidth={on ? 2.5 : 1.4}
                opacity={leg ? 1 : 0.55}
              />
              <text
                y={-11}
                textAnchor="middle"
                className="pointer-events-none"
                style={{
                  fontSize: 9,
                  fontWeight: leg ? 600 : 400,
                  fill: leg ? "var(--color-foreground)" : "var(--color-muted-foreground)",
                }}
              >
                {w.name.replace(" DC", "")}
              </text>
            </Marker>
          )
        })}

        {/* Destination last: it must never be covered by a depot marker. */}
        <Marker coordinates={dest}>
          <circle r={7} fill="var(--color-foreground)" stroke="var(--color-background)" strokeWidth={2} />
          {/* Placed on the side the lanes do NOT leave from: every lane runs
              to a depot, and depots here are all east, so the label goes west.
              Centred under the pin it sat directly across the outgoing lanes
              and read as struck through. */}
          <text
            x={destLabelRight ? 12 : -12}
            y={3.5}
            textAnchor={destLabelRight ? "start" : "end"}
            style={{ fontSize: 9.5, fontWeight: 600, fill: "var(--color-foreground)" }}
          >
            {merchantName}
          </text>
        </Marker>
      </ComposableMap>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <Key swatch={<span className="h-0.5 w-4 rounded bg-primary" />} label="Road lane" />
        {routing.legs.some((l) => l.service.mode === "air") && (
          <Key
            swatch={
              <span className="h-0.5 w-4 rounded bg-destructive [background-image:repeating-linear-gradient(90deg,currentColor_0_3px,transparent_3px_6px)]" />
            }
            label="Air freight"
          />
        )}
        <Key
          swatch={
            <span className="h-2 w-2 rotate-45 border border-muted-foreground/70 bg-background" />
          }
          label="Depot not used"
        />
        <span className="text-muted-foreground/70">Line weight = units on that lane</span>
      </div>

      {/* The legs as text, tied to the map by hover. A picture of a network is
          not a record of one: the exact quantities have to be readable. */}
      <ul className="mt-2 flex flex-col gap-1">
        {routing.legs.map((l) => (
          <LegRow
            key={l.warehouse.id}
            leg={l}
            on={hoveredLeg === l.warehouse.id}
            onEnter={() => onHoverLeg(l.warehouse.id)}
            onLeave={() => onHoverLeg(null)}
          />
        ))}
      </ul>
    </div>
  )
}

function Key({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  )
}

function LegRow({
  leg,
  on,
  onEnter,
  onLeave,
}: {
  leg: RoutingLeg
  on: boolean
  onEnter: () => void
  onLeave: () => void
}) {
  return (
    <li
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={cn(
        "rounded-lg px-2 py-1.5 text-[11px] transition-colors",
        on ? "bg-primary/10" : "bg-secondary/40",
      )}
    >
      <span className="text-muted-foreground">
        <span className="font-medium text-foreground">{leg.warehouse.name}</span> —{" "}
        {leg.units.map((u) => `${u.qty}× ${u.model}`).join(", ")} ·{" "}
        {distanceLabel(leg.distanceKm)} · {leg.service.service}, {leg.service.days}d ·{" "}
        <span className="tabular-nums">
          €{leg.service.cost} service + €{leg.lineHaul} freight = €{leg.total}
        </span>{" "}
        ·{" "}
        <span className="tabular-nums">
          {/* A same-city leg genuinely rounds to zero. Printed as a bare "0 kg"
              it reads like a value the model failed to produce, so the two
              cases are worded apart. */}
          {leg.co2Kg === 0 ? "under 0.1 kg CO2e" : `${leg.co2Kg} kg CO2e`}
        </span>
      </span>
    </li>
  )
}

export function depotOf(id: string): Warehouse | undefined {
  return WAREHOUSES.find((w) => w.id === id)
}
