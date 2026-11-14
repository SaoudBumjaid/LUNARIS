"""
Build a REAL dataset from NASA LRO LOLA terrain + NAIF SPICE ephemerides.

    python fetch_data.py
    python build_real.py                                   # 16 km box centred on the south pole
    python build_real.py --lat -89.45 --lon -137 --size-km 12 --cell 30
    python build_real.py --sites sites.json               # add your own candidate sites

Output replaces ../web/public/data (the web app then shows "REAL DATA" instead of DEMO).

What is real vs. modelled:
  * Terrain heights: LOLA DEM (measured, interpolated by the product team).
  * Sun / Earth directions: SPICE DE440, MOON_ME frame, light-time + stellar aberration.
  * Horizons, illumination, Earth visibility, PSR mask, slope: COMPUTED by LUNARIS from the above.
  * Earth visibility is GEOMETRIC (Earth centre above terrain). No DSN scheduling or link budget.
"""
import argparse
import datetime as dt
import glob
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy import ndimage
import spiceypy as sp

from lunaris import core

HERE = Path(__file__).resolve().parent
RAW = HERE / "data" / "raw"
DST_CRS = CRS.from_proj4("+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs")

ap = argparse.ArgumentParser()
ap.add_argument("--dem", help="DEM path (.LBL/.IMG/.TIF). Default: first LDEM_* in data/raw")
ap.add_argument("--lat", type=float, default=-90.0)
ap.add_argument("--lon", type=float, default=0.0)
ap.add_argument("--size-km", type=float, default=16.0)
ap.add_argument("--cell", type=float, default=50.0)
ap.add_argument("--far-km", type=float, default=80.0, help="radius for distant-horizon scan")
ap.add_argument("--start", default="2027-01-01T00:00:00")
ap.add_argument("--days", type=int, default=365)
ap.add_argument("--h0", type=float, default=2.0, help="observer height above ground (m)")
ap.add_argument("--sites", help="JSON list of {name, lat, lon, source}")
ap.add_argument("--out", default=str(HERE.parent / "web" / "public" / "data"))
a = ap.parse_args()


def find_dem():
    if a.dem:
        return a.dem
    for pat in ("LDEM_*.LBL", "LDEM_*.lbl", "*.TIF", "*.tif", "LDEM_*.IMG"):
        hits = sorted(glob.glob(str(RAW / pat)))
        if hits:
            return hits[0]
    raise SystemExit("No DEM found in data/raw — run fetch_data.py or pass --dem")


def read_region(path, xc, yc, size_m, cell):
    n = int(round(size_m / cell))
    x0, y0 = xc - n * cell / 2, yc + n * cell / 2
    dst = np.full((n, n), np.nan, np.float32)
    with rasterio.open(path) as src:
        scale = src.scales[0] if src.scales else 1.0
        offset = src.offsets[0] if src.offsets else 0.0
        reproject(rasterio.band(src, 1), dst, src_crs=src.crs or DST_CRS, dst_crs=DST_CRS,
                  dst_transform=from_origin(x0, y0, cell, cell), dst_nodata=np.nan,
                  resampling=Resampling.bilinear)
        info = {"file": Path(path).name, "nativeRes": float(abs(src.res[0])), "crs": str(src.crs)}
    dst = dst * scale + offset
    med = np.nanmedian(dst)
    if med > 1e6:                     # stored as radius
        dst -= core.R_MOON
    return dst, x0, y0, info


def fill_nan(E):
    m = np.isnan(E)
    if m.all():
        raise SystemExit("Region is outside the DEM coverage.")
    if m.any():
        idx = ndimage.distance_transform_edt(m, return_distances=False, return_indices=True)
        E = E[tuple(idx)]
    return E, float(m.mean())


xc, yc = (float(v) for v in core.latlon_to_xy(a.lat, a.lon))
size_m = a.size_km * 1000
dem_path = find_dem()
print(f"DEM: {dem_path}")
E, x0, y0, dem_info = read_region(dem_path, xc, yc, size_m, a.cell)
E, nan_frac = fill_nan(E)
N = E.shape[0]
print(f"Region {N}x{N} @ {a.cell} m, height {E.min():.0f}..{E.max():.0f} m, gaps filled {nan_frac:.1%}")

