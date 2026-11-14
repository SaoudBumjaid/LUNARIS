"""
Download the REAL NASA datasets used by build_real.py into pipeline/data/raw/.

  * NAIF SPICE generic kernels (JPL):  leapseconds, DE440s planetary SPK,
    DE440 lunar orientation PCK + lunar frame kernel (defines MOON_ME).
  * LRO LOLA polar DEM (MIT/GSFC PDS mirror): LDEM_875S_20M (87.5S–pole, 20 m/px, ~110 MB IMG + LBL)

Usage:
    python fetch_data.py                 # kernels + default DEM
    python fetch_data.py --dem 85S_20M   # bigger coverage (85S–pole, ~440 MB)
    python fetch_data.py --skip-dem      # if you place your own GeoTIFF in data/raw/

If a URL has moved, download the file manually (see README) and put it in data/raw/.
"""
import argparse
import sys
from pathlib import Path

import requests

RAW = Path(__file__).resolve().parent / "data" / "raw"
NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
KERNELS = [
    ("naif0012.tls", [NAIF + "lsk/naif0012.tls"]),
    ("de440s.bsp", [NAIF + "spk/planets/de440s.bsp"]),
    ("moon_pa_de440_200625.bpc", [NAIF + "pck/moon_pa_de440_200625.bpc"]),
    ("moon_de440.tf", [NAIF + "fk/satellites/moon_de440_250416.tf",
                       NAIF + "fk/satellites/a_old_versions/moon_de440_220930.tf"]),
    ("pck00011.tpc", [NAIF + "pck/pck00011.tpc"]),
]
DEM_BASE = "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/"


def get(name, urls):
    dest = RAW / name
    if dest.exists() and dest.stat().st_size > 0:
        print(f"✓ {name} (cached)")
        return True
    for url in urls:
        try:
            print(f"↓ {url}")
            with requests.get(url, stream=True, timeout=60) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0))
                done = 0
                tmp = dest.with_suffix(dest.suffix + ".part")
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk); done += len(chunk)
                        if total:
                            print(f"   {done / 1e6:7.1f} / {total / 1e6:.1f} MB", end="\r")
                tmp.rename(dest)
                print(f"\n✓ {name}")
                return True
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ failed: {e}")
    print(f"!! Could not download {name}. Download it manually into {RAW}")
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem", default="875S_20M", help="LOLA polar product suffix, e.g. 875S_20M, 85S_20M, 875S_10M")
    ap.add_argument("--skip-dem", action="store_true")
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    ok = all(get(n, u) for n, u in KERNELS)
    if not a.skip_dem:
        stem = f"LDEM_{a.dem}"
        for ext in (".LBL", ".IMG"):
            ok &= get(stem + ext, [DEM_BASE + stem + ext, DEM_BASE + stem.lower() + ext.lower()])
    print("\nAll files ready." if ok else "\nSome files are missing — see messages above.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
