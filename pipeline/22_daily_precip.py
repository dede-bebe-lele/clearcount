"""Daily precipitation (NASA POWER MERRA-2 PRECTOTCORR) on the 1-degree grid, for the blind-day model.
Based on the cloud fetcher: (v1, no login needed).

NASA POWER daily CLOUD_AMT from CERES SYN1deg (1 degree, MODIS + geostationary
cloud retrievals). A day is 'blind' when cloud amount >= BLIND_PCT.
Output: data/work/blind_1deg.pkl  (lat, lon, mi, days, blind_days, cloud_mean)

v2 (needs Earthdata login): replace with MxD14A1 / VNP14A1 FireMask classes
(4 = cloud, 5 = clear land) -> exact clear-sky observation counts per 1 km pixel.
"""
import io
import itertools
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import pandas as pd
from common import needs_fetch, WORK, month_index

BLIND_PCT = 70.0
LAT_BOXES = [(40, 50), (50, 56)]
LON_BOXES = [(46, 56), (56, 66), (66, 76), (76, 86), (86, 88)]
YEARS = range(2000, __import__('datetime').date.today().year + 1)
CACHE = WORK / "power_precip"
CACHE.mkdir(exist_ok=True)
URL = ("https://power.larc.nasa.gov/api/temporal/daily/regional?parameters=PRECTOTCORR"
       "&community=AG&latitude-min={a}&latitude-max={b}&longitude-min={c}&longitude-max={d}"
       "&start={y}0101&end={end}&format=CSV")


def fetch(job):
    (a, b), (c, d), y = job
    f = CACHE / f"precip_{a}_{b}_{c}_{d}_{y}.csv"
    if needs_fetch(f, year=y, min_size=1000):
        import datetime as _dt
        end = f"{y}1231" if y < _dt.date.today().year else (_dt.date.today() - _dt.timedelta(days=4)).strftime("%Y%m%d")
        with urllib.request.urlopen(URL.format(a=a, b=b, c=c, d=d, y=y, end=end), timeout=180) as r:
            f.write_bytes(r.read())
    txt = f.read_text()
    body = txt.split("-END HEADER-")[1]
    return pd.read_csv(io.StringIO(body))


def main():
    jobs = list(itertools.product(LAT_BOXES, LON_BOXES, YEARS))
    with ThreadPoolExecutor(4) as ex:
        frames = list(ex.map(fetch, jobs))
    df = pd.concat(frames, ignore_index=True)
    df = df[df["PRECTOTCORR"] >= 0]
    df[["LAT", "LON", "YEAR", "DOY", "PRECTOTCORR"]].to_pickle(WORK / "precip_daily.pkl")
    print("daily precip rows", len(df))


if __name__ == "__main__":
    main()
