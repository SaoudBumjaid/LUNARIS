"""Sun and Earth directions in the Moon's body-fixed frame, computed by LUNARIS.

Inputs (all NASA/JPL or IAU, no network needed at run time):
  * JPL planetary ephemeris DE421 (de421.bsp, shipped in the `skyfield-data` package), read with Skyfield.
  * Lunar orientation: IAU WGCCRE 2009 rotation model for the Moon (Archinal et al. 2011,
    Celest. Mech. Dyn. Astr. 109:101-135, Table 2), which approximates the mean-Earth/polar-axis
    (ME) frame used by LOLA.

Positions are astrometric + aberration as seen from the Moon's centre ("apparent", like SPICE LT+S),
then shifted to the surface observer (parallax matters for the Earth: up to ~0.3 deg).
Checked against JPL Horizons (DE441, MEAN_ME) in pipeline/validate_ephemeris.py.
"""
from __future__ import annotations

import numpy as np
from skyfield.api import Loader
from skyfield_data import get_skyfield_data_path

_load = Loader(get_skyfield_data_path(), expire=False)
TS = _load.timescale(builtin=True)
EPH = _load("de421.bsp")
SOURCE = ("JPL DE421 (Skyfield) + IAU 2009 lunar rotation model (Archinal et al. 2011); "
          "apparent directions from the Moon, shifted to the surface observer")


def _moon_orientation(jd_tdb):
    d = jd_tdb - 2451545.0
    T = d / 36525.0
    E = np.radians(np.array([
        125.045 - 0.0529921 * d, 250.089 - 0.1059842 * d, 260.008 + 13.0120009 * d,
        176.625 + 13.3407154 * d, 357.529 + 0.9856003 * d, 311.589 + 26.4057084 * d,
        134.963 + 13.0649930 * d, 276.617 + 0.3287146 * d, 34.226 + 1.7484877 * d,
        15.134 - 0.1589763 * d, 119.743 + 0.0036096 * d, 239.961 + 0.1643573 * d,
        25.053 + 12.9590088 * d]))
    s, c = np.sin(E), np.cos(E)
    ra = (269.9949 + 0.0031 * T - 3.8787 * s[0] - 0.1204 * s[1] + 0.0700 * s[2] - 0.0172 * s[3]
          + 0.0072 * s[5] - 0.0052 * s[9] + 0.0043 * s[12])
    dec = (66.5392 + 0.0130 * T + 1.5419 * c[0] + 0.0239 * c[1] - 0.0278 * c[2] + 0.0068 * c[3]
           - 0.0029 * c[5] + 0.0009 * c[6] + 0.0008 * c[9] - 0.0009 * c[12])
    W = (38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.5610 * s[0] + 0.1208 * s[1] - 0.0642 * s[2]
         + 0.0158 * s[3] + 0.0252 * s[4] - 0.0066 * s[5] - 0.0047 * s[6] - 0.0046 * s[7] + 0.0028 * s[8]
         + 0.0052 * s[9] + 0.0040 * s[10] + 0.0019 * s[11] - 0.0044 * s[12])
    return np.radians(ra), np.radians(dec), np.radians(W)


def _rot_icrf_to_body(ra, dec, W):
    """Matrices (n,3,3): body = Rz(W) Rx(90-dec) Rz(90+ra) icrf."""
    def rz(a):
        c, s = np.cos(a), np.sin(a); z, o = np.zeros_like(a), np.ones_like(a)
        return np.stack([np.stack([c, s, z], -1), np.stack([-s, c, z], -1), np.stack([z, z, o], -1)], -2)

    def rx(a):
        c, s = np.cos(a), np.sin(a); z, o = np.zeros_like(a), np.ones_like(a)
        return np.stack([np.stack([o, z, z], -1), np.stack([z, c, s], -1), np.stack([z, -s, c], -1)], -2)
    return rz(W) @ rx(np.pi / 2 - dec) @ rz(np.pi / 2 + ra)


def body_vectors(utc_start: str, hours: int, step_h: float = 1.0):
    """Moon-centred apparent Sun and Earth vectors (km) in the Moon body-fixed frame, hourly."""
    y, mo, rest = utc_start.split("-", 2)
    dd, hh = rest[:2], int(rest[3:5]) if len(rest) > 3 else 0
    t = TS.utc(int(y), int(mo), int(dd), hh + np.arange(hours) * step_h)
    moon = EPH["moon"]
    out = {}
    rot = _rot_icrf_to_body(*_moon_orientation(t.tdb))
    for name, key in (("sun", "sun"), ("earth", "earth")):
        v = moon.at(t).observe(EPH[key]).apparent().position.km.T      # (n,3) ICRF
        out[name] = np.einsum("nij,nj->ni", rot, v)
    return t, out["sun"], out["earth"]


def topo_azel(vec_km, lat, lon, h_m=0.0, R_km=1737.4):
    """North-referenced azimuth (deg, clockwise from north) and elevation of body vectors seen from a site."""
    la, lo = np.radians(lat), np.radians(lon)
    up = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
    east = np.array([-np.sin(lo), np.cos(lo), 0.0])
    north = np.cross(up, east)
    p = up * (R_km + h_m / 1000.0)
    v = vec_km - p
    v = v / np.linalg.norm(v, axis=1, keepdims=True)
    el = np.degrees(np.arcsin(np.clip(v @ up, -1, 1)))
    az = (np.degrees(np.arctan2(v @ east, v @ north)) + 360) % 360
    return az, el
