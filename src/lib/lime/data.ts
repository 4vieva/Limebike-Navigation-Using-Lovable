// Simulated data + journey engine. Swap these functions for real APIs later
// (geocoding, routing, Lime fleet/parking feeds, traffic) — the UI only depends on the types.

export type LatLng = [number, number];

export type Place = { id: string; name: string; area: string; pos: LatLng };
export type Bike = { id: string; pos: LatLng; battery: number };
export type Traffic = "light" | "moderate" | "heavy";
export type Step = { text: string; street: string; atIndex: number; maneuver: "left" | "right" | "straight" | "arrive" };
export type Route = {
  id: string;
  name: string;
  points: LatLng[];
  distanceKm: number;
  traffic: Traffic;
  minutes: number;
  recommended?: boolean;
  steps: Step[];
};
export type Parking = { id: string; name: string; pos: LatLng; walkM: number; walkMin: number };

export type Plan = "standard" | "access";
// Placeholder rates — replace with Lime's published London prices.
export const PLANS: Record<Plan, { label: string; unlock: number; perMinute: number }> = {
  standard: { label: "Lime", unlock: 1.0, perMinute: 0.25 },
  access: { label: "Lime Access", unlock: 0, perMinute: 0.08 },
};
export const PRICING = { currency: "£" };

export const USER_LOCATION: LatLng = [51.5262, -0.1052]; // Clerkenwell, London (simulated GPS)

export const PLACES: Place[] = [
  { id: "tate", name: "Tate Modern", area: "Bankside, SE1", pos: [51.5076, -0.0994] },
  { id: "kx", name: "King's Cross Station", area: "Euston Rd, N1C", pos: [51.5308, -0.1238] },
  { id: "bm", name: "British Museum", area: "Great Russell St, WC1", pos: [51.5194, -0.127] },
  { id: "cg", name: "Covent Garden", area: "Piazza, WC2", pos: [51.5117, -0.124] },
  { id: "shore", name: "Shoreditch High Street", area: "Shoreditch, E1", pos: [51.5233, -0.0754] },
  { id: "bridge", name: "London Bridge", area: "Southwark, SE1", pos: [51.5045, -0.0865] },
  { id: "angel", name: "Angel Islington", area: "Upper St, N1", pos: [51.5322, -0.1058] },
  { id: "borough", name: "Borough Market", area: "Southwark St, SE1", pos: [51.5055, -0.091] },
  { id: "tower", name: "Tower of London", area: "Tower Hill, EC3", pos: [51.5081, -0.0759] },
  { id: "soho", name: "Soho Square", area: "Soho, W1", pos: [51.5154, -0.1321] },
  { id: "barbican", name: "Barbican Centre", area: "Silk St, EC2", pos: [51.5202, -0.0938] },
  { id: "waterloo", name: "Waterloo Station", area: "Lambeth, SE1", pos: [51.5031, -0.1132] },
];

const STREETS = ["Cheapside", "Farringdon Rd", "Holborn", "Queen Victoria St", "Upper Thames St", "Southwark St", "Blackfriars Rd", "Gray's Inn Rd", "Old St", "Clerkenwell Rd", "Fleet St", "Strand", "Theobalds Rd", "Goswell Rd", "Bishopsgate", "Cycleway 6", "Cycleway 3", "Long Acre"];

// Seeded RNG so routes are stable for a given destination
function rng(seed: number) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pathKm = (pts: LatLng[]) => pts.slice(1).reduce((s, p, i) => s + haversineKm(pts[i]!, p), 0);

export function searchPlaces(q: string): Place[] {
  const t = q.trim().toLowerCase();
  if (!t) return PLACES.slice(0, 5);
  return PLACES.filter((p) => p.name.toLowerCase().includes(t) || p.area.toLowerCase().includes(t)).slice(0, 6);
}

export function nearbyBikes(center: LatLng): Bike[] {
  const r = rng(42);
  return Array.from({ length: 9 }, (_, i) => ({
    id: `b${i}`,
    pos: [center[0] + (r() - 0.5) * 0.008, center[1] + (r() - 0.5) * 0.012] as LatLng,
    battery: Math.round(40 + r() * 60),
  }));
}

