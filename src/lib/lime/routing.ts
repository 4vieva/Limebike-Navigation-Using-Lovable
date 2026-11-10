// Real cycling routes from the free OpenStreetMap bike router (OSRM).
// Falls back to the simulated planner if the service is unreachable.
import { haversineKm, planRoutes, rideMinutes, type LatLng, type Route, type Step, type Traffic } from "./data";

const OSRM = "https://routing.openstreetmap.de/routed-bike/route/v1/driving";

type OsrmStep = { name: string; distance: number; maneuver: { type: string; modifier?: string; location: [number, number] } };
type OsrmRoute = { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { steps: OsrmStep[] }[] };

const cache = new Map<string, Route[]>();

function nearestIndex(points: LatLng[], p: LatLng, from = 0) {
  let best = from, bd = Infinity;
  for (let i = from; i < points.length; i++) {
    const d = haversineKm(points[i]!, p);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function toManeuver(s: OsrmStep): Step["maneuver"] {
  if (s.maneuver.type === "arrive") return "arrive";
  const m = s.maneuver.modifier ?? "";
  if (m.includes("left")) return "left";
  if (m.includes("right")) return "right";
  return "straight";
}

function stepText(s: OsrmStep, destName: string) {
  const road = s.name || "the path";
  const m = s.maneuver.modifier ?? "";
  switch (s.maneuver.type) {
    case "depart": return `Head off on ${road}`;
    case "arrive": return `Arrive at Lime parking near ${destName}`;
    case "roundabout": case "rotary": return `At the roundabout, take the exit onto ${road}`;
    case "continue": case "new name": return `Continue onto ${road}`;
    default: return m && m !== "straight" ? `${m.startsWith("slight") ? "Bear" : "Turn"} ${m.replace("slight ", "").replace("sharp ", "")} onto ${road}` : `Continue onto ${road}`;
  }
}

function mainRoad(steps: OsrmStep[]) {
  const by = new Map<string, number>();
  steps.forEach((s) => s.name && by.set(s.name, (by.get(s.name) ?? 0) + s.distance));
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export async function fetchBikeRoutes(from: LatLng, to: LatLng, destName: string, trafficShift = 0): Promise<Route[]> {
  const key = `${from.map((n) => n.toFixed(4))}|${to.map((n) => n.toFixed(4))}|${trafficShift}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const url = `${OSRM}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true&alternatives=3`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Routing failed [${res.status}]`);
    const data = (await res.json()) as { code: string; routes: OsrmRoute[] };
    if (data.code !== "Ok" || !data.routes.length) throw new Error(`Routing failed: ${data.code}`);
    const traffics: Traffic[] = ["light", "moderate", "heavy"];
    const routes: Route[] = data.routes.slice(0, 3).map((r, i) => {
      const points = r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as LatLng);
      const osteps = r.legs.flatMap((l) => l.steps);
      let last = 0;
      const steps: Step[] = osteps
        .filter((s, k) => k === 0 || s.maneuver.type === "arrive" || (s.maneuver.modifier && s.maneuver.modifier !== "straight") || s.maneuver.type === "roundabout")
        .map((s) => {
          const at = nearestIndex(points, [s.maneuver.location[1], s.maneuver.location[0]], last);
          last = at;
          return { text: stepText(s, destName), street: s.name, maneuver: toManeuver(s), atIndex: at };
        });
      const distanceKm = r.distance / 1000;
      // Traffic is still simulated — the free router has no live traffic feed.
      const traffic = traffics[(i + trafficShift) % 3]!;
      const road = mainRoad(osteps);
      return { id: `o${trafficShift}-${i}`, name: road ? `Via ${road}` : `Route ${i + 1}`, points, distanceKm, traffic, minutes: rideMinutes(distanceKm, traffic), steps };
    });
    const best = routes.reduce((a, b) => (b.minutes < a.minutes ? b : a));
    best.recommended = true;
    routes.sort((a, b) => a.minutes - b.minutes);
    cache.set(key, routes);
    return routes;
  } catch (e) {
    console.warn("Falling back to simulated routes:", e);
    return planRoutes(from, to, destName, trafficShift);
  }
}

export { nearestIndex };
