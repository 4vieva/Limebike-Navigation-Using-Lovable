import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { usePlan, setPlan } from "@/lib/lime/plan";
import { useGeo, startGeo, startPoint, geoLabel } from "@/lib/lime/geo";
import { fetchBikeRoutes, nearestIndex } from "@/lib/lime/routing";
import { PLANS, type Plan } from "@/lib/lime/data";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowUp, CornerUpLeft, CornerUpRight, Flag, Footprints, MapPin, Navigation,
  Search, Settings, LocateFixed, Volume2, VolumeX, X, Zap, AlertTriangle, Bike as BikeIcon, Check, Leaf,
} from "lucide-react";
import {
  USER_LOCATION, nearbyBikes, searchPlaces, planRoutes, parkingNear, estimateCost, money, eta, fmtKm,
  remainingKm, rideMinutes, haversineKm,
  type Place, type Route as LimeRoute, type Parking, type LatLng, type Traffic, type Step,
} from "@/lib/lime/data";

const MapView = lazy(() => import("@/components/lime/MapView"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lime Smart Navigation — compare routes, prices & parking" },
      { name: "description", content: "Plan Lime bike journeys: compare cycling routes by time and price, pick designated parking and ride with voice-guided navigation." },
      { property: "og:title", content: "Lime Smart Navigation" },
      { property: "og:description", content: "Compare cycling routes by time and price, choose Lime parking and navigate with live traffic updates." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: App,
});

type Stage = "search" | "routes" | "parking" | "cost" | "nav" | "walk";

const trafficLabel: Record<Traffic, string> = { light: "Light traffic", moderate: "Moderate traffic", heavy: "Heavy traffic" };
const trafficDot: Record<Traffic, string> = { light: "bg-traffic-light", moderate: "bg-traffic-moderate", heavy: "bg-traffic-heavy" };

function speak(text: string, muted: boolean) {
  if (muted || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-GB";
  window.speechSynthesis.speak(u);
}

function App() {
  const geo = useGeo();
  useEffect(() => { startGeo(); }, []);
  const origin = startPoint(geo);
  const originKey = origin.map((n) => n.toFixed(3)).join();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bikes = useMemo(() => nearbyBikes(origin), [originKey]);
  const [stage, setStage] = useState<Stage>("search");
  const [dest, setDest] = useState<Place | null>(null);
  const [routes, setRoutes] = useState<LimeRoute[]>([]);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [parking, setParking] = useState<Parking[]>([]);
  const [parkId, setParkId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState(false);
  const from = useRef<LatLng>(origin);

  const route = routes.find((r) => r.id === routeId) ?? null;
  const park = parking.find((p) => p.id === parkId) ?? null;

  const loadRoutes = async (to: LatLng, name: string, keepIndex?: number) => {
    setLoading(true);
    const rs = await fetchBikeRoutes(from.current, to, name);
    setLoading(false);
    setRoutes(rs);
    const pick = keepIndex !== undefined ? rs[Math.max(0, Math.min(keepIndex, rs.length - 1))]! : rs.find((r) => r.recommended)!;
    setRouteId(pick.id);
    return rs;
  };

  const chooseDest = (p: Place) => {
    from.current = startPoint(geo);
    setDest(p);
    setParking(parkingNear(p));
    setParkId(null);
    setRoutes([]);
    setStage("routes");
    void loadRoutes(p.pos, p.name);
  };

  const pickOnMap = (pos: LatLng) => {
    if (stage !== "search") return;
    chooseDest({ id: `pin-${pos[0].toFixed(4)}${pos[1].toFixed(4)}`, name: "Dropped pin", area: `${pos[0].toFixed(4)}, ${pos[1].toFixed(4)}`, pos });
  };

  // Once parking is chosen, re-plan the ride to end at the parking bay
  const confirmParking = async () => {
    if (!park || !dest || !route) return;
    const idx = routes.findIndex((r) => r.id === route.id);
    setStage("cost");
    await loadRoutes(park.pos, dest.name, idx);
  };

  const back = () => {
    const prev: Partial<Record<Stage, Stage>> = { routes: "search", parking: "routes", cost: "parking" };
    const to = prev[stage];
    if (!to) return;
    if (to === "search") { setDest(null); setRoutes([]); setParking([]); }
    if (to === "parking" && dest) void loadRoutes(dest.pos, dest.name);
    setStage(to);
  };

  if ((stage === "nav" || stage === "walk") && route && park && dest) {
    return <LiveNav initialRoute={route} park={park} dest={dest} start={from.current} onExit={() => { setStage("search"); setDest(null); setRoutes([]); setParking([]); }} />;
  }

  return (
    <Shell
      map={{
        user: origin,
        bikes: stage === "search" || stage === "routes" ? bikes : [],
        dest: dest?.pos ?? null,
        routes,
        selectedRouteId: routeId,
        parking: stage === "parking" || stage === "cost" ? parking : [],
        selectedParkingId: parkId,
        walkLine: park && dest && stage !== "routes" ? [park.pos, dest.pos] : null,
        onMapClick: pickOnMap,
        onRouteClick: (id) => stage === "routes" && setRouteId(id),
        onParkingClick: (id) => stage === "parking" && setParkId(id),
      }}
      top={stage === "search" ? <SearchBar onPick={chooseDest} origin={origin} onSettings={() => setSettings(true)} /> : <TopBar dest={dest} onBack={back} stage={stage} />}
    >
      {settings ? <SettingsSheet onClose={() => setSettings(false)} /> : <>
      {stage === "search" && <Welcome bikes={bikes.length} geoText={geoLabel[geo.status]} live={geo.status === "live"} />}
      {(stage === "routes" || stage === "cost") && loading && <p className="py-10 text-center text-sm font-semibold text-muted-foreground">Finding real cycling routes…</p>}
      {stage === "routes" && !loading && <RoutesSheet routes={routes} selected={routeId} onSelect={setRouteId} onNext={() => setStage("parking")} />}
      {stage === "parking" && dest && <ParkingSheet dest={dest} parking={parking} selected={parkId} onSelect={setParkId} onNext={confirmParking} />}
      {stage === "cost" && !loading && route && park && <CostSheet route={route} park={park} onStart={() => setStage("nav")} />}
      </>}
    </Shell>
  );
}

/* ---------- Layout ---------- */

function Shell({ map, top, children }: { map: React.ComponentProps<typeof MapView>; top: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-muted">
      <ClientOnly fallback={<div className="absolute inset-0 bg-muted" />}>
        <Suspense fallback={<div className="absolute inset-0 bg-muted" />}>
          <MapView {...map} />
        </Suspense>
      </ClientOnly>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] p-3 md:left-4 md:right-auto md:top-4 md:w-[420px] md:p-0">
        <div className="pointer-events-auto">{top}</div>
      </div>
      <section className="animate-sheet absolute inset-x-0 bottom-0 z-[500] max-h-[62dvh] overflow-y-auto rounded-t-[2rem] bg-card p-5 pb-6 shadow-sheet md:bottom-4 md:left-4 md:right-auto md:max-h-[calc(100dvh-7rem)] md:w-[420px] md:rounded-[2rem]">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border md:hidden" />
        {children}
      </section>
    </main>
  );
}

function Logo() {
  return (
    <span className="flex items-center gap-1.5 font-display text-lg font-extrabold">
      <span className="grid size-7 place-items-center rounded-full bg-primary"><Leaf className="size-4" /></span>lime
    </span>
  );
}

function SearchBar({ onPick, origin, onSettings }: { onPick: (p: Place) => void; origin: LatLng; onSettings: () => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = searchPlaces(q);
  const go = () => results[0] && onPick(results[0]);
  return (
    <div className="rounded-3xl bg-card p-2 shadow-sheet">
      <div className="flex items-center gap-2 px-2 pb-2 pt-1"><Logo /><span className="ml-auto text-xs font-semibold text-muted-foreground">Smart Navigation</span><button onClick={onSettings} aria-label="Settings" className="grid size-9 place-items-center rounded-xl hover:bg-muted"><Settings className="size-5" /></button></div>
      <div className="flex items-center gap-2 rounded-2xl bg-muted px-3">
        <Search className="size-5 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="Where are you going?"
          aria-label="Destination"
          className="h-12 flex-1 bg-transparent text-base font-medium outline-none placeholder:text-muted-foreground"
        />
        {q && <button aria-label="Clear" onClick={() => setQ("")}><X className="size-4 text-muted-foreground" /></button>}
        <button onClick={go} aria-label="Search routes" className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Navigation className="size-4" /></button>
      </div>
      {open && (
        <ul className="mt-1 max-h-72 overflow-y-auto">
          {results.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No matches — try "Tate" or tap the map.</li>}
          {results.map((p) => (
            <li key={p.id}>
              <button onClick={() => onPick(p)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-muted">
                <span className="grid size-9 place-items-center rounded-full bg-accent text-accent-foreground"><MapPin className="size-4" /></span>
                <span><span className="block text-sm font-semibold">{p.name}</span><span className="block text-xs text-muted-foreground">{p.area} · {fmtKm(haversineKm(origin, p.pos) * 1.3)}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TopBar({ dest, onBack, stage }: { dest: Place | null; onBack: () => void; stage: Stage }) {
  const steps: Stage[] = ["routes", "parking", "cost"];
  const i = steps.indexOf(stage);
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-card p-2 pr-4 shadow-sheet">
      <button onClick={onBack} aria-label="Back" className="grid size-11 place-items-center rounded-2xl bg-muted"><ArrowLeft className="size-5" /></button>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">To</p>
        <p className="truncate text-sm font-bold">{dest?.name}</p>
      </div>
      <div className="flex gap-1">{steps.map((s, k) => <span key={s} className={`h-1.5 w-5 rounded-full ${k <= i ? "bg-primary" : "bg-border"}`} />)}</div>
    </div>
  );
}

/* ---------- Sheets ---------- */

function PlanToggle() {
  const plan = usePlan();
  return (
    <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1" role="radiogroup" aria-label="Pricing plan">
      {(Object.keys(PLANS) as Plan[]).map((k) => (
        <button key={k} role="radio" aria-checked={plan === k} onClick={() => setPlan(k)} className={`h-10 rounded-xl text-sm font-semibold transition ${plan === k ? "bg-card shadow-sheet" : "text-muted-foreground"}`}>{PLANS[k].label}</button>
      ))}
    </div>
  );
}

function Welcome({ bikes, geoText, live }: { bikes: number; geoText: string; live: boolean }) {
  const plan = usePlan();
  const pr = PLANS[plan];
  return (
    <div>
      <h2 className="text-2xl font-bold">Ride somewhere smarter</h2>
      <p className="mt-1 text-sm text-muted-foreground">Search a destination or tap anywhere on the map to drop a pin.</p>
      <p className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${live ? "text-lime-deep" : "text-muted-foreground"}`}><LocateFixed className="size-3.5" />{geoText}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-lime-soft p-4"><BikeIcon className="size-5 text-lime-deep" /><p className="mt-2 font-display text-2xl font-bold">{bikes}</p><p className="text-xs text-muted-foreground">Bikes within 500 m</p></div>
        <div className="rounded-2xl bg-muted p-4"><Zap className="size-5" /><p className="mt-2 font-display text-2xl font-bold">{money(pr.perMinute)}</p><p className="text-xs text-muted-foreground">per minute + {pr.unlock ? `${money(pr.unlock)} unlock` : "free unlock"}</p></div>
      </div>
    </div>
  );
}

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const geo = useGeo();
  return (
    <div>
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Settings</h2><button onClick={onClose} aria-label="Close settings" className="grid size-10 place-items-center rounded-2xl bg-muted"><X className="size-5" /></button></div>
      <p className="mt-4 text-sm font-semibold">Pricing plan</p>
      <p className="text-xs text-muted-foreground">Lime Access is Lime's discounted plan for eligible riders.</p>
      <PlanToggle />
      <div className="mt-3 space-y-1.5 rounded-2xl bg-muted p-3 text-xs">
        {(Object.keys(PLANS) as Plan[]).map((k) => <div key={k} className="flex justify-between"><span className="font-semibold">{PLANS[k].label}</span><span>{PLANS[k].unlock ? `${money(PLANS[k].unlock)} unlock` : "Free unlock"} + {money(PLANS[k].perMinute)}/min</span></div>)}
      </div>
      <p className="mt-5 text-sm font-semibold">Location</p>
      <p className="mt-1 flex items-center gap-2 text-sm"><LocateFixed className="size-4" />{geoLabel[geo.status]}</p>
      {(geo.status === "denied" || geo.status === "unavailable") && <p className="mt-1 text-xs text-muted-foreground">Allow location for this site in your browser settings, then reload.</p>}
      <PrimaryBtn onClick={onClose}>Done</PrimaryBtn>
    </div>
  );
}

function RoutesSheet({ routes, selected, onSelect, onNext }: { routes: LimeRoute[]; selected: string | null; onSelect: (id: string) => void; onNext: () => void }) {
  const plan = usePlan();
  return (
    <div>
      <h2 className="text-xl font-bold">Choose your route</h2>
      <p className="text-sm text-muted-foreground">{PLANS[plan].label} prices · estimates based on ride time.</p>
      <div className="mt-4 space-y-3">
        {routes.map((r) => {
          const on = r.id === selected;
          const cost = estimateCost(r.minutes, plan);
          return (
            <button key={r.id} onClick={() => onSelect(r.id)} className={`w-full rounded-3xl border-2 p-4 text-left transition ${on ? "border-primary bg-lime-soft" : "border-border bg-card hover:border-primary/50"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{r.name}</span>
                    {r.recommended && <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-background">Best</span>}
                  </div>
                  <p className="mt-1 font-display text-2xl font-bold">{r.minutes} min</p>
                  <p className="text-xs text-muted-foreground">{fmtKm(r.distanceKm)} · arrive {eta(r.minutes)}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-3xl font-extrabold">{money(cost.total)}</p>
                  <p className="text-[11px] text-muted-foreground">est. total</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs font-medium"><span className={`size-2.5 rounded-full ${trafficDot[r.traffic]}`} />{trafficLabel[r.traffic]}</div>
            </button>
          );
        })}
      </div>
      <PrimaryBtn onClick={onNext}>Choose parking</PrimaryBtn>
    </div>
  );
}

function ParkingSheet({ dest, parking, selected, onSelect, onNext }: { dest: Place; parking: Parking[]; selected: string | null; onSelect: (id: string) => void; onNext: () => void }) {
  return (
    <div>
      <h2 className="text-xl font-bold">Park near {dest.name}</h2>
      <p className="text-sm text-muted-foreground">Designated Lime bays · end your ride here to avoid fees.</p>
      <div className="mt-4 space-y-2.5">
        {parking.map((p, i) => {
          const on = p.id === selected;
          return (
            <button key={p.id} onClick={() => onSelect(p.id)} className={`flex w-full items-center gap-3 rounded-3xl border-2 p-3.5 text-left transition ${on ? "border-primary bg-lime-soft" : "border-border hover:border-primary/50"}`}>
              <span className={`grid size-11 shrink-0 place-items-center rounded-2xl font-display text-lg font-extrabold ${on ? "bg-primary" : "bg-muted"}`}>P</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{p.name}</span>{i === 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground">Closest</span>}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><Footprints className="size-3.5" />{p.walkMin} min walk · {p.walkM} m</span>
              </span>
            </button>
          );
        })}
      </div>
      <PrimaryBtn onClick={onNext} disabled={!selected}>{selected ? "Review cost" : "Select a parking bay"}</PrimaryBtn>
    </div>
  );
}

function CostSheet({ route, park, onStart }: { route: LimeRoute; park: Parking; onStart: () => void }) {
  const plan = usePlan();
  const c = estimateCost(route.minutes, plan);
  return (
    <div>

      <div className="flex items-end justify-between">
        <div><p className="text-sm text-muted-foreground">Estimated total</p><p className="font-display text-5xl font-extrabold">{money(c.total)}</p></div>
        <div className="text-right"><p className="font-display text-xl font-bold">{route.minutes} min</p><p className="text-xs text-muted-foreground">arrive {eta(route.minutes + park.walkMin)}</p></div>
      </div>
      <dl className="mt-5 space-y-2.5 rounded-3xl bg-muted p-4 text-sm">
        <Row k="Plan" v={`${PLANS[plan].label} · change in Settings`} />
        <Row k="Unlock fee" v={c.unlock ? money(c.unlock) : "Free"} />
        <Row k="Estimated ride" v={`${c.minutes} min`} />
        <Row k="Per-minute rate" v={`${money(c.perMinute)} / min`} />
        <Row k="Ride charge" v={money(c.ride)} />
        <div className="border-t border-border pt-2.5"><Row k={<b>Estimated total</b>} v={<b>{money(c.total)}</b>} /></div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">This is an estimate, not a guaranteed final charge. Your actual price depends on real ride time and will update if traffic changes.</p>
      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border p-3 text-sm">
        <span className="grid size-9 place-items-center rounded-xl bg-primary font-bold">P</span>
        <span className="flex-1"><b>{park.name}</b><br /><span className="text-xs text-muted-foreground">{fmtKm(route.distanceKm)} ride · then {park.walkMin} min walk</span></span>
      </div>
      <PrimaryBtn onClick={onStart}><Navigation className="size-5" /> Start navigation</PrimaryBtn>
    </div>
  );
}

const Row = ({ k, v }: { k: React.ReactNode; v: React.ReactNode }) => <div className="flex justify-between"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>;

function PrimaryBtn({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-display text-base font-bold text-primary-foreground shadow-sheet transition active:scale-[.98] disabled:bg-muted disabled:text-muted-foreground">{children}</button>;
}

/* ---------- Live navigation ---------- */

type Alert = { kind: "info" | "reroute"; text: string; alt?: LimeRoute };

function ManeuverIcon({ m, className }: { m: Step["maneuver"]; className?: string }) {
  const I = m === "left" ? CornerUpLeft : m === "right" ? CornerUpRight : m === "arrive" ? Flag : ArrowUp;
  return <I className={className} />;
}

function LiveNav({ initialRoute, park, dest, start, onExit }: { initialRoute: LimeRoute; park: Parking; dest: Place; start: LatLng; onExit: () => void }) {
  void start;
  const geo = useGeo();
  const [mode, setMode] = useState<"gps" | "demo">(geo.status === "live" ? "gps" : "demo");
  const startedAt = useRef(Date.now());
  const lastReroute = useRef(0);
  const [route, setRoute] = useState<LimeRoute>(initialRoute);
  const [idx, setIdx] = useState(0);
  const [traffic, setTraffic] = useState<Traffic>(initialRoute.traffic);
  const [elapsed, setElapsed] = useState(0); // simulated ride minutes so far
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);
  const plan = usePlan();
  const [arrived, setArrived] = useState(false);
  const lastSpoken = useRef(-1);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const rider = mode === "gps" && geo.pos ? geo.pos : route.points[Math.min(idx, route.points.length - 1)]!;
  const remKm = remainingKm(route, idx);
  const remMin = rideMinutes(remKm, traffic);
  const cost = estimateCost(Math.max(1, Math.round(elapsed + remMin)), plan);
  const stepIdx = route.steps.findIndex((s) => s.atIndex > idx);
  const next = route.steps[stepIdx === -1 ? route.steps.length - 1 : stepIdx]!;
  const distToNext = remainingKm({ ...route, points: route.points.slice(0, next.atIndex + 1) }, idx);

  // live GPS tracking: snap to route, detect arrival, reroute when off-route
  useEffect(() => {
    if (mode !== "gps" || !geo.pos || arrived) return;
    const pos = geo.pos;
    setElapsed((Date.now() - startedAt.current) / 60000);
    if (haversineKm(pos, park.pos) < 0.025) { setArrived(true); return; }
    const lo = Math.max(0, idx - 5);
    const ni = nearestIndex(route.points.slice(0, idx + 80), pos, lo);
    if (ni !== idx) setIdx(ni);
    const off = haversineKm(route.points[ni]!, pos);
    if (off > 0.04 && Date.now() - lastReroute.current > 15000) {
      lastReroute.current = Date.now();
      speak("You're off route. Finding a new route.", mutedRef.current);
      void fetchBikeRoutes(pos, park.pos, dest.name).then((rs) => {
        setRoute({ ...rs[0]!, traffic });
        setIdx(0);
        lastSpoken.current = -1;
        setAlert({ kind: "info", text: "New route found from your position." });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.pos, mode]);

  // demo movement tick
  useEffect(() => {
    if (mode !== "demo" || paused || arrived) return;
    const t = setInterval(() => {
      setIdx((i) => {
        const n = Math.min(i + 1, route.points.length - 1);
        const segKm = haversineKm(route.points[i]!, route.points[n]!);
        setElapsed((e) => e + (segKm / ({ light: 15, moderate: 12.5, heavy: 9.5 }[traffic])) * 60);
        if (n >= route.points.length - 1) setArrived(true);
        return n;
      });
    }, 600);
    return () => clearInterval(t);
  }, [mode, paused, arrived, route, traffic]);

  // simulated traffic + parking availability feed
  useEffect(() => {
    if (paused || arrived) return;
    const t = setInterval(() => triggerTraffic(), 14000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, arrived, route, idx > 0]);

  const trafficRef = useRef(traffic);
  trafficRef.current = traffic;
  function triggerTraffic(force?: Traffic) {
    const order: Traffic[] = ["light", "moderate", "heavy"];
    const nt: Traffic = force ?? order[Math.floor(Math.random() * 3)]!;
    if (nt === trafficRef.current) return;
    setTraffic(nt);
    if (nt === "heavy") {
      const curMin = rideMinutes(remainingKm(route, idx), "heavy");
      void fetchBikeRoutes(rider, park.pos, dest.name, 1 + Math.floor(Math.random() * 2)).then((rs) => {
        const alt = rs.map((r) => ({ ...r, traffic: "light" as Traffic, minutes: rideMinutes(r.distanceKm, "light") })).sort((x, y) => x.minutes - y.minutes)[0];
        if (alt && alt.minutes < curMin) {
          const msg = `Heavy traffic ahead. A faster route saves ${curMin - alt.minutes} minutes.`;
          setAlert({ kind: "reroute", text: msg, alt });
          speak(msg, mutedRef.current);
        } else setAlert({ kind: "info", text: "Heavy traffic ahead — ETA updated." });
      });
    } else {
      setAlert({ kind: "info", text: nt === "light" ? "Traffic has cleared — you'll arrive sooner." : "Traffic is building — ETA updated." });
    }
  }

  useEffect(() => {
    if (alert?.kind !== "info") return;
    const t = setTimeout(() => setAlert(null), 4500);
    return () => clearTimeout(t);
  }, [alert]);

  // voice guidance
  useEffect(() => {
    const k = route.steps.indexOf(next);
    if (k !== lastSpoken.current && (distToNext < 0.12 || lastSpoken.current === -1)) {
      lastSpoken.current = k;
      speak(lastSpoken.current === 0 ? `Starting route. ${next.text}` : `In ${Math.round(distToNext * 1000)} metres, ${next.text}`, muted);
    }
  }, [next, distToNext, route.steps, muted]);

  useEffect(() => {
    if (arrived) speak(`You've arrived at ${park.name}. Lock your bike, then walk ${park.walkMin} minutes to ${dest.name}.`, mutedRef.current);
  }, [arrived, park, dest]);

  useEffect(() => () => { if (typeof window !== "undefined") window.speechSynthesis?.cancel(); }, []);

  const switchRoute = () => {
    if (!alert?.alt) return;
    setRoute(alert.alt);
    setIdx(0);
    setTraffic("light");
    lastSpoken.current = -1;
    setAlert({ kind: "info", text: "Switched to the faster route." });
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-muted">
      <ClientOnly fallback={null}>
        <Suspense fallback={null}>
          <MapView
            user={start}
            rider={arrived ? park.pos : rider}
            follow={!arrived}
            dest={dest.pos}
            routes={[{ ...route, points: route.points.slice(idx) }]}
            selectedRouteId={route.id}
            parking={[park]}
            selectedParkingId={park.id}
            walkLine={[park.pos, dest.pos]}
          />
        </Suspense>
      </ClientOnly>

      {/* Next turn banner */}
      <div className="absolute inset-x-0 top-0 z-[500] space-y-2 p-3 md:left-4 md:right-auto md:top-4 md:w-[420px] md:p-0">
        {!arrived ? (
          <div className="flex items-center gap-4 rounded-3xl bg-foreground p-4 text-background shadow-sheet">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground"><ManeuverIcon m={next.maneuver} className="size-8" /></span>
            <div className="min-w-0">
              <p className="font-display text-3xl font-extrabold">{fmtKm(distToNext)}</p>
              <p className="truncate text-sm opacity-80">{next.text}</p>
            </div>
            <button onClick={() => setMuted((m) => { if (!m) window.speechSynthesis?.cancel(); return !m; })} aria-label={muted ? "Unmute voice" : "Mute voice"} className="ml-auto grid size-12 shrink-0 place-items-center rounded-2xl bg-background/15">
              {muted ? <VolumeX className="size-6" /> : <Volume2 className="size-6" />}
            </button>
          </div>
        ) : null}
        {alert && (
          <div className={`animate-sheet rounded-3xl p-4 shadow-sheet ${alert.kind === "reroute" ? "bg-card" : "bg-lime-soft"}`}>
            <div className="flex items-start gap-3">
              <AlertTriangle className={`mt-0.5 size-5 shrink-0 ${alert.kind === "reroute" ? "text-traffic-heavy" : "text-lime-deep"}`} />
              <p className="flex-1 text-sm font-semibold">{alert.text}</p>
              <button aria-label="Dismiss" onClick={() => setAlert(null)}><X className="size-4" /></button>
            </div>
            {alert.kind === "reroute" && alert.alt && (
              <div className="mt-3 flex gap-2">
                <button onClick={switchRoute} className="h-11 flex-1 rounded-2xl bg-primary text-sm font-bold text-primary-foreground">Switch · {alert.alt.minutes} min · {money(estimateCost(Math.round(elapsed + alert.alt.minutes), plan).total)}</button>
                <button onClick={() => setAlert(null)} className="h-11 rounded-2xl bg-muted px-4 text-sm font-semibold">Keep</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <section className="animate-sheet absolute inset-x-0 bottom-0 z-[500] rounded-t-[2rem] bg-card p-5 shadow-sheet md:bottom-4 md:left-4 md:right-auto md:w-[420px] md:rounded-[2rem]">
        {!arrived ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat v={eta(remMin)} k="Arrival" />
              <Stat v={fmtKm(remKm)} k="Remaining" />
              <Stat v={money(cost.total)} k="Est. cost" big />
            </div>
            <div className="mt-3 flex items-center justify-between rounded-2xl bg-muted px-3 py-2.5 text-xs">
              <span className="flex items-center gap-2 font-medium"><span className={`size-2.5 rounded-full ${trafficDot[traffic]}`} />{trafficLabel[traffic]} · {remMin} min left</span>
              <span className="flex items-center gap-1 font-semibold"><span className="grid size-5 place-items-center rounded bg-primary text-[10px] font-bold">P</span>{PLANS[plan].label}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-semibold"><LocateFixed className={`size-3.5 ${mode === "gps" ? "text-lime-deep" : ""}`} />{mode === "gps" ? "Following your GPS" : "Demo ride (simulated movement)"}</span>
              {geo.status === "live" && <button onClick={() => { setMode((m) => (m === "gps" ? "demo" : "gps")); startedAt.current = Date.now() - elapsed * 60000; }} className="rounded-full bg-muted px-3 py-1 font-semibold">{mode === "gps" ? "Switch to demo" : "Use my GPS"}</button>}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => triggerTraffic("heavy")} className="h-12 flex-1 rounded-2xl border-2 border-border text-sm font-semibold">Simulate traffic jam</button>
              {mode === "demo" && <button onClick={() => setPaused((p) => !p)} className="h-12 rounded-2xl border-2 border-border px-4 text-sm font-semibold">{paused ? "Resume" : "Pause"}</button>}
              <button onClick={onExit} className="h-12 rounded-2xl bg-destructive px-4 text-sm font-bold text-destructive-foreground">End</button>
            </div>
          </>
        ) : (
          <div>
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-2xl bg-primary"><Check className="size-6" /></span>
              <div><h2 className="text-xl font-bold">Ride complete</h2><p className="text-sm text-muted-foreground">Parked at {park.name}</p></div>
            </div>
            <div className="mt-4 rounded-3xl bg-lime-soft p-4">
              <p className="flex items-center gap-2 text-sm font-semibold"><Footprints className="size-4" /> Walk to {dest.name}</p>
              <p className="mt-1 font-display text-3xl font-extrabold">{park.walkMin} min <span className="text-base font-semibold text-muted-foreground">· {park.walkM} m</span></p>
              <p className="mt-1 text-xs text-muted-foreground">Follow the dotted line on the map · arrive {eta(park.walkMin)}</p>
            </div>
            <dl className="mt-3 space-y-2 rounded-3xl bg-muted p-4 text-sm">
              <Row k="Ride time" v={`${Math.max(1, Math.round(elapsed))} min`} />
              <Row k="Estimated charge" v={<b>{money(estimateCost(Math.max(1, Math.round(elapsed)), plan).total)}</b>} />
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Estimate only — your final charge appears in your Lime receipt.</p>
            <PrimaryBtn onClick={onExit}>Plan another journey</PrimaryBtn>
          </div>
        )}
      </section>
    </main>
  );
}

const Stat = ({ v, k, big }: { v: string; k: string; big?: boolean }) => (
  <div className={`rounded-2xl p-3 ${big ? "bg-primary" : "bg-muted"}`}>
    <p className="font-display text-xl font-extrabold">{v}</p>
    <p className="text-[11px] font-medium opacity-70">{k}</p>
  </div>
);
