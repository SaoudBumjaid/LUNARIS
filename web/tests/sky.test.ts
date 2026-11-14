// Checks the Sun & Earth / Compare engine (src/engine/sky.ts) on the real datasets. npx tsx tests/sky.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { idx, type Dataset, type Meta } from '../src/engine/dataset';
import { windowStats, sunFrac, earthVis } from '../src/engine/illum';
import { analyseSpan, scoreSpan, pointState, type Dsn } from '../src/engine/sky';

const root = new URL('../public/data/', import.meta.url);
function load(id: string): Dataset {
  const base = new URL(id + '/', root);
  const meta: Meta = JSON.parse(readFileSync(new URL('meta.json', base), 'utf8'));
  const f = (n: string) => readFileSync(new URL(meta.files[n], base));
  const eph = JSON.parse(f('ephem').toString());
  const W = meta.width, H = meta.height, N = W * H, cell = meta.cellSize;
  const dx = new Float32Array(N), dy = new Float32Array(N);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const i = r * W + c; dx[i] = meta.x0 + (c + 0.5) * cell - meta.center.x; dy[i] = meta.y0 - (r + 0.5) * cell - meta.center.y; }
  const f32 = (n: string) => { const b = f(n); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
  const u8 = (n: string) => new Uint8Array(f(n));
  const elev = f32('elevation');
  let mn = Infinity, mx = -Infinity; for (const v of elev) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  return { meta, ephem: eph, W, H, N, cell, elev, slope: f32('slope'), rough: f32('rough'), horizon: u8('horizon'), sunAnnual: u8('sunAnnual'),
    earthAnnual: u8('earthAnnual'), psr: u8('psr'), dx, dy, t0ms: Date.parse(eph.t0), hours: eph.sunAz.length, elevMin: mn, elevMax: mx };
}


let fails = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };

// DSN table: decode exactly like the app does and compare with the percentages written by the Python builder
const dj = JSON.parse(readFileSync(new URL('dsn.json', root), 'utf8'));
const dsn: Dsn = { t0ms: Date.parse(dj.t0), hours: dj.hours, minElDeg: dj.minElDeg, anyPct: dj.anyPct, method: dj.method, caveat: dj.caveat,
  stations: dj.stations.map((s: { name: string; lat: number; lon: number; pct: number; bits: string }) => {
    const b = Buffer.from(s.bits, 'base64'); const up = new Uint8Array(dj.hours);
    for (let h = 0; h < dj.hours; h++) up[h] = (b[h >> 3] >> (7 - (h & 7))) & 1;
    return { ...s, up };
  }) };
for (const s of dsn.stations) { const p = 100 * s.up.reduce((a, v) => a + v, 0) / dsn.hours; check(Math.abs(p - s.pct) < 0.06, `DSN decode ${s.name}: ${p.toFixed(1)}% = builder ${s.pct}%`); }
let any = 0; for (let h = 0; h < dsn.hours; h++) if (dsn.stations.some(s => s.up[h])) any++;
check(Math.abs(100 * any / dsn.hours - dsn.anyPct) < 0.06, `DSN any-complex coverage ${(100 * any / dsn.hours).toFixed(1)}% = builder ${dsn.anyPct}%`);

const regions = JSON.parse(readFileSync(new URL('regions.json', root), 'utf8')).regions;
const out: Record<string, unknown>[] = [];
for (const reg of regions) {
  const ds = load(reg.id); const s = ds.meta.sites[0]; const c = idx(ds, s.cell[0], s.cell[1]);
  // 1) full year at the named site must match the yearly numbers in regions.json (built by Python)
  const y = analyseSpan(ds, c, 0, ds.hours, dsn, 350);
  check(Math.abs(y.meanSunPct / 100 - reg.siteSun) < 0.01, `${reg.name}: year mean sunlight ${y.meanSunPct.toFixed(1)}% vs pipeline ${(reg.siteSun * 100).toFixed(1)}%`);
  check(Math.abs(y.losPct / 100 - reg.siteEarth) < 0.01, `${reg.name}: year Earth LOS ${y.losPct.toFixed(1)}% vs pipeline ${(reg.siteEarth * 100).toFixed(1)}%`);
  // 2) 30-day window must agree with the older windowStats() used by Mission Command
  const h0 = 14 * 24, dur = 30 * 24, w = windowStats(ds, c, h0, dur, 1000), a = analyseSpan(ds, c, h0, dur, dsn, 350);
  check(Math.abs(w.earthPct - a.losPct) < 1e-9 && w.longestDarkH === a.longestDarkH, `${reg.name}: analyseSpan = windowStats (LOS ${a.losPct.toFixed(1)}%, longest dark ${a.longestDarkH} h)`);
  // 3) windows add up, contact is a subset of LOS, energy formula
  const litH = a.sunWins.reduce((t, x) => t + x.hours, 0), conH = a.contactWins.reduce((t, x) => t + x.hours, 0);
  check(Math.abs(litH / a.dur * 100 - a.litPct) < 1e-9 && Math.abs(conH / a.dur * 100 - a.contactPct) < 1e-9, `${reg.name}: window lists add up to the percentages`);
  let sub = true; for (let k = 0; k < a.dur; k++) if (a.contact[k] && !a.los[k]) sub = false;
  check(sub && a.contactPct <= a.losPct, `${reg.name}: contact ⊆ line of sight (${a.contactPct.toFixed(1)}% ≤ ${a.losPct.toFixed(1)}%)`);
  let e = 0; for (let k = 0; k < a.dur; k++) e += sunFrac(ds, c, h0 + k) * 350 / 1000;
  check(Math.abs(e - a.energyKWh) < 1e-6, `${reg.name}: energy ${a.energyKWh.toFixed(1)} kWh = Σ 350 W × visible fraction`);
  // 4) point state agrees with illum.ts
  const ps = pointState(ds, c, h0 + 5, dsn);
  check(ps.earthLos === earthVis(ds, c, h0 + 5) && Math.abs(ps.sunFrac - sunFrac(ds, c, h0 + 5)) < 1e-9, `${reg.name}: point state matches illumination engine`);
  // 5) score bounds
  const sc = scoreSpan(a, 0.5); check(sc.total >= 0 && sc.total <= 100, `${reg.name}: score in 0..100 (${sc.total.toFixed(1)})`);
  out.push({ region: reg.name, site: s.name, year: { meanSunPct: +y.meanSunPct.toFixed(2), losPct: +y.losPct.toFixed(2), contactPct: +y.contactPct.toFixed(2), kWhPerDay: +y.kWhPerDay.toFixed(2) },
    window30d_from_2027_01_15: { litPct: +a.litPct.toFixed(1), losPct: +a.losPct.toFixed(1), contactPct: +a.contactPct.toFixed(1), longestDarkH: a.longestDarkH, longestNoContactH: a.longestNoContactH, score: +sc.total.toFixed(1) } });
}
writeFileSync(new URL('sky_results.json', import.meta.url), JSON.stringify({ fails, results: out }, null, 1));
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
