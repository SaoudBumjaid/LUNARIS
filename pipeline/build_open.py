"""
Build REAL LUNARIS datasets from open NASA-derived data that ship with this repository.

    python build_open.py                     # all six south-pole regions
    python build_open.py --site malapert     # one region

Why this builder exists: the original builder (build_real.py) needs the NAIF kernels and a 110 MB
LOLA DEM downloaded from NASA servers. This one runs fully offline from open, permissively
licensed derivatives of the same NASA data, and computes the Sun/Earth geometry itself.

Inputs (see pipeline/data/third_party/*/LICENSE and docs/DATA_SOURCES.md):
  * Near-field terrain: NASA LRO LOLA south-pole DEMs (Barker et al. 2023, NASA GSFC PGDA, 5-10 m),
    resampled by the open-source LUNAR//OPS project (Apache-2.0) to 8 x 8 km patches, 20 m grid,
    on a local east/north grid centred on each site.
  * Far-field terrain: NASA LRO LOLA LDEM_80S_80M (+ LDEM_75S_120M ring), 400 m block means,
    from the open-source Lunar Horizon project (MIT).
  * Sun / Earth: computed by LUNARIS (lunaris/ephem.py) from JPL DE421 + the IAU 2009 lunar rotation
    model, validated against JPL Horizons (validate_ephemeris.py: max error 0.003 deg).

What LUNARIS computes: horizons (near ray-marching + far great-circle scan), sunlight and Earth
visibility, permanent-shadow (PSR) mask, slope and roughness, candidate landing sites and PSR targets.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import math
from pathlib import Path

import numpy as np
from scipy import ndimage

from lunaris import core
from lunaris.ephem import SOURCE as EPHEM_SOURCE, body_vectors, topo_azel

HERE = Path(__file__).resolve().parent
TP = HERE / "data" / "third_party"
R = core.R_MOON
PATCH_STEP = 20.0
PATCH_N = 401
SCALE = 0.25


def load_far_dem():
    meta = json.loads((TP / "lunar_horizon" / "map.json").read_text())["dem"]
    n, px, half = meta["size"], meta["pxM"], meta["halfWidthM"]
    raw = gzip.open(TP / "lunar_horizon" / "dem_400m.bin.gz").read()
    a = np.frombuffer(raw, np.uint8)
    r = (a[:n * n].astype(np.uint16) | (a[n * n:].astype(np.uint16) << 8)).view(np.int16).reshape(n, n)
    z = np.cumsum(np.cumsum(r.astype(np.int64), 0), 1).astype(np.int16).astype(np.float32)
    return z, px, half


def site_basis(lat, lon):
    la, lo = math.radians(lat), math.radians(lon)
    u = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    e = np.cross([0, 0, 1.0], u); e /= np.linalg.norm(e)
    n = np.cross(u, e)
    return e, n, u


def unit_to_stereo(p):
    k = 2.0 * R / (1.0 - p[..., 2])
    return k * p[..., 1], k * p[..., 0]          # x (toward 90E), y (toward lon 0)


def far_horizon(z, px, half, lat, lon, h_obs, start=4000.0, stop=300e3, naz=core.NAZ):
    """Great-circle horizon scan on the 400 m DEM from (lat, lon) at absolute height h_obs."""
    e, n, u = site_basis(lat, lon)
    d = [start]
    while d[-1] < stop:
        d.append(d[-1] + max(px * 0.5, d[-1] * 0.01))
    d = np.array(d)
    g = d / R
    out, dist = np.full(naz, -10.0), np.full(naz, start)
    for b in range(naz):
        az = math.radians(b * 360.0 / naz)
        dirv = math.cos(az) * n + math.sin(az) * e
        p = np.cos(g)[:, None] * u + np.sin(g)[:, None] * dirv
        x, y = unit_to_stereo(p)
        col = (x + half) / px - 0.5
        row = (half - y) / px - 0.5
        hz = ndimage.map_coordinates(z, [row, col], order=1, mode="nearest")
        rr = R + hz
        ang = np.degrees(np.arctan2(rr * np.cos(g) - (R + h_obs), rr * np.sin(g)))
        k = int(np.argmax(ang))
        out[b], dist[b] = ang[k], d[k]
    return out, dist


def load_patch(site):
    q = np.frombuffer(gzip.open(TP / "lunar_ops" / f"terrain_{site['id']}.bin.gz").read(), "<i2")
    up = q.reshape(PATCH_N, PATCH_N).astype(np.float64) * SCALE
    ax = (np.arange(PATCH_N) - (PATCH_N - 1) / 2) * PATCH_STEP
    E, N = np.meshgrid(ax, ax[::-1])
    g = np.hypot(E, N) / R
    h0 = site["h_site_m"]
    return (up + R + h0) / np.cos(g) - R          # absolute height above the 1737.4 km sphere


def point_horizon(Ep, cell, r0, c0, h_obs_rel, naz=1440):
    """High-resolution horizon (deg) from one point of the 20 m patch (near field only)."""
    out = np.full(naz, -90.0)
    H, W = Ep.shape
    z0 = Ep[int(r0), int(c0)] + h_obs_rel
    ks = np.arange(1.0, 4000 / cell, 0.5)
    for b in range(naz):
        a = math.radians(b * 360.0 / naz)
        rr, cc = r0 - math.cos(a) * ks, c0 + math.sin(a) * ks
        ok = (rr >= 0) & (cc >= 0) & (rr <= H - 1) & (cc <= W - 1)
        z = ndimage.map_coordinates(Ep, [rr[ok], cc[ok]], order=1)
        dd = ks[ok] * cell
        out[b] = np.degrees(np.arctan((z - z0 - dd * dd / (2 * R)) / dd)).max()
    return out


SHORT = {"connecting-ridge-roi4": "Connecting Ridge", "im2-athena": "IM-2 Athena (CLPS landing site)",
         "malapert": "Malapert Massif", "nobile-rim-1": "Nobile Rim 1", "nobile-rim-2": "Nobile Rim 2", "haworth": "Haworth"}


def build(site, z400, px, half, args, out_root):
    sid = site["id"]
    site = dict(site, name=SHORT.get(sid, site["name"]), long_name=site["name"])
    print(f"\n=== {sid}: {site['name']}")
    Ep = load_patch(site)
    # 20 m slope/roughness, then 2x2 blocks -> 40 m grid (max for hazards, mean for heights)
    s20 = core.slope_deg(Ep, PATCH_STEP)
    r20 = core.roughness(Ep, PATCH_STEP)
    blk = lambda a, f: f(a[:400, :400].reshape(200, 2, 200, 2), axis=(1, 3))
    E = blk(Ep, np.mean).astype(np.float32)
    slope = blk(s20, np.max).astype(np.float32)
    rough = blk(r20, np.max).astype(np.float32)
    cell, N = 40.0, 200
    x0, y0 = -4010.0, 4010.0
    h_center = float(Ep[200, 200])
    print(f"  terrain {E.min():.0f}..{E.max():.0f} m, site {h_center:.0f} m, slope p50 {np.median(slope):.1f} deg")

    far, far_d = far_horizon(z400, px, half, site["lat"], site["lon"], h_center + args.h0)
    print("  far horizon (deg) every 45 deg:", np.round(far[::9], 2))
    hz = core.horizon_masks(E, cell, h0=args.h0)
    hz = core.merge_far_horizon(hz, far, far_d, E, h_center)

    t, sun, earth = body_vectors(args.start, args.days * 24)
    sun_az, sun_el = topo_azel(sun, site["lat"], site["lon"], h_center)
    earth_az, earth_el = topo_azel(earth, site["lat"], site["lon"], h_center)
    r_idx, c_idx = np.mgrid[0:N, 0:N]
    dx = (x0 + (c_idx + 0.5) * cell).ravel()
    dy = (y0 - (r_idx + 0.5) * cell).ravel()
    hzf = hz.reshape(-1, core.NAZ)
    sun_f, earth_f = core.annual_stats(hzf, (dx, dy), sun_az, sun_el, earth_az, earth_el, stride=3)
    psr = core.psr_mask(hzf, (dx, dy), sun_az, sun_el).reshape(N, N)
    targets = core.science_targets(psr, cell, slope, sun_f.reshape(N, N))
    auto = core.suggest_sites(slope, sun_f.reshape(N, N), earth_f.reshape(N, N), psr, cell)
    named = {"id": sid, "name": site["name"], "cell": [100, 100],
             "origin": f"{site['long_name']}: published coordinates ({site['lat']:.4f}, {site['lon']:.4f}) — {site.get('source', '')}"}
    sites = [named] + auto
    print(f"  Sun {sun_f.mean():.1%} avg, Earth {earth_f.mean():.1%} avg, PSR {psr.mean():.1%} of area, {len(targets)} PSR targets")

    ephem = {"t0": args.start + ":00:00Z", "stepHours": 1,
             "sunAz": np.round(sun_az, 4).tolist(), "sunEl": np.round(sun_el, 4).tolist(),
             "earthAz": np.round(earth_az, 4).tolist(), "earthEl": np.round(earth_el, 4).tolist(),
             "source": EPHEM_SOURCE}
    today = dt.date.today().isoformat()
    out = out_root / sid
    core.export(out, E=E, cell=cell, x0=x0, y0=y0, hz=hz, slope=slope, rough=rough,
                sun=sun_f, earth=earth_f, psr2d=psr, ephem=ephem, sites=sites, targets=targets,
                meta_extra={
                    "mode": "real", "regionId": sid,
                    "projection": f"local east/north grid centred on {site['lat']:.5f}, {site['lon']:.5f} (great-circle offsets, metres)",
                    "grid": "enu",
                    "regionName": f"{site['name']} — 8 × 8 km around {abs(site['lat']):.3f}°S, {site['lon']:.2f}°E",
                    "center": {"x": 0.0, "y": 0.0, "lat": site["lat"], "lon": site["lon"]},
                    "observerHeightM": args.h0,
                    "provenance": [
                        {"item": "Terrain (near field, 8 km)", "source": "NASA LRO LOLA south-pole DEMs (Barker et al. 2023, NASA GSFC PGDA) via LUNAR//OPS local patches (Apache-2.0)",
                         "resolution": "20 m patch; slope at 20 m; analysis grid 40 m", "date": "LOLA 2009–2023, patches Oct 2026", "real": True},
                        {"item": "Terrain (far field to 300 km)", "source": "NASA LRO LOLA LDEM_80S_80M + LDEM_75S_120M, 400 m means, via Lunar Horizon (MIT)",
                         "resolution": "400 m", "date": "PDS release", "real": True},
                        {"item": "Sun / Earth directions", "source": EPHEM_SOURCE + " — checked against JPL Horizons, max error 0.003°",
                         "resolution": "1 h", "date": f"{args.start} + {args.days} d", "real": True},
                        {"item": "Horizons, sunlight, Earth view, PSR, slope, routes", "source": "Computed by LUNARIS", "resolution": "40 m, 5° azimuth bins",
                         "date": today, "real": False},
                    ],
                    "warnings": [
                        "Terrain smaller than ~40 m (including boulders) is not resolved. Slope is the maximum of 20 m slopes in each 40 m cell.",
                        "Earth visibility is geometric line-of-sight only — not a radio link prediction (no DSN schedule).",
                        "PSRs are computed for one year of geometry only; they are potential cold traps, not confirmed ice.",
                        "Planning prototype — not flight software, not NASA-endorsed.",
                    ],
                })
    return {"id": sid, "name": site["name"], "lat": site["lat"], "lon": site["lon"],
            "sunAvg": round(float(sun_f.mean()), 3), "earthAvg": round(float(earth_f.mean()), 3),
            "siteSun": round(float(sun_f.reshape(N, N)[100, 100]), 3), "siteEarth": round(float(earth_f.reshape(N, N)[100, 100]), 3),
            "psrPct": round(float(psr.mean()) * 100, 1), "targets": len(targets)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site")
    ap.add_argument("--start", default="2027-01-01T00")
    ap.add_argument("--days", type=int, default=365)
    ap.add_argument("--h0", type=float, default=2.0)
    ap.add_argument("--out", default=str(HERE.parent / "web" / "public" / "data"))
    args = ap.parse_args()
    sites = json.loads((TP / "lunar_ops" / "sites.json").read_text())["sites"]
    if args.site:
        sites = [s for s in sites if s["id"] == args.site]
    z, px, half = load_far_dem()
    out_root = Path(args.out)
    regions = [build(s, z, px, half, args, out_root) for s in sites]
    idx_p = out_root / "regions.json"
    old = json.loads(idx_p.read_text()) if idx_p.exists() and args.site else {"regions": []}
    keep = [r for r in old.get("regions", []) if r["id"] not in {x["id"] for x in regions}]
    idx_p.write_text(json.dumps({"generated": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
                                 "regions": keep + regions}, indent=2))
    print("\nregions.json written:", [r["id"] for r in keep + regions])


if __name__ == "__main__":
    main()
