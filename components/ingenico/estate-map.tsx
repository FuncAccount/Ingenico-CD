"use client"

import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps"
import { HEALTH_META, markerRadius, type Site } from "@/lib/geo"
import { cn } from "@/lib/utils"

/** Country outlines. Loaded from the CDN by react-simple-maps at render. */
const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"

export function EstateMap({
  sites,
  selected,
  onSelect,
}: {
  sites: Site[]
  selected: Site | null
  onSelect: (s: Site | null) => void
}) {
  return (
    <div className="relative">
      <ComposableMap
        projection="geoAzimuthalEqualArea"
        // Framed on the estate's own footprint (Faro to Bergen, Bristol to
        // Riga) rather than on Europe, so the panel is not mostly empty sea.
        projectionConfig={{ rotate: [-11, -51, 0], scale: 1500 }}
        width={820}
        height={520}
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

        {/* Failing sites are drawn LAST so a red marker is never hidden under a
            healthy one — the single thing the map exists to surface must not
            depend on iteration order. */}
        {[...sites]
          .sort((a, b) => (a.health === "failing" ? 1 : 0) - (b.health === "failing" ? 1 : 0))
          .map((s) => {
            const on = selected?.merchant === s.merchant
            const r = markerRadius(s.total)
            const meta = HEALTH_META[s.health]
            return (
              <Marker
                key={`${s.merchant}-${s.city}`}
                coordinates={s.coords}
                onClick={() => onSelect(on ? null : s)}
                style={{ default: { cursor: "pointer" }, hover: { cursor: "pointer" } }}
              >
                {s.health === "failing" && (
                  <circle r={r + 6} fill={meta.dot} opacity={0.18} className="animate-pulse" />
                )}
                <circle
                  r={r}
                  fill={meta.dot}
                  fillOpacity={s.health === "pending" ? 0.35 : 0.85}
                  stroke={on ? "var(--color-foreground)" : "var(--color-background)"}
                  strokeWidth={on ? 2.5 : 1.2}
                />
              </Marker>
            )
          })}
      </ComposableMap>

      {/* Sits BELOW the map rather than over it: overlaid at the bottom edge
          it was clipped by the panel and read as a rendering fault. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-1">
        {(Object.keys(HEALTH_META) as (keyof typeof HEALTH_META)[])
          // Only caption states actually on the map. A legend entry for a
          // colour that is not shown describes an estate that does not exist.
          .filter((h) => sites.some((s) => s.health === h))
          .map((h) => (
            <span key={h} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: HEALTH_META[h].dot }}
                aria-hidden
              />
              {HEALTH_META[h].label}
            </span>
          ))}
        <span className="text-[11px] text-muted-foreground/70">Marker area = terminals on site</span>
      </div>
    </div>
  )
}

export function HealthDot({ health, className }: { health: Site["health"]; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      style={{ background: HEALTH_META[health].dot }}
      aria-hidden
    />
  )
}
