"""Extra datasets for the LUNARIS web app (offline, from bundled open data).

1. data/polemap/: shaded-relief map of the south pole from the LOLA 400 m DEM (Lunar Horizon map.json grid),
   in polar stereographic metres, with the parameters the app needs to convert pixels <-> lat/lon.
2. data/dsn.json: for every hour of the analysis year, whether the Moon is at least 10 deg above the local
   horizon at each NASA Deep Space Network complex (Goldstone, Madrid, Canberra). Geometry only: this is
   NOT a DSN antenna schedule.
"""
import base64, json, math
from pathlib import Path
import numpy as np
from PIL import Image
from build_open import load_far_dem, R
from skyfield.api import wgs84
from lunaris import ephem

OUT = Path(__file__).resolve().parents[1] / "web" / "public" / "data"
T0, HOURS = "2027-01-01T00", 365 * 24

def polemap(half_km=200.0):
    z, px, half = load_far_dem()
    n = z.shape[0]
    c = n / 2.0                          # pole at grid centre
    k = int(round(half_km * 1000 / px))
    r0, r1 = int(c - k), int(c + k)
    sub = z[r0:r1, r0:r1]
    dy, dx = np.gradient(sub, px)
    az, alt = math.radians(315), math.radians(15)
    slope = np.arctan(np.hypot(dx, dy)); aspect = np.arctan2(-dx, dy)
    hs = np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)
    g = (30 + hs ** 0.9 * 215).astype(np.uint8)
    rgb = np.stack([g * 0.88, g * 0.93, g * 1.0], -1).clip(0, 255).astype(np.uint8)
    d = OUT / "polemap"; d.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb).save(d / "pole_hillshade.jpg", quality=86)
    # x/y of the image's top-left pixel corner (metres, polar stereographic, x toward 90E, y toward 0E)
    meta = {"size": int(r1 - r0), "pxM": px, "xLeftM": -half + r0 * px, "yTopM": half - r0 * px, "R": R,
            "projection": "polar stereographic (true scale at the pole), x toward 90E, y toward 0E",
            "source": "NASA LRO LOLA 400 m south-pole DEM (via Lunar Horizon map.json, MIT); shaded relief by LUNARIS (sun from upper left, 15 deg)",
            "elevMinM": float(sub.min()), "elevMaxM": float(sub.max())}
    (d / "polemap.json").write_text(json.dumps(meta, indent=1))
    print("polemap", meta["size"], "px")

STATIONS = [("Goldstone (DSS-14 area)", 35.4259, -116.8895, 1000), ("Madrid (DSS-63 area)", 40.4313, -4.2480, 865),
            ("Canberra (DSS-43 area)", -35.4024, 148.9813, 690)]

def dsn(min_el=10.0):
    ts = ephem.TS
    hrs = np.arange(HOURS)
    t = ts.utc(2027, 1, 1, hrs)
    earth, moon = ephem.EPH["earth"], ephem.EPH["moon"]
    out = []
    for name, lat, lon, h in STATIONS:
        st = earth + wgs84.latlon(lat, lon, elevation_m=h)
        alt, _, _ = st.at(t).observe(moon).apparent().altaz()
        up = alt.degrees >= min_el
        out.append({"name": name, "lat": lat, "lon": lon, "pct": round(float(up.mean() * 100), 1),
                    "bits": base64.b64encode(np.packbits(up).tobytes()).decode()})
        print(name, round(float(up.mean() * 100), 1), "% of hours Moon >=", min_el, "deg")
    anyup = np.zeros(HOURS, bool)
    for s in out:
        anyup |= np.unpackbits(np.frombuffer(base64.b64decode(s["bits"]), np.uint8))[:HOURS].astype(bool)
    print("any complex:", round(float(anyup.mean() * 100), 1), "%")
    (OUT / "dsn.json").write_text(json.dumps({"t0": "2027-01-01T00:00:00Z", "stepHours": 1, "hours": HOURS, "minElDeg": min_el,
        "anyPct": round(float(anyup.mean() * 100), 1), "stations": out,
        "method": "Skyfield + JPL DE421: apparent Moon elevation at each DSN complex (WGS84 position), hourly. Station coordinates are approximate complex locations.",
        "caveat": "Geometric only. Real contact also needs a free DSN antenna, scheduling and a working radio link; none of that is modelled."}))

if __name__ == "__main__":
    polemap(); dsn()
