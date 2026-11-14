// Runs the real planner code on every real region dataset (Node, no browser).
// npx tsx tests/planner_real.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { idx, type Dataset, type Meta } from '../src/engine/dataset';
import { defaultRover, planTraverse } from '../src/engine/planner';
import { evaluateSite, defaultLander, defaultWeights } from '../src/engine/sites';
import { sunFrac } from '../src/engine/illum';

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
const regions = JSON.parse(readFileSync(new URL('regions.json', root), 'utf8')).regions;
const out: unknown[] = [];
for (const reg of regions) {
  const ds = load(reg.id);
  const site = ds.meta.sites[0]; const s = idx(ds, site.cell[0], site.cell[1]);
  check(ds.hours === 8760 && ds.meta.mode === 'real', `${reg.id}: real dataset, 8760 hourly samples`);
  // physics sanity: annual sunlight at the site cell matches the pipeline's value
  let acc = 0; for (let h = 0; h < ds.hours; h += 3) acc += sunFrac(ds, s, h);
  const appSun = acc / Math.ceil(ds.hours / 3);
  check(Math.abs(appSun - reg.siteSun) < 0.01, `${reg.id}: browser sunlight ${(appSun * 100).toFixed(1)}% = pipeline ${(reg.siteSun * 100).toFixed(1)}%`);
  const ev = evaluateSite(ds, s, 0, 14 * 24, defaultLander, defaultWeights);
  check(ev.overall >= 0 && ev.overall <= 100, `${reg.id}: site score ${ev.overall.toFixed(0)}/100, risk ${ev.risk}`);
  const t = ds.meta.targets[0];
  if (!t) { out.push({ region: reg.id, targets: 0 }); console.log(`INFO  ${reg.id}: no PSR target large enough — traverse skipped`); continue; }
  const goal = idx(ds, t.edgeCell[0], t.edgeCell[1]);
  const rows = [];
  for (const dep of [0, 24 * 7, 24 * 14, 24 * 21]) {
    const t0 = Date.now(); const r = planTraverse(ds, [s, goal, s], dep, defaultRover); const ms = Date.now() - t0;
    rows.push({ departDay: dep / 24, shortestOk: r.shortest.ok, sunAwareOk: r.sunAware.ok, sunAwareH: +r.sunAware.durationH.toFixed(1), waitH: +r.sunAware.waitH.toFixed(1),
      minBatt: +r.sunAware.minBatteryPct.toFixed(0), lengthKm: +(r.sunAware.lengthM / 1000).toFixed(2), ms, reason: r.sunAware.reason ?? r.shortest.reason });
    if (r.sunAware.ok) {
      const st = r.sunAware.steps;
      let monotonic = true; for (let k = 1; k < st.length; k++) if (st[k].t < st[k - 1].t) monotonic = false;
      check(monotonic && st[0].cell === s && st[st.length - 1].cell === s, `${reg.id} day ${dep / 24}: sun-aware route returns to the site, time only moves forward`);
      check(r.sunAware.minBatteryPct >= defaultRover.reservePct - 0.5, `${reg.id} day ${dep / 24}: battery never below the ${defaultRover.reservePct}% reserve (min ${r.sunAware.minBatteryPct.toFixed(0)}%)`);
      check(st.every(x => ds.slope[x.cell] <= defaultRover.maxSlope), `${reg.id} day ${dep / 24}: every route cell is within the ${defaultRover.maxSlope}° slope limit`);
    }
  }
  console.table(rows);
  out.push({ region: reg.id, target: t.id, rows });
}
writeFileSync(new URL('../tests/planner_real_results.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
