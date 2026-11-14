// Rover traverse planning.
//  1) "Shortest path": classic A* on distance with slope limit (ignores time, Sun and Earth).
//  2) "Sun-aware path": time-dependent A* (earliest arrival) over (cell, time, battery) labels.
//     Shadows move every hour; the rover may WAIT to recharge or for Earth contact.
import type { Dataset } from './dataset';
import { rc } from './dataset';
import { earthVis, sunFrac } from './illum';

export interface RoverParams {
  speedMps: number; maxSlope: number; panelW: number; driveW: number; idleW: number;
  batteryWh: number; reservePct: number; requireDTE: boolean; maxHours: number;
}
export const defaultRover: RoverParams = {
  speedMps: 0.1, maxSlope: 18, panelW: 350, driveW: 250, idleW: 70, batteryWh: 2500, reservePct: 20, requireDTE: false, maxHours: 24 * 14,
};

export interface Step { cell: number; t: number; b: number; kind: 'start' | 'move' | 'wait' }
export interface RouteResult {
  ok: boolean; name: string; steps: Step[]; reason?: string;
  lengthM: number; durationH: number; driveH: number; waitH: number; minBatteryPct: number; endBatteryPct: number;
  darkDriveH: number; earthPct: number; maxSlope: number; expansions: number;
}

// Weighted A* (bounded-suboptimal, ≤ EPS × optimal arrival time) keeps the search interactive.
const EPS = 1.4;
const NB = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

class Heap<T> {
  a: { k: number; v: T }[] = [];
  push(k: number, v: T) { const a = this.a; a.push({ k, v }); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].k <= a[i].k) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop(): T | undefined {
    const a = this.a; if (!a.length) return undefined; const top = a[0].v; const last = a.pop()!;
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].k < a[m].k) m = l; if (r < a.length && a[r].k < a[m].k) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

function moveCost(ds: Dataset, a: number, b: number, diag: boolean, p: RoverParams) {
  const d = ds.cell * (diag ? Math.SQRT2 : 1);
  const dz = ds.elev[b] - ds.elev[a];
  const s = Math.max(ds.slope[a], ds.slope[b]);
  const slowdown = 1 + 1.5 * (s / p.maxSlope) ** 2 + (dz > 0 ? dz / d : 0);
  return { distM: Math.hypot(d, dz), hours: (d * slowdown) / p.speedMps / 3600 };
}

/** Static A* (distance + slope penalty). Returns cell path or null. */
export function shortestPath(ds: Dataset, start: number, goal: number, p: RoverParams, blocked?: Set<number>): number[] | null {
  const g = new Float64Array(ds.N).fill(Infinity), from = new Int32Array(ds.N).fill(-1);
  const [gr, gc] = rc(ds, goal);
  const h = (i: number) => { const [r, c] = rc(ds, i); return Math.hypot(r - gr, c - gc) * ds.cell; };
  const open = new Heap<number>(); g[start] = 0; open.push(h(start), start);
  const closed = new Uint8Array(ds.N);
  while (open.size) {
    const u = open.pop()!; if (u === goal) break; if (closed[u]) continue; closed[u] = 1;
    const [r, c] = rc(ds, u);
    for (const [drr, dcc] of NB) {
      const nr = r + drr, nc = c + dcc; if (nr < 0 || nc < 0 || nr >= ds.H || nc >= ds.W) continue;
      const v = nr * ds.W + nc; if (ds.slope[v] > p.maxSlope || blocked?.has(v)) continue;
      const mc = moveCost(ds, u, v, drr !== 0 && dcc !== 0, p);
      const ng = g[u] + mc.hours * p.speedMps * 3600;
      if (ng < g[v]) { g[v] = ng; from[v] = u; open.push(ng + h(v), v); }
    }
  }
  if (!Number.isFinite(g[goal])) return null;
  const path = [goal]; while (path[path.length - 1] !== start) path.push(from[path[path.length - 1]]);
  return path.reverse();
}

/** Backward Dijkstra from goal: lower-bound driving hours to goal for every cell (admissible heuristic). */
export function hoursToGoal(ds: Dataset, goal: number, p: RoverParams, blocked?: Set<number>): Float64Array {
  const g = new Float64Array(ds.N).fill(Infinity); const open = new Heap<number>();
  g[goal] = 0; open.push(0, goal); const done = new Uint8Array(ds.N);
  while (open.size) {
    const u = open.pop()!; if (done[u]) continue; done[u] = 1;
    const [r, c] = rc(ds, u);
    for (const [drr, dcc] of NB) {
      const nr = r + drr, nc = c + dcc; if (nr < 0 || nc < 0 || nr >= ds.H || nc >= ds.W) continue;
      const v = nr * ds.W + nc; if (ds.slope[v] > p.maxSlope || blocked?.has(v)) continue;
      const diag = drr !== 0 && dcc !== 0;
      const h = Math.min(moveCost(ds, v, u, diag, p).hours, moveCost(ds, u, v, diag, p).hours);
      if (g[u] + h < g[v]) { g[v] = g[u] + h; open.push(g[v], v); }
    }
  }
  return g;
}

