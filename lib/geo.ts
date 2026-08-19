import type { FleetDevice } from "./devices"

/**
 * City centroids, [longitude, latitude] as d3-geo expects.
 *
 * Every city that appears anywhere in the fixtures must be listed. A lookup
 * miss THROWS rather than defaulting to [0, 0] — the Gulf of Guinea — because
 * a pin in the ocean looks like a data error the reader must diagnose, while a
 * missing pin silently under-reports the estate.
 */
export const CITY_COORDS: Record<string, [number, number]> = {
  "Dublin, IE": [-6.26, 53.35],
  "Amsterdam, NL": [4.9, 52.37],
  "Hamburg, DE": [9.99, 53.55],
  "Valencia, ES": [-0.38, 39.47],
  "Manchester, UK": [-2.24, 53.48],
  "Milan, IT": [9.19, 45.46],
  "Bergen, NO": [5.32, 60.39],
  "Lisbon, PT": [-9.14, 38.72],
  "Edinburgh, UK": [-3.19, 55.95],
  "Málaga, ES": [-4.42, 36.72],
  "Marseille, FR": [5.37, 43.3],
  "Stuttgart, DE": [9.18, 48.78],
  "Cologne, DE": [6.96, 50.94],
  "Copenhagen, DK": [12.57, 55.68],
  "Naples, IT": [14.27, 40.85],
  "Tallinn, EE": [24.75, 59.44],
  "Leeds, UK": [-1.55, 53.8],
  "Düsseldorf, DE": [6.77, 51.23],
  "Faro, PT": [-7.93, 37.02],
  "Riga, LV": [24.11, 56.95],
  "Lyon, FR": [4.84, 45.76],
  "Bristol, UK": [-2.59, 51.45],
  "Aalborg, DK": [9.92, 57.05],
  "Rotterdam, NL": [4.48, 51.92],
  "Frankfurt, DE": [8.68, 50.11],
  "Barcelona, ES": [2.17, 41.39],
  // Added with the demo-coverage journeys. The throw above caught every one of
  // these, which is exactly what it is for.
  "York, UK": [-1.08, 53.96],
  "Galway, IE": [-9.05, 53.27],
  "Innsbruck, AT": [11.4, 47.27],
  "Porto, PT": [-8.61, 41.15],
  "Stockholm, SE": [18.07, 59.33],
  "Tartu, EE": [26.72, 58.38],
  "Prague, CZ": [14.42, 50.09],
}

export function coordsFor(city: string): [number, number] {
  const c = CITY_COORDS[city]
  if (!c) throw new Error(`geo: no coordinates for "${city}". Add it to CITY_COORDS.`)
  return c
}

/**
 * A site's condition, derived from the devices standing in it — never stored.
 *
 * `failing` and `pending` are deliberately separate: a shop whose terminals
 * are boxed and not yet switched on has nothing wrong with it, and colouring
 * it like an outage would send an engineer to a site that is working to plan.
 */
export type SiteHealth = "failing" | "degraded" | "healthy" | "pending"

export interface Site {
  merchant: string
  acquirer: string
  city: string
  coords: [number, number]
  total: number
  online: number
  degraded: number
  offline: number
  notActivated: number
  health: SiteHealth
  /** Present only where something is actually wrong, so the absence of a
   *  sentence is itself meaningful rather than a missing string. */
  fault: string | null
}

export function sitesFrom(devices: FleetDevice[]): Site[] {
  const by = new Map<string, FleetDevice[]>()
  for (const d of devices) {
    const key = `${d.merchant}::${d.city}`
    const list = by.get(key)
    if (list) list.push(d)
    else by.set(key, [d])
  }

  const out: Site[] = []
  for (const group of by.values()) {
    const head = group[0]
    const offline = group.filter((d) => d.state === "offline").length
    const degraded = group.filter((d) => d.state === "degraded").length
    const online = group.filter((d) => d.state === "online").length
    const notActivated = group.filter((d) => d.state === "not-activated").length

    // Worst condition present wins. A site with one dead terminal among ten is
    // still a site with a dead terminal.
    const health: SiteHealth =
      offline > 0 ? "failing" : degraded > 0 ? "degraded" : online > 0 ? "healthy" : "pending"

    const fault =
      offline > 0
        ? `${offline} terminal${offline === 1 ? "" : "s"} offline`
        : degraded > 0
          ? `${degraded} terminal${degraded === 1 ? "" : "s"} degraded`
          : null

    out.push({
      merchant: head.merchant,
      acquirer: head.acquirer,
      city: head.city,
      coords: coordsFor(head.city),
      total: group.length,
      online,
      degraded,
      offline,
      notActivated,
      health,
      fault,
    })
  }

  // Failures first, then by size. The map needs the same ordering as the list
  // beside it, or the eye and the index disagree.
  const rank: Record<SiteHealth, number> = { failing: 0, degraded: 1, healthy: 2, pending: 3 }
  return out.sort((a, b) => rank[a.health] - rank[b.health] || b.total - a.total)
}

export const HEALTH_META: Record<SiteHealth, { label: string; dot: string; text: string }> = {
  failing: { label: "Failing", dot: "var(--color-destructive)", text: "text-destructive" },
  degraded: { label: "Degraded", dot: "var(--color-warning)", text: "text-warning" },
  healthy: { label: "Healthy", dot: "var(--color-success)", text: "text-success" },
  pending: { label: "Not activated", dot: "var(--color-muted-foreground)", text: "text-muted-foreground" },
}

/** Marker radius by estate size. Area, not radius, tracks the count — a radius
 *  scale makes a 24-terminal site look six times a 4-terminal one. */
export function markerRadius(total: number): number {
  return 4 + Math.sqrt(total) * 1.6
}
