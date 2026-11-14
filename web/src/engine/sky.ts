// Sun / Earth / DSN analysis for one surface point over a time span.
// Everything here is computed from the region's horizon masks and the JPL DE421 ephemeris (see illum.ts),
// plus the DSN-complex Moon-elevation table built by pipeline/build_extras.py.
import { enuToLatLon, loadDataset, type Dataset, type RegionInfo, idx } from './dataset';
import { earthElGeom, earthVis, horizonAt, sunElGeom, sunFrac } from './illum';

// ---------------------------------------------------------------- dataset cache (several regions at once)
const dsCache = new Map<string, Promise<Dataset>>();
export function getDataset(regionId: string): Promise<Dataset> {
  let p = dsCache.get(regionId);
  if (!p) { p = loadDataset(`./data/${regionId}/`); dsCache.set(regionId, p); p.catch(() => dsCache.delete(regionId)); }
  return p;
}
export interface SiteRef { regionId: string; siteId: string; name: string; cell: [number, number]; lat: number; lon: number; regionName: string }

// ---------------------------------------------------------------- DSN geometric coverage
export interface DsnStation { name: string; lat: number; lon: number; pct: number; up: Uint8Array }
export interface Dsn { t0ms: number; hours: number; minElDeg: number; anyPct: number; stations: DsnStation[]; method: string; caveat: string }
let dsnP: Promise<Dsn | null> | null = null;
export function loadDsn(): Promise<Dsn | null> {
  if (!dsnP) dsnP = fetch('./data/dsn.json').then(r => (r.ok ? r.json() : null)).then(j => {
    if (!j) return null;
    const stations = j.stations.map((s: { name: string; lat: number; lon: number; pct: number; bits: string }) => {
      const b = atob(s.bits); const up = new Uint8Array(j.hours);
      for (let h = 0; h < j.hours; h++) up[h] = (b.charCodeAt(h >> 3) >> (7 - (h & 7))) & 1;
      return { name: s.name, lat: s.lat, lon: s.lon, pct: s.pct, up };
    });
    return { t0ms: Date.parse(j.t0), hours: j.hours, minElDeg: j.minElDeg, anyPct: j.anyPct, stations, method: j.method, caveat: j.caveat } as Dsn;
  }).catch(() => null);
  return dsnP;
}
/** Names of DSN complexes that see the Moon >= minEl at absolute time t (ms), or null if no table. */
export function dsnUpAt(dsn: Dsn | null, tms: number): string[] | null {
  if (!dsn) return null;
  const h = Math.round((tms - dsn.t0ms) / 3600e3);
  if (h < 0 || h >= dsn.hours) return null;
  return dsn.stations.filter(s => s.up[h]).map(s => s.name);
}

// ---------------------------------------------------------------- per-point state & spans
export interface PointState {
  sunAz: number; sunEl: number; sunHz: number; sunFrac: number;
  earthAz: number; earthEl: number; earthHz: number; earthLos: boolean; dsn: string[] | null;
}
export function pointState(ds: Dataset, cell: number, h: number, dsn: Dsn | null): PointState {
  const t = Math.max(0, Math.min(ds.hours - 1, Math.floor(h)));
  const sunAz = ds.ephem.sunAz[t], earthAz = ds.ephem.earthAz[t];
  return {
    sunAz, sunEl: sunElGeom(ds, cell, t), sunHz: horizonAt(ds, cell, sunAz), sunFrac: sunFrac(ds, cell, t),
    earthAz, earthEl: earthElGeom(ds, cell, t), earthHz: horizonAt(ds, cell, earthAz), earthLos: earthVis(ds, cell, t),
    dsn: dsnUpAt(dsn, ds.t0ms + t * 3600e3),
  };
}

export interface Win { start: number; end: number; hours: number }   // hours relative to dataset t0, end exclusive
export interface SpanResult {
  h0: number; dur: number;
  sunFrac: Float32Array; lit: Uint8Array; los: Uint8Array; contact: Uint8Array;
  litPct: number; meanSunPct: number; losPct: number; contactPct: number; bothPct: number;
  longestDarkH: number; longestNoLosH: number; longestNoContactH: number;
  energyKWh: number; kWhPerDay: number; panelW: number;
  sunWins: Win[]; losWins: Win[]; contactWins: Win[];
  hasDsn: boolean;
}
function runs(flags: Uint8Array, h0: number): Win[] {
  const out: Win[] = []; let s = -1;
  for (let k = 0; k <= flags.length; k++) {
    const on = k < flags.length && flags[k] === 1;
    if (on && s < 0) s = k;
    if (!on && s >= 0) { out.push({ start: h0 + s, end: h0 + k, hours: k - s }); s = -1; }
  }
  return out;
}
const longestOff = (f: Uint8Array) => { let m = 0, c = 0; for (const v of f) { c = v ? 0 : c + 1; if (c > m) m = c; } return m; };