/** Simulate a fixed cell path from time t0 with no waiting. */
export function simulatePath(ds: Dataset, path: number[], t0: number, b0: number, p: RoverParams): { steps: Step[]; fail?: string } {
  const cap = p.batteryWh, reserve = cap * p.reservePct / 100;
  let t = t0, b = b0; const steps: Step[] = [{ cell: path[0], t, b, kind: 'start' }];
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], c = path[k]; const [ar, ac] = rc(ds, a), [cr, cc] = rc(ds, c);
    const mc = moveCost(ds, a, c, ar !== cr && ac !== cc, p);
    const solar = p.panelW * sunFrac(ds, a, t);
    b = Math.min(cap, b + (solar - p.driveW) * mc.hours); t += mc.hours;
    steps.push({ cell: c, t, b, kind: 'move' });
    if (b < reserve) return { steps, fail: `Battery below ${p.reservePct}% reserve after ${(t - t0).toFixed(1)} h (driving in shadow without recharge stops).` };
  }
  return { steps };
}

interface Label { cell: number; t: number; b: number; parent: Label | null; kind: Step['kind'] }

/** Time-dependent, energy-constrained A* (earliest arrival). */
export function sunAwareLeg(ds: Dataset, start: number, goal: number, t0: number, b0: number, p: RoverParams, blocked?: Set<number>, maxExp = 700000): { labels: Label | null; exp: number; reason?: string } {
  const cap = p.batteryWh, reserve = cap * p.reservePct / 100;
  const h2g = hoursToGoal(ds, goal, p, blocked);
  if (!Number.isFinite(h2g[start])) return { labels: null, exp: 0, reason: 'No slope-feasible corridor connects the points.' };
  const hEst = (i: number) => h2g[i];
  // Dominance within the same (cell, hour-slot): earlier arrival with >= battery bucket wins.
  const NBK = 20;
  const bestT = new Map<number, number>();
  const bucket = (b: number) => Math.min(NBK, Math.max(0, Math.floor((b / cap) * NBK)));
  const key = (cell: number, t: number, k: number) => ((cell * 4096 + (Math.floor(t) % 4096)) * (NBK + 1)) + k;
  const dominated = (L: Label) => {
    const k0 = bucket(L.b);
    for (let k = k0; k <= NBK; k++) { const v = bestT.get(key(L.cell, L.t, k)); if (v !== undefined && v <= L.t + 1e-9) return true; }
    return false;
  };
  const insert = (L: Label) => { bestT.set(key(L.cell, L.t, bucket(L.b)), L.t); };
  const stale = (L: Label) => { const v = bestT.get(key(L.cell, L.t, bucket(L.b))); return v !== undefined && v < L.t - 1e-9; };
  const open = new Heap<Label>();
  const s0: Label = { cell: start, t: t0, b: b0, parent: null, kind: 'start' };
  insert(s0); open.push(t0 + EPS * hEst(start), s0);
  let exp = 0, batteryFails = 0, dteWaits = 0;
  while (open.size) {
    const L = open.pop()!;
    if (stale(L)) continue;
    if (L.cell === goal) return { labels: L, exp };
    if (++exp > maxExp) return { labels: null, exp, reason: 'No feasible route within the search budget — the corridor is probably dark for longer than the battery allows at this departure time. Try “Find departure windows”.' };
    if (L.t - t0 > p.maxHours) continue;
    const sun = sunFrac(ds, L.cell, L.t);
    const dte = earthVis(ds, L.cell, L.t);
    // wait until next hour boundary
    const dtw = Math.max(0.25, Math.floor(L.t) + 1 - L.t);
    const bw = Math.min(cap, L.b + (p.panelW * sun - p.idleW) * dtw);
    // Waiting is only useful to recharge, to wait for sunrise, or to wait for Earth contact.
    const usefulWait = (sun > 0.2 && L.b < 0.95 * cap) || sun < 0.5 || (p.requireDTE && !dte);
    if (usefulWait && bw >= reserve) {
      const W: Label = { cell: L.cell, t: L.t + dtw, b: bw, parent: L, kind: 'wait' };
      if (!dominated(W)) { insert(W); open.push(W.t + EPS * hEst(W.cell), W); }
    } else batteryFails++;
    if (p.requireDTE && !dte) { dteWaits++; continue; }
    const [r, c] = rc(ds, L.cell);
    for (const [drr, dcc] of NB) {
      const nr = r + drr, nc = c + dcc; if (nr < 0 || nc < 0 || nr >= ds.H || nc >= ds.W) continue;
      const v = nr * ds.W + nc; if (!Number.isFinite(h2g[v])) continue;
      const mc = moveCost(ds, L.cell, v, drr !== 0 && dcc !== 0, p);
      const nb = Math.min(cap, L.b + (p.panelW * sun - p.driveW) * mc.hours);
      if (nb < reserve) { batteryFails++; continue; }
      const M: Label = { cell: v, t: L.t + mc.hours, b: nb, parent: L, kind: 'move' };
      if (!dominated(M)) { insert(M); open.push(M.t + EPS * hEst(v), M); }
    }
  }
  const why = batteryFails > dteWaits ? 'Battery cannot cover the darkness along every feasible corridor.' : p.requireDTE ? 'Earth line-of-sight is unavailable for too long along all corridors.' : 'No slope-feasible corridor connects the points.';
  return { labels: null, exp, reason: why };
}

