"""
Build the DEMO dataset: SYNTHETIC terrain + ANALYTIC (approximate) Sun/Earth ephemeris.

Everything produced here is clearly flagged  "mode": "demo"  and the web app shows a
DEMO banner. It exists so the app runs out of the box; run build_real.py to replace it
with NASA LOLA terrain and NAIF SPICE ephemerides.

    python build_demo.py [--out ../web/public/data]
"""
import argparse
import datetime as dt
import math
from pathlib import Path

import numpy as np
from scipy import ndimage

from lunaris import core

ap = argparse.ArgumentParser()
ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "web" / "public" / "data"))
ap.add_argument("--size", type=int, default=200)
ap.add_argument("--cell", type=float, default=50.0)
ap.add_argument("--seed", type=int, default=7)
args = ap.parse_args()

rng = np.random.default_rng(args.seed)
N, cell = args.size, args.cell
L = N * cell

# ----------------------------------------------------------------- synthetic terrain
yy, xx = np.mgrid[0:N, 0:N] * cell


def crater(E, cx, cy, D, depth=None, rim=None):
    r = np.hypot(xx - cx, yy - cy) / (D / 2)
    depth = depth if depth is not None else 0.2 * D
    rim = rim if rim is not None else 0.04 * D
    bowl = np.where(r < 1, -depth * (1 - r ** 2), 0)
    rim_p = rim * np.exp(-((r - 1) / 0.25) ** 2)
    ejecta = np.where(r > 1, rim * 0.6 * np.maximum(r, 1) ** -3, 0)
    E += bowl + rim_p + ejecta


def fractal(n, beta=2.3):
    k = np.fft.fftfreq(n)[:, None] ** 2 + np.fft.fftfreq(n)[None, :] ** 2
    k[0, 0] = 1
    spec = (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n))) / k ** (beta / 2)
    f = np.real(np.fft.ifft2(spec))
    return (f - f.mean()) / f.std()


E = np.zeros((N, N))
E += 0.006 * (xx - L / 2) - 0.008 * (yy - L / 2)                         # regional tilt
E += 650 * np.exp(-(((xx - 0.35 * L) * 0.8 + (yy - 0.5 * L) * 0.6) / (0.22 * L)) ** 2)  # ridge
crater(E, 1.10 * L, 0.10 * L, 0.9 * L, depth=1500, rim=120)           # big crater off the NE corner
crater(E, 0.72 * L, 0.70 * L, 2600, depth=380, rim=80)
crater(E, 0.20 * L, 0.18 * L, 1800, depth=240, rim=50)
for _ in range(110):                                                   # small craters (power law)
    D = 120 * (1 - rng.random()) ** -0.9
    D = min(D, 1400)
    crater(E, rng.random() * L, rng.random() * L, D, depth=0.065 * D, rim=0.018 * D)
E += 7 * fractal(N) + 1 * fractal(N, 1.6)
E = ndimage.gaussian_filter(E, 0.9)
E = E.astype(np.float32)

# Nominal placement (synthetic terrain, nominal location ~44 km from the pole)
xc, yc = -25000.0, -36000.0
x0, y0 = xc - L / 2, yc + L / 2
lat_c, lon_c = core.xy_to_latlon(xc, yc)

# ----------------------------------------------------------------- analytic ephemeris (approximate!)
t0 = dt.datetime(2027, 1, 1, tzinfo=dt.timezone.utc)
hours = 365 * 24
t = np.arange(hours) / 24.0                       # days
sub_sun_lon = -360.0 * t / 29.530589              # synodic month
sub_sun_lat = -1.54 * np.sin(2 * np.pi * t / 346.62)   # southern summer first
sub_e_lon = 7.9 * np.sin(2 * np.pi * t / 27.5546)  # optical libration (approx)
sub_e_lat = 6.7 * np.sin(2 * np.pi * t / 27.2122)

ex, ey, up, p0 = core.grid_basis(xc, yc)


def dirvec(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], 1)


sun_vec = dirvec(sub_sun_lat, sub_sun_lon) * 1.496e11 - p0
earth_vec = dirvec(sub_e_lat, sub_e_lon) * 3.844e8 - p0
sun_az, sun_el = core.body_dir_to_azel(sun_vec, ex, ey, up)
earth_az, earth_el = core.body_dir_to_azel(earth_vec, ex, ey, up)

# ----------------------------------------------------------------- analysis
print("Computing horizons (demo)…")
hz = core.horizon_masks(E, cell, h0=2.0)
far = 0.35 + 0.3 * np.sin(np.radians(np.arange(core.NAZ) * 5) * 2 + 1) + 0.15 * rng.random(core.NAZ)
hz = core.merge_far_horizon(hz, far, np.full(core.NAZ, 30000.0), E, float(np.median(E)))  # synthetic distant horizon
hzf = hz.reshape(-1, core.NAZ)
r_idx, c_idx = np.mgrid[0:N, 0:N]
dx = (x0 + (c_idx + 0.5) * cell - xc).ravel()
dy = (y0 - (r_idx + 0.5) * cell - yc).ravel()

slope = core.slope_deg(E, cell)
rough = core.roughness(E, cell)
print("Annual illumination…")
sun, earth = core.annual_stats(hzf, (dx, dy), sun_az, sun_el, earth_az, earth_el, stride=6)
psr = core.psr_mask(hzf, (dx, dy), sun_az, sun_el).reshape(N, N)
targets = core.science_targets(psr, cell, slope, sun.reshape(psr.shape))
sites = core.suggest_sites(slope, sun.reshape(N, N), earth.reshape(N, N), psr, cell)

ephem = {"t0": t0.isoformat(), "stepHours": 1,
         "sunAz": np.round(sun_az, 3).tolist(), "sunEl": np.round(sun_el, 3).tolist(),
         "earthAz": np.round(earth_az, 3).tolist(), "earthEl": np.round(earth_el, 3).tolist(),
         "source": "ANALYTIC APPROXIMATION (demo) — not SPICE"}

core.export(Path(args.out), E=E, cell=cell, x0=x0, y0=y0, hz=hz, slope=slope, rough=rough,
            sun=sun, earth=earth, psr2d=psr, ephem=ephem, sites=sites, targets=targets,
            meta_extra={
                "mode": "demo",
                "regionName": "DEMO region (synthetic terrain)",
                "center": {"x": xc, "y": yc, "lat": float(lat_c), "lon": float(lon_c)},
                "observerHeightM": 2.0,
                "provenance": [
                    {"item": "Terrain", "source": "SYNTHETIC procedural craters + fractal noise (seed %d)" % args.seed,
                     "resolution": f"{cell} m", "date": dt.date.today().isoformat(), "real": False},
                    {"item": "Sun / Earth ephemeris", "source": "Analytic approximation (synodic month, libration terms)",
                     "resolution": "1 h", "date": "n/a", "real": False},
                    {"item": "Distant horizon", "source": "Synthetic profile", "resolution": "5 deg", "date": "n/a", "real": False},
                ],
                "warnings": ["DEMO DATA: terrain and ephemeris are synthetic. Values are illustrative only and are NOT measurements. Run pipeline/build_real.py to use NASA LOLA + SPICE."],
            })
print(f"PSR cells: {int(psr.sum())}, targets: {len(targets)}, sites: {[s['cell'] for s in sites]}")
print(f"Mean sunlit fraction: {sun.mean():.3f}; mean Earth visibility: {earth.mean():.3f}")