# --- distant horizon from a coarse, larger window
far_cell = max(200.0, a.cell * 4)
Ef, fx0, fy0, _ = read_region(dem_path, xc, yc, a.far_km * 2000, far_cell)
nf = Ef.shape[0]
e_ref = float(E[N // 2, N // 2] + a.h0)
far, far_d = core.far_horizon_from_dem(Ef, far_cell, (nf - 1) / 2, (nf - 1) / 2, e_ref, start_dist=size_m * 0.7)
far = np.where(far < -9, -10.0, far)
print("Distant horizon (deg):", np.round(far[::9], 2))

# --- SPICE ephemeris
for k in ("naif0012.tls", "de440s.bsp", "moon_pa_de440_200625.bpc", "moon_de440.tf", "pck00011.tpc"):
    sp.furnsh(str(RAW / k))
et0 = sp.str2et(a.start)
hours = a.days * 24
ets = et0 + np.arange(hours) * 3600.0
ex, ey, up, p0 = core.grid_basis(xc, yc)
p0_km = p0 / 1000.0
sun = np.array(sp.spkpos("SUN", ets.tolist(), "MOON_ME", "LT+S", "MOON")[0]) - p0_km
earth = np.array(sp.spkpos("EARTH", ets.tolist(), "MOON_ME", "LT+S", "MOON")[0]) - p0_km
sun_az, sun_el = core.body_dir_to_azel(sun, ex, ey, up)
earth_az, earth_el = core.body_dir_to_azel(earth, ex, ey, up)
print(f"Sun el {sun_el.min():.2f}..{sun_el.max():.2f}°, Earth el {earth_el.min():.2f}..{earth_el.max():.2f}°")

# --- analysis
print("Computing horizons (this can take a few minutes)…")
hz = core.horizon_masks(E, a.cell, h0=a.h0)
hz = core.merge_far_horizon(hz, far, far_d, E, e_ref - a.h0)
hzf = hz.reshape(-1, core.NAZ)
r_idx, c_idx = np.mgrid[0:N, 0:N]
dx = (x0 + (c_idx + 0.5) * a.cell - xc).ravel()
dy = (y0 - (r_idx + 0.5) * a.cell - yc).ravel()
slope = core.slope_deg(E, a.cell)
rough = core.roughness(E, a.cell)
print("Annual statistics…")
sun_f, earth_f = core.annual_stats(hzf, (dx, dy), sun_az, sun_el, earth_az, earth_el, stride=6)
psr = core.psr_mask(hzf, (dx, dy), sun_az, sun_el).reshape(N, N)
targets = core.science_targets(psr, a.cell, slope, sun_f.reshape(psr.shape))
sites = core.suggest_sites(slope, sun_f.reshape(N, N), earth_f.reshape(N, N), psr, a.cell)

if a.sites:
    for s in json.load(open(a.sites, encoding="utf-8")):
        x, y = core.latlon_to_xy(s["lat"], s["lon"])
        c = int((x - x0) // a.cell); r = int((y0 - y) // a.cell)
        if 0 <= r < N and 0 <= c < N:
            sites.insert(0, {"id": s.get("id", s["name"]), "name": s["name"], "cell": [r, c],
                             "origin": s.get("source", "user-supplied coordinates")})
        else:
            print(f"!! site {s['name']} is outside the region — skipped")

lat_c, lon_c = core.xy_to_latlon(xc, yc)
ephem = {"t0": a.start + "Z", "stepHours": 1,
         "sunAz": np.round(sun_az, 4).tolist(), "sunEl": np.round(sun_el, 4).tolist(),
         "earthAz": np.round(earth_az, 4).tolist(), "earthEl": np.round(earth_el, 4).tolist(),
         "source": "NAIF SPICE: DE440s + moon_pa_de440_200625.bpc, frame MOON_ME, aberration LT+S"}
today = dt.date.today().isoformat()
core.export(Path(a.out), E=E, cell=a.cell, x0=x0, y0=y0, hz=hz, slope=slope, rough=rough,
            sun=sun_f, earth=earth_f, psr2d=psr, ephem=ephem, sites=sites, targets=targets,
            meta_extra={
                "mode": "real",
                "regionName": f"Lunar south polar region ({lat_c:.3f}°, {lon_c:.2f}°), {a.size_km:g} km box",
                "center": {"x": xc, "y": yc, "lat": float(lat_c), "lon": float(lon_c)},
                "observerHeightM": a.h0,
                "provenance": [
                    {"item": "Terrain", "source": f"LRO LOLA polar DEM {dem_info['file']} (NASA GSFC / MIT PDS GDR)",
                     "resolution": f"native {dem_info['nativeRes']:g} m, resampled to {a.cell:g} m",
                     "date": f"processed {today}", "real": True},
                    {"item": "Sun / Earth ephemeris", "source": ephem["source"], "resolution": "1 h",
                     "date": f"{a.start} + {a.days} d", "real": True},
                    {"item": "Distant horizon", "source": f"Same DEM, {far_cell:g} m, radius {a.far_km:g} km from centre",
                     "resolution": "5° azimuth bins", "date": today, "real": True},
                    {"item": "Illumination / Earth visibility / PSR / slope", "source": "Computed by LUNARIS (horizon ray-marching)",
                     "resolution": f"{a.cell:g} m", "date": today, "real": False},
                ],
                "warnings": [
                    f"Terrain smaller than ~{2 * a.cell:g} m (incl. boulders) is not resolved.",
                    f"DEM gaps filled by nearest neighbour: {nan_frac:.1%} of cells.",
                    "Earth visibility is geometric line-of-sight only — not a radio link prediction.",
                    "PSRs are computed for the ephemeris span only; they indicate potential cold traps, not confirmed ice.",
                ],
            })