function summarize(ds: Dataset, name: string, steps: Step[], p: RoverParams, ok: boolean, reason?: string, expansions = 0): RouteResult {
  let len = 0, drive = 0, wait = 0, dark = 0, earth = 0, maxS = 0, minB = Infinity;
  for (let k = 1; k < steps.length; k++) {
    const a = steps[k - 1], b = steps[k]; const dt = b.t - a.t;
    if (b.kind === 'move') {
      const [ar, ac] = rc(ds, a.cell), [br, bc] = rc(ds, b.cell);
      len += Math.hypot(ar - br, ac - bc) * ds.cell; drive += dt;
      if (sunFrac(ds, a.cell, a.t) < 0.5) dark += dt;
      maxS = Math.max(maxS, ds.slope[b.cell]);
    } else wait += dt;
    if (earthVis(ds, a.cell, a.t)) earth += dt;
    minB = Math.min(minB, b.b);
  }
  const dur = steps.length ? steps[steps.length - 1].t - steps[0].t : 0;
  const pct = (x: number) => 100 * x / p.batteryWh;
  return {
    ok, name, steps, reason, lengthM: len, durationH: dur, driveH: drive, waitH: wait,
    minBatteryPct: pct(Number.isFinite(minB) ? minB : steps[0]?.b ?? 0), endBatteryPct: pct(steps[steps.length - 1]?.b ?? 0),
    darkDriveH: dark, earthPct: dur > 0 ? 100 * earth / dur : 0, maxSlope: maxS, expansions,
  };
}

/** Plan a multi-leg traverse through waypoints[0] → … → waypoints[n]. */
export function planTraverse(ds: Dataset, waypoints: number[], t0: number, p: RoverParams, blocked?: Set<number>, maxExp = 700000): { shortest: RouteResult; sunAware: RouteResult } {
  const b0 = p.batteryWh;
  // shortest
  let sSteps: Step[] = [], sOk = true, sReason: string | undefined, t = t0, b = b0;
  for (let k = 1; k < waypoints.length && sOk; k++) {
    const path = shortestPath(ds, waypoints[k - 1], waypoints[k], p, blocked);
    if (!path) { sOk = false; sReason = `No slope-feasible path for leg ${k}.`; break; }
    const sim = simulatePath(ds, path, t, b, p);
    sSteps = sSteps.concat(k === 1 ? sim.steps : sim.steps.slice(1));
    const last = sim.steps[sim.steps.length - 1]; t = last.t; b = last.b;
    if (sim.fail) { sOk = false; sReason = `Leg ${k}: ${sim.fail}`; }
  }
  // sun-aware
  let aSteps: Step[] = [], aOk = true, aReason: string | undefined, exp = 0; t = t0; b = b0;
  for (let k = 1; k < waypoints.length; k++) {
    const res = sunAwareLeg(ds, waypoints[k - 1], waypoints[k], t, b, p, blocked, maxExp);
    exp += res.exp;
    if (!res.labels) { aOk = false; aReason = `Leg ${k}: ${res.reason}`; break; }
    const leg: Step[] = []; for (let L: Label | null = res.labels; L; L = L.parent) leg.push({ cell: L.cell, t: L.t, b: L.b, kind: L.kind });
    leg.reverse();
    aSteps = aSteps.concat(k === 1 ? leg : leg.slice(1));
    t = res.labels.t; b = res.labels.b;
  }
  return {
    shortest: summarize(ds, 'Shortest path (static A*)', sSteps, p, sOk, sReason),
    sunAware: summarize(ds, 'Sun-aware path (time-dependent A*)', aSteps, p, aOk, aReason, exp),
  };
}
