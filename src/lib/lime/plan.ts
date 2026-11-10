import { useSyncExternalStore } from "react";
import type { Plan } from "./data";

let current: Plan = "standard";
const subs = new Set<() => void>();
export const setPlan = (p: Plan) => { current = p; subs.forEach((f) => f()); };
export const usePlan = () =>
  useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => current, () => "standard" as Plan);
