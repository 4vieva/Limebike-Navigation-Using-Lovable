import { useSyncExternalStore } from "react";
import { haversineKm, USER_LOCATION, type LatLng } from "./data";

export type GeoState = {
  status: "idle" | "locating" | "live" | "denied" | "unavailable" | "outside";
  pos: LatLng | null; // real GPS fix
  accuracy?: number;
};

const LONDON: LatLng = [51.5072, -0.1276];
let state: GeoState = { status: "idle", pos: null };
let watchId: number | null = null;
const subs = new Set<() => void>();
const set = (s: GeoState) => { state = s; subs.forEach((f) => f()); };

/** Start watching the device's GPS. Call from an effect or click handler. */
export function startGeo() {
  if (watchId !== null || typeof navigator === "undefined") return;
  if (!("geolocation" in navigator)) return set({ status: "unavailable", pos: null });
  set({ ...state, status: "locating" });
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const pos: LatLng = [p.coords.latitude, p.coords.longitude];
      set({ status: haversineKm(pos, LONDON) > 40 ? "outside" : "live", pos, accuracy: p.coords.accuracy });
    },
    (err) => set({ status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable", pos: null }),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
  );
}

export const useGeo = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state, () => state);

/** Where journeys start: real GPS in London, otherwise the demo start point. */
export const startPoint = (g: GeoState): LatLng => (g.status === "live" && g.pos ? g.pos : USER_LOCATION);

export const geoLabel: Record<GeoState["status"], string> = {
  idle: "Location not started",
  locating: "Finding your location…",
  live: "Using your live location",
  denied: "Location blocked — using demo start point",
  unavailable: "Location unavailable — using demo start point",
  outside: "You're outside London — using demo start point",
};
