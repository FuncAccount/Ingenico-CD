"use client"

import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet"
import { useEffect } from "react"
import "leaflet/dist/leaflet.css"

export interface MapPoint {
  lat: number
  lng: number
  label: string
  role: "origin" | "destination"
}

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 11)
      return
    }
    map.fitBounds(
      points.map((p) => [p.lat, p.lng] as [number, number]),
      { padding: [36, 36] },
    )
  }, [map, points])
  return null
}

/**
 * Circle markers rather than Leaflet's default icons: the default pin is an
 * image asset that bundlers routinely fail to resolve, and a map with
 * invisible markers looks like a map with no data on it.
 */
export function DeliveryMap({ points }: { points: MapPoint[] }) {
  const center: [number, number] = points.length
    ? [points[0].lat, points[0].lng]
    : [50, 4]

  return (
    <MapContainer
      center={center}
      zoom={5}
      scrollWheelZoom={false}
      style={{ height: "100%", width: "100%", background: "transparent" }}
      attributionControl={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains={["a", "b", "c", "d"]}
      />
      {points.length === 2 && (
        <Polyline
          positions={points.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: "#1668a8", weight: 2, dashArray: "5 6", opacity: 0.75 }}
        />
      )}
      {points.map((p) => (
        <CircleMarker
          key={`${p.role}-${p.lat}-${p.lng}`}
          center={[p.lat, p.lng]}
          radius={p.role === "destination" ? 9 : 7}
          pathOptions={{
            color: "#ffffff",
            weight: 2.5,
            fillColor: p.role === "destination" ? "#1668a8" : "#0f172a",
            fillOpacity: 1,
          }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            {p.label}
          </Tooltip>
        </CircleMarker>
      ))}
      <FitBounds points={points} />
    </MapContainer>
  )
}