// Grid-like "street" path: alternate lat/lng legs with a lateral detour.
function buildPath(a: LatLng, b: LatLng, detour: number, legs: number, r: () => number): LatLng[] {
  const pts: LatLng[] = [a];
  const perp: LatLng = [-(b[1] - a[1]), b[0] - a[0]];
  let cur = a;
  for (let i = 1; i <= legs; i++) {
    const t = i / legs;
    const bulge = Math.sin(Math.PI * t) * detour;
    const target: LatLng = [a[0] + (b[0] - a[0]) * t + perp[0] * bulge, a[1] + (b[1] - a[1]) * t + perp[1] * bulge];
    const jitter = (r() - 0.5) * 0.0006;
    const corner: LatLng = i % 2 ? [target[0] + jitter, cur[1]] : [cur[0], target[1] + jitter];
    pts.push(corner, target);
    cur = target;
  }
  pts[pts.length - 1] = b;
  return densify(pts, 0.03);
}
function densify(pts: LatLng[], stepKm: number): LatLng[] {
  const out: LatLng[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const n = Math.max(1, Math.round(haversineKm(a, b) / stepKm));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

const SPEED: Record<Traffic, number> = { light: 15, moderate: 12.5, heavy: 9.5 }; // km/h
export const rideMinutes = (km: number, traffic: Traffic) => Math.max(2, Math.round((km / SPEED[traffic]) * 60));

function bearing(a: LatLng, b: LatLng) {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}
function buildSteps(points: LatLng[], r: () => number, destName: string): Step[] {
  const steps: Step[] = [];
  const street = () => STREETS[Math.floor(r() * STREETS.length)]!;
  steps.push({ text: `Head off on ${street()}`, street: "", maneuver: "straight", atIndex: 0 });
  for (let i = 2; i < points.length - 2; i++) {
    let d = bearing(points[i]!, points[i + 1]!) - bearing(points[i - 1]!, points[i]!);
    d = ((d + 540) % 360) - 180;
    if (Math.abs(d) > 35 && i - steps[steps.length - 1]!.atIndex > 4) {
      const s = street();
      const m = d > 0 ? "right" : "left"; // lat/lng axes: positive = clockwise on map
      steps.push({ text: `Turn ${m} onto ${s}`, street: s, maneuver: m, atIndex: i });
    }
  }
  steps.push({ text: `Arrive at Lime parking near ${destName}`, street: "", maneuver: "arrive", atIndex: points.length - 1 });
  return steps;
}

// ---- River Thames: approximate centreline (lng -> lat) and cycle-legal bridges ----
const RIVER: LatLng[] = [[51.4990, -0.1500], [51.5010, -0.1235], [51.5080, -0.1180], [51.5095, -0.1060], [51.5090, -0.0960], [51.5075, -0.0870], [51.5055, -0.0760], [51.5040, -0.0600]];
export function riverLat(lng: number) {
  if (lng <= RIVER[0]![1]) return RIVER[0]![0];
  for (let i = 1; i < RIVER.length; i++) {
    const a = RIVER[i - 1]!, b = RIVER[i]!;
    if (lng <= b[1]) return a[0] + ((b[0] - a[0]) * (lng - a[1])) / (b[1] - a[1]);
  }
  return RIVER[RIVER.length - 1]![0];
}
export const isNorth = (p: LatLng) => p[0] > riverLat(p[1]);
const BANK = 0.0012; // keep paths ~130 m from the centreline
const BRIDGES: { name: string; lng: number }[] = [
  { name: "Westminster Bridge", lng: -0.1222 },
  { name: "Waterloo Bridge", lng: -0.117 },
  { name: "Blackfriars Bridge", lng: -0.1043 },
  { name: "Southwark Bridge", lng: -0.0943 },
  { name: "London Bridge", lng: -0.0877 },
  { name: "Tower Bridge", lng: -0.0754 },
];
const bridgeEnds = (lng: number): { n: LatLng; s: LatLng } => ({ n: [riverLat(lng) + BANK, lng], s: [riverLat(lng) - BANK, lng] });
function clampSide(pts: LatLng[], north: boolean): LatLng[] {
  return pts.map(([la, ln]) => {
    const r = riverLat(ln);
    return north ? [Math.max(la, r + BANK * 0.8), ln] : [Math.min(la, r - BANK * 0.8), ln];
  });
}
/** Build a path that never crosses the river except over the given bridge. */
function riverSafePath(a: LatLng, b: LatLng, detour: number, legs: number, r: () => number, bridgeLng: number | null): LatLng[] {
  const aN = isNorth(a);
  if (bridgeLng === null || aN === isNorth(b)) {
    const p = clampSide(buildPath(a, b, detour, legs, r), aN);
    p[0] = a; p[p.length - 1] = b;
    return p;
  }
  const e = bridgeEnds(bridgeLng);
  const [s1, s2] = aN ? [e.n, e.s] : [e.s, e.n];
  const half = Math.max(2, Math.ceil(legs / 2));
  const p1 = clampSide(buildPath(a, s1, detour, half, r), aN);
  const p2 = clampSide(buildPath(s2, b, detour, half, r), !aN);
  p1[0] = a; p2[p2.length - 1] = b;
  return [...p1, ...densify([s1, s2], 0.03).slice(1), ...p2.slice(1)];
}

export function planRoutes(from: LatLng, to: LatLng, destName: string, trafficShift = 0): Route[] {
  const r = rng(hash(destName) + trafficShift * 17);
  const traffics: Traffic[] = ["light", "moderate", "heavy"];
  const configs = [
    { name: "Fastest · Cycleway", detour: 0.05, legs: 4 },
    { name: "Quiet streets", detour: 0.22, legs: 5 },
    { name: "Direct · main roads", detour: -0.12, legs: 3 },
  ];
  const crosses = isNorth(from) !== isNorth(to);
  const bridges = crosses
    ? [...BRIDGES].sort((x, y) => {
        const cost = (lng: number) => { const e = bridgeEnds(lng); return haversineKm(from, e.n) + haversineKm(e.s, to); };
        return cost(x.lng) - cost(y.lng);
      })
    : [];
  const routes: Route[] = configs.map((c, i) => {
    const br = crosses ? bridges[Math.min(i, bridges.length - 1)]! : null;
    const points = riverSafePath(from, to, c.detour, c.legs, r, br ? br.lng : null);
    const distanceKm = pathKm(points);
    const traffic = traffics[(i + Math.floor(r() * 3) + trafficShift) % 3]!;
    const name = br ? `${c.name.split(" · ")[0]} · via ${br.name}` : c.name;
    return { id: `r${i}`, name, points, distanceKm, traffic, minutes: rideMinutes(distanceKm, traffic), steps: buildSteps(points, r, destName) };
  });
  const best = routes.reduce((a, b) => (b.minutes < a.minutes ? b : a));
  best.recommended = true;
  return routes.sort((a, b) => a.minutes - b.minutes);
}

export function parkingNear(dest: Place): Parking[] {
  const r = rng(hash(dest.id) + 3);
  const names = ["Bay", "Corner bay", "Hub", "Docking zone"];
  return Array.from({ length: 4 }, (_, i) => {
    const pos = clampSide([[dest.pos[0] + (r() - 0.5) * 0.006, dest.pos[1] + (r() - 0.5) * 0.009]], isNorth(dest.pos))[0]!;
    const walkM = Math.round(haversineKm(pos, dest.pos) * 1000 * 1.25);
    return {
      id: `p${i}`,
      name: `${STREETS[Math.floor(r() * STREETS.length)]} ${names[i]}`,
      pos,
      walkM,
      walkMin: Math.max(1, Math.round(walkM / 80)),
    };
  }).sort((a, b) => a.walkM - b.walkM);
}

export function estimateCost(minutes: number, plan: Plan = "standard") {
  const p = PLANS[plan];
  const ride = minutes * p.perMinute;
  return { plan, unlock: p.unlock, minutes, perMinute: p.perMinute, ride, total: p.unlock + ride };
}

export const money = (n: number) => `${PRICING.currency}${n.toFixed(2)}`;
export const eta = (minutes: number, from = new Date()) =>
  new Date(from.getTime() + minutes * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
export const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

/** Remaining km along a route from point index */
export const remainingKm = (route: Route, idx: number) => pathKm(route.points.slice(idx));
