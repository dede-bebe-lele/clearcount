"""Fetch 2026 hotspots (Jan -> today) and VIIRS NOAA-21 (2023 ->) for Kazakhstan via the
FIRMS area API, then clip to the Kazakhstan border (geoBoundaries ADM0, CC BY 4.0).
Needs a free FIRMS MAP_KEY in clearcount/.env as  FIRMS_MAP_KEY=xxxxxxxx  (never committed).

Standard processing (SP) where available, near-real-time (NRT) after it, using the
date ranges FIRMS reports in /api/data_availability.
Writes files matching the yearly country files so 02_prepare.py picks them up:
  data/raw/{modis|viirs-snpp|viirs-jpss1}_2026_Kazakhstan.csv, viirs-jpss2_{2023..2026}_Kazakhstan.csv
"""
import datetime as dt
import io
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd
from common import STATIC, ROOT, RAW, WORK

BBOX = "46.4,40.5,87.4,55.6"
API = "https://firms.modaps.eosdis.nasa.gov/api"
FILES = {"MODIS": ("modis", 2026), "VIIRS_SNPP": ("viirs-snpp", 2026), "VIIRS_NOAA20": ("viirs-jpss1", 2026), "VIIRS_NOAA21": ("viirs-jpss2", 2023)}


def key():
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("FIRMS_MAP_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("FIRMS_MAP_KEY missing in clearcount/.env")


def get(url):
    for a in range(5):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                return r.read().decode()
        except Exception:
            time.sleep(5 * (a + 1))
    return ""


def kz_rings():
    g = json.loads((STATIC / "kaz_adm0.geojson").read_text())["features"][0]["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    return [np.array(p[0]) for p in polys]  # outer rings, (lon, lat)


def in_kz(lon, lat, rings):
    inside = np.zeros(len(lon), bool)
    for ring in rings:
        x1, y1 = ring[:, 0], ring[:, 1]; x2, y2 = np.roll(x1, -1), np.roll(y1, -1)
        box = (lon >= x1.min()) & (lon <= x1.max()) & (lat >= y1.min()) & (lat <= y1.max())
        if not box.any():
            continue
        lo, la = lon[box], lat[box]; ins = np.zeros(len(lo), bool)
        for a, b, c, d in zip(x1, y1, x2, y2):
            cond = (b > la) != (d > la)
            if cond.any():
                xi = (c - a) * (la - b) / ((d - b) if d != b else 1e-12) + a
                ins ^= cond & (lo < xi)
        inside[np.nonzero(box)[0]] = ins | inside[box]
    return inside


def main():
    k = key()
    avail = pd.read_csv(io.StringIO(get(f"{API}/data_availability/csv/{k}/all")))
    avail = avail.set_index("data_id")
    today = dt.date.today()
    rings = kz_rings()
    for sensor, (prefix, first_year) in FILES.items():
        jobs = []
        for kind in ("SP", "NRT"):
            sid = f"{sensor}_{kind}"
            if sid not in avail.index:
                continue
            a = max(dt.date.fromisoformat(avail.loc[sid, "min_date"]), dt.date(first_year, 1, 1))
            b = min(dt.date.fromisoformat(avail.loc[sid, "max_date"]), today)
            if kind == "NRT" and f"{sensor}_SP" in avail.index:
                a = max(a, dt.date.fromisoformat(avail.loc[f"{sensor}_SP", "max_date"]) + dt.timedelta(days=1))
            d = a
            while d <= b:
                n = min(5, (b - d).days + 1)
                jobs.append((sid, d, n)); d += dt.timedelta(days=n)
        def fetch(j):
            sid, d, n = j
            txt = get(f"{API}/area/csv/{k}/{sid}/{BBOX}/{n}/{d.isoformat()}")
            if not txt or txt.startswith("Invalid") or txt.count("\n") < 2:
                return None
            return pd.read_csv(io.StringIO(txt)).assign(_src=sid)
        with ThreadPoolExecutor(4) as ex:
            frames = [f for f in ex.map(fetch, jobs) if f is not None]
        if not frames:
            print(sensor, "no data"); continue
        df = pd.concat(frames, ignore_index=True).drop_duplicates()
        df = df[in_kz(df["longitude"].values, df["latitude"].values, rings)]
        if "type" not in df:
            df["type"] = np.nan
        df["type"] = df["type"].fillna(0).astype(int)  # NRT has no type field; persistence mask handles flares
        df["acq_date"] = pd.to_datetime(df["acq_date"])
        for y, g in df.groupby(df["acq_date"].dt.year):
            if y < first_year:
                continue
            g = g.assign(acq_date=g["acq_date"].dt.strftime("%Y-%m-%d"), acq_time=g["acq_time"].astype(int).astype(str).str.zfill(4))
            out = RAW / f"{prefix}_{y}_Kazakhstan.csv"
            g.drop(columns=["_src", "country_id"], errors="ignore").to_csv(out, index=False)
            print(f"saved {out.name}: {len(g):,} detections ({', '.join(sorted(g['_src'].unique()))}); {len(jobs)} API calls")


if __name__ == "__main__":
    main()