/**
 * Hour-by-hour analysis at one cell over [h0, h0+dur).
 * lit = more than half of the solar disc above the terrain horizon. los = Earth centre above the terrain horizon.
 * contact = los AND at least one DSN complex sees the Moon >= its elevation limit (geometry only, not a schedule).
 * Energy = panelW x visible solar-disc fraction (ideal Sun-tracking panel, no losses).
 */
export function analyseSpan(ds: Dataset, cell: number, h0: number, dur: number, dsn: Dsn | null, panelW = 350): SpanResult {
  h0 = Math.max(0, Math.min(ds.hours - 1, Math.floor(h0)));
  const n = Math.max(1, Math.min(ds.hours - h0, Math.floor(dur)));
  const sf = new Float32Array(n), lit = new Uint8Array(n), los = new Uint8Array(n), con = new Uint8Array(n);
  let sum = 0, nl = 0, ne = 0, nc = 0, nb = 0;
  const off = dsn ? Math.round((ds.t0ms - dsn.t0ms) / 3600e3) : 0;
  for (let k = 0; k < n; k++) {
    const h = h0 + k, s = sunFrac(ds, cell, h), e = earthVis(ds, cell, h);
    let d = true;
    if (dsn) { const j = h + off; d = j >= 0 && j < dsn.hours && dsn.stations.some(st => st.up[j] === 1); }
    sf[k] = s; lit[k] = s > 0.5 ? 1 : 0; los[k] = e ? 1 : 0; con[k] = e && d ? 1 : 0;
    sum += s; nl += lit[k]; ne += los[k]; nc += con[k]; if (lit[k] && con[k]) nb++;
  }
  const energyKWh = panelW * sum / 1000;
  return {
    h0, dur: n, sunFrac: sf, lit, los, contact: con,
    litPct: 100 * nl / n, meanSunPct: 100 * sum / n, losPct: 100 * ne / n, contactPct: 100 * nc / n, bothPct: 100 * nb / n,
    longestDarkH: longestOff(lit), longestNoLosH: longestOff(los), longestNoContactH: longestOff(con),
    energyKWh, kWhPerDay: energyKWh / (n / 24), panelW,
    sunWins: runs(lit, h0), losWins: runs(los, h0), contactWins: runs(con, h0), hasDsn: !!dsn,
  };
}

// ---------------------------------------------------------------- transparent site score (Compare page)
export type Goal = 'balanced' | 'power' | 'contact';
export const GOALS: { key: Goal; label: string; power: number }[] = [
  { key: 'balanced', label: 'Balanced', power: 0.5 }, { key: 'power', label: 'Power first', power: 0.75 }, { key: 'contact', label: 'Earth contact first', power: 0.25 },
];
/** Gap tolerance: a 0 h gap scores 100 and a gap of `limitH` or more scores 0 (linear). */
export const gapScore = (h: number, limitH: number) => Math.max(0, Math.min(100, 100 * (1 - h / limitH)));
export interface Score { power: number; contact: number; total: number; nightScore: number; gapScoreV: number }
export function scoreSpan(r: SpanResult, powerWeight: number, limitH = 7 * 24): Score {
  const nightScore = gapScore(r.longestDarkH, limitH), gapScoreV = gapScore(r.longestNoContactH, limitH);
  const power = 0.6 * r.meanSunPct + 0.4 * nightScore;
  const contact = 0.6 * r.contactPct + 0.4 * gapScoreV;
  return { power, contact, total: powerWeight * power + (1 - powerWeight) * contact, nightScore, gapScoreV };
}

// ---------------------------------------------------------------- site lists across regions
export async function allSites(regions: RegionInfo[]): Promise<SiteRef[]> {
  const metas = await Promise.all(regions.map(r => fetch(`./data/${r.id}/meta.json`).then(x => x.json()).catch(() => null)));
  const out: SiteRef[] = [];
  metas.forEach((m, k) => {
    if (!m) return; const r = regions[k];
    for (const s of m.sites) {
      const x = m.x0 + (s.cell[1] + 0.5) * m.cellSize, y = m.y0 - (s.cell[0] + 0.5) * m.cellSize;
      const [lat, lon] = enuToLatLon(m.center.lat, m.center.lon, x, y, m.R);
      out.push({ regionId: r.id, siteId: s.id, name: s.name, cell: s.cell, lat, lon, regionName: r.name });
    }
  });
  return out;
}
export const siteCellIndex = (ds: Dataset, s: SiteRef) => idx(ds, s.cell[0], s.cell[1]);

/** CSV helper with provenance header lines. */
export function toCsv(head: string[], rows: (string | number)[][], notes: string[]): string {
  const q = (v: string | number) => (typeof v === 'number' ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [...notes.map(n => `# ${n}`), head.map(q).join(','), ...rows.map(r => r.map(q).join(','))].join('\n');
}
