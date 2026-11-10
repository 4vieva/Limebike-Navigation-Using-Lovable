import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Bike, LatLng, Parking, Route, Traffic } from "@/lib/lime/data";

export type MapViewProps = {
  user: LatLng;
  bikes?: Bike[];
  dest?: LatLng | null;
  routes?: Route[];
  selectedRouteId?: string | null;
  parking?: Parking[];
  selectedParkingId?: string | null;
  walkLine?: LatLng[] | null;
  rider?: LatLng | null;
  follow?: boolean;
  onMapClick?: (p: LatLng) => void;
  onRouteClick?: (id: string) => void;
  onParkingClick?: (id: string) => void;
};

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const trafficVar: Record<Traffic, string> = { light: "--traffic-light", moderate: "--traffic-moderate", heavy: "--traffic-heavy" };
const icon = (cls: string, html = "", size = 28) =>
  L.divIcon({ className: "", html: `<div class="${cls}">${html}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

export default function MapView(p: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const cbs = useRef(p);
  cbs.current = p;
  const fitKey = useRef("");

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView(p.user, 15);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(m);
    L.control.zoom({ position: "topright" }).addTo(m);
    m.on("click", (e) => cbs.current.onMapClick?.([e.latlng.lat, e.latlng.lng]));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const routes = p.routes ?? [];
    const sel = p.selectedRouteId;
    // unselected first so selected draws on top
    [...routes].sort((a) => (a.id === sel ? 1 : -1)).forEach((r) => {
      const active = r.id === sel || (!sel && r.recommended);
      const color = active ? css("--route-active") : css("--route-alt");
      L.polyline(r.points, { color: css("--route-casing"), weight: active ? 11 : 8, opacity: 0.9 }).addTo(g);
      const line = L.polyline(r.points, { color, weight: active ? 7 : 5, opacity: active ? 1 : 0.85, dashArray: active ? undefined : "1 9", lineCap: "round" }).addTo(g);
      line.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        cbs.current.onRouteClick?.(r.id);
      });
      if (active && routes.length > 1) {
        const mid = r.points[Math.floor(r.points.length / 2)]!;
        L.marker(mid, { icon: icon(`lime-chip`, `<span style="background:${css(trafficVar[r.traffic])}"></span>${r.minutes} min`, 0), interactive: false }).addTo(g);
      }
    });
    p.bikes?.forEach((b) => L.marker(b.pos, { icon: icon("lime-bike", "🚲", 30), title: `Lime bike · ${b.battery}%` }).addTo(g));
    p.parking?.forEach((pk) => {
      const on = pk.id === p.selectedParkingId;
      const mk = L.marker(pk.pos, { icon: icon(on ? "lime-park lime-park-on" : "lime-park", "P", on ? 36 : 28), zIndexOffset: on ? 500 : 0 }).addTo(g);
      mk.on("click", () => cbs.current.onParkingClick?.(pk.id));
    });
    if (p.walkLine) L.polyline(p.walkLine, { color: css("--foreground"), weight: 4, dashArray: "2 8", lineCap: "round" }).addTo(g);
    if (p.dest) L.marker(p.dest, { icon: icon("lime-dest", "", 22), zIndexOffset: 400 }).addTo(g);
    L.marker(p.rider ?? p.user, { icon: icon("lime-user", "", 22), zIndexOffset: 1000 }).addTo(g);

    if (p.follow && p.rider) {
      m.setView(p.rider, Math.max(m.getZoom(), 17), { animate: true });
      return;
    }
    const pts: LatLng[] = [p.user, ...(p.dest ? [p.dest] : []), ...routes.flatMap((r) => [r.points[0]!, ...r.points.filter((_, i) => i % 10 === 0)]), ...(p.parking?.map((x) => x.pos) ?? [])];
    const key = `${routes.map((r) => r.id + r.points.length).join()}|${p.dest}|${p.parking?.length}|${p.follow}`;
    if (key !== fitKey.current) {
      fitKey.current = key;
      if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [40, 120], paddingBottomRight: [40, window.innerWidth >= 768 ? 40 : 380], maxZoom: 17 });
      else m.setView(p.user, 15);
    }
  }, [p.routes, p.selectedRouteId, p.bikes, p.parking, p.selectedParkingId, p.dest, p.rider, p.follow, p.walkLine, p.user]);

  return <div ref={el} className="absolute inset-0 z-0" />;
}
