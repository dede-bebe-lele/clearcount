"""Observation opportunities ("looks") from FIRMS satellite swath outlines.

FIRMS swath outlines (2026) are the Level-2 granule footprints stored in NASA CMR.
We query CMR (public, no login) for every MODIS/VIIRS active-fire granule over
Kazakhstan and count, for each 1-degree cell and day, how many swaths covered it
(day/night separately). Combined with daily cloud amount this gives 'clear looks':
how many real chances each satellite had to see a fire.

Outputs: data/work/looks_daily.pkl (lat, lon, date, sat, dn, looks)
         data/work/granules.pkl
"""
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd
from common import needs_fetch, WORK

PRODUCTS = {"Terra": ("MOD14", 2000), "Aqua": ("MYD14", 2002), "N": ("VNP14IMG", 2012), "N20": ("VJ114IMG", 2018), "N21": ("VJ214IMG", 2023)}
BBOX = "46,40,88,56"
CACHE = WORK / "cmr"
CACHE.mkdir(exist_ok=True)


def fetch_year(job):
    sat, (short, _), year = job
    f = CACHE / f"{short}_{year}.json"
    if not needs_fetch(f, year=year, min_size=2):
        return json.loads(f.read_text())
    out, after = [], None
    while True:
        url = (f"https://cmr.earthdata.nasa.gov/search/granules.json?short_name={short}&bounding_box={BBOX}"
               f"&temporal={year}-01-01T00:00:00Z,{year}-12-31T23:59:59Z&page_size=2000&sort_key=start_date")
        req = urllib.request.Request(url, headers={"User-Agent": "clearcount-student-project"})
        if after:
            req.add_header("CMR-Search-After", after)
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    after = r.headers.get("CMR-Search-After")
                    entries = json.loads(r.read())["feed"]["entry"]
                break
            except Exception:
                time.sleep(3 * (attempt + 1))
        else:
            raise RuntimeError(url)
        for e in entries:
            poly = e.get("polygons")
            if not poly:
                continue
            out.append([e["time_start"], e.get("day_night_flag", ""), poly[0][0]])
        if len(entries) < 2000 or not after:
            break
    f.write_text(json.dumps(out))
    return out


def points_in_poly(lat, lon, ring):
    """Vectorized ray casting; ring = [(lat, lon), ...]."""
    inside = np.zeros(lat.shape, bool)
    n = len(ring)
    for i in range(n):
        y1, x1 = ring[i]; y2, x2 = ring[(i + 1) % n]
        cond = ((y1 > lat) != (y2 > lat))
        xint = (x2 - x1) * (lat - y1) / ((y2 - y1) if y2 != y1 else 1e-12) + x1
        inside ^= cond & (lon < xint)
    return inside


def main():
    jobs = [(s, p, y) for s, p in PRODUCTS.items() for y in range(p[1], __import__('datetime').date.today().year + 1)]
    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(fetch_year, jobs))
    cells = pd.read_pickle(WORK / "blind_1deg.pkl")[["lat", "lon"]].drop_duplicates().sort_values(["lat", "lon"]).values
    clat, clon = cells[:, 0], cells[:, 1]
    sats = list(PRODUCTS)
    day0 = np.datetime64("2000-01-01")
    ndays = int((np.datetime64(f"{__import__('datetime').date.today().year + 1}-01-01") - day0).astype(int))
    L = np.zeros((len(sats), 2, ndays, len(cells)), dtype=np.uint8)   # sat, dn, day, cell
    ngran = 0
    for (sat, _, _), gran in zip(jobs, results):
        si = sats.index(sat)
        for t, dn, poly in gran:
            v = [float(x) for x in poly.split()]
            hit = points_in_poly(clat, clon, list(zip(v[0::2], v[1::2])))
            if not hit.any():
                continue
            ts = pd.Timestamp(t)
            hour = ts.hour + ts.minute / 60
            local = (hour + clon / 15) % 24                      # local solar time per cell
            night = ~((local >= 6) & (local < 18))
            # local calendar day (UTC+lon/15) so a fire day matches FIRMS acq_date roughly
            di = int((np.datetime64(ts.date()) - day0).astype(int))
            if 0 <= di < ndays:
                for d in (0, 1):
                    m = hit & (night == bool(d))
                    L[si, d, di, m] += 1
            ngran += 1
    np.savez_compressed(WORK / "looks.npz", L=L, lat=clat, lon=clon, sats=np.array(sats), day0=str(day0))
    tot = L.reshape(len(sats), 2, ndays, -1)
    for si, s_ in enumerate(sats):
        obs = tot[si].sum(0)
        on = obs[obs > 0]
        print(f"{s_:6s} cell-days observed: {len(on):,}  mean looks/day when observed: {on.mean():.2f}")
    print("granules used:", ngran)


if __name__ == "__main__":
    main()
