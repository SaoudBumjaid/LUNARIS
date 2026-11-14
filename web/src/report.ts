import type { Dataset } from './engine/dataset';
import { cellLatLon, fmtDate, fmtLatLon, hourToDate } from './engine/dataset';
import type { RouteResult } from './engine/planner';
import type { SiteEval } from './engine/sites';
import { CRITERIA } from './engine/sites';
import type { Mission } from './state';

const header = (ds: Dataset, title: string) => [
  `# LUNARIS — ${title}`, '',
  `Generated: ${new Date().toISOString()}  `,
  `Region: ${ds.meta.regionName}  `,
  `Data mode: **${ds.meta.mode === 'demo' ? 'DEMO (synthetic terrain + analytic ephemeris — illustrative only)' : 'REAL (NASA LRO LOLA terrain + JPL DE421 Sun/Earth, checked against JPL Horizons)'}**`, '',
  '> LUNARIS is a planning & education prototype. Scores are transparent heuristics, not an official landing-safety certification. Earth visibility is geometric line-of-sight, not a radio-link prediction.', '',
];

const provenance = (ds: Dataset) => ['## Data provenance', '', '| Item | Source | Resolution | Date | Measured? |', '|---|---|---|---|---|',
  ...ds.meta.provenance.map(p => `| ${p.item} | ${p.source} | ${p.resolution} | ${p.date} | ${p.real ? 'yes' : 'no (computed/synthetic)'} |`), '',
  ...ds.meta.warnings.map(w => `- ⚠ ${w}`), ''];

export function siteSection(ds: Dataset, name: string, e: SiteEval) {
  return [`### ${name} — overall ${e.overall.toFixed(1)}/100, risk ${e.risk}`, `Location: ${fmtLatLon(...cellLatLon(ds, e.cell))}`, '',
    '| Criterion | Score | Formula |', '|---|---|---|', ...CRITERIA.map(c => `| ${c.label} | ${e.scores[c.key].toFixed(1)} | ${c.formula} |`), '',
    ...e.explanation.map(x => `- ${x}`), ''];
}

export function routeSection(r: RouteResult) {
  return [`### ${r.name}: ${r.ok ? 'FEASIBLE' : 'INFEASIBLE'}`, r.reason ? `Reason: ${r.reason}` : '',
    `- Length ${(r.lengthM / 1000).toFixed(2)} km; duration ${r.durationH.toFixed(1)} h (driving ${r.driveH.toFixed(1)} h, waiting ${r.waitH.toFixed(1)} h)`,
    `- Driving in darkness ${r.darkDriveH.toFixed(1)} h; battery min ${r.minBatteryPct.toFixed(0)}%, end ${r.endBatteryPct.toFixed(0)}%`,
    `- Earth line-of-sight during traverse ${r.earthPct.toFixed(0)}%; max slope ${r.maxSlope.toFixed(1)}°`, ''];
}

export function routeReport(ds: Dataset, m: Mission, R: { shortest: RouteResult; sunAware: RouteResult }, blockedCells: number) {
  const p = m.rover;
  return [...header(ds, 'Rover traverse report'),
    `Departure: ${fmtDate(hourToDate(ds, m.startH))}  `, `Waypoints: ${m.waypoints.map(w => fmtLatLon(...cellLatLon(ds, w))).join(' → ')}  `,
    `Blocked cells: ${blockedCells}`, '', '## Rover assumptions', '',
    `Speed ${p.speedMps} m/s · max slope ${p.maxSlope}° · panel ${p.panelW} W · drive ${p.driveW} W · idle ${p.idleW} W · battery ${p.batteryWh} Wh · reserve ${p.reservePct}% · drive-only-with-DTE ${p.requireDTE}`, '',
    '## Results', '', ...routeSection(R.shortest), ...routeSection(R.sunAware),
    '## Method', '', '- Shortest path: A* on 8-connected grid, cost = distance × slope penalty; simulated without waiting.',
    '- Sun-aware path: weighted time-dependent A* over (cell, hour, battery-bucket) states; terrain-aware Sun visibility re-evaluated hourly from horizon masks; waiting allowed to recharge, for sunrise or for Earth contact.', '',
    ...provenance(ds)].join('\n');
}

export function whatIfReport(ds: Dataset, title: string, rows: [string, string, string, string][], notes: string[], sections: string[][]) {
  return [...header(ds, `What-If scenario: ${title}`), '## Before vs after', '', '| Indicator | Baseline | Scenario | Change |', '|---|---|---|---|',
    ...rows.map(r => `| ${r.join(' | ')} |`), '', '## Interpretation', '', ...notes.map(n => `- ${n}`), '', ...sections.flat(), ...provenance(ds)].join('\n');
}
