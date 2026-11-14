"""Fire-weather context from NASA POWER (MERRA-2), monthly, no login.
Precipitation, max temperature, relative humidity and wind on the 1-degree grid
used by the blindness layer, so the app can say *why* a month was unusual.
Output: web/data/weather.json  {res, params, cells:[[lat,lon,{param:[302 values]}]]}
"""
import io
import itertools
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd
from common import needs_fetch, WORK, WEB_DATA, month_index

PARAMS = {"PRECTOTCORR": "precip_mm_day", "T2M_MAX": "tmax_c", "RH2M": "rh_pct", "WS2M": "wind_ms"}
LAT_BOXES = [(40, 50), (50, 56)]
LON_BOXES = [(46, 56), (56, 66), (66, 76), (76, 86), (86, 88)]
CACHE = WORK / "power_monthly"
CACHE.mkdir(exist_ok=True)
URL = ("https://power.larc.nasa.gov/api/temporal/monthly/regional?parameters={p}&community=AG"
       "&latitude-min={a}&latitude-max={b}&longitude-min={c}&longitude-max={d}&start=2000&end=" + str(__import__('datetime').date.today().year) + "&format=CSV")
M0 = month_index(2000, 11)
MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def fetch(job):
    p, (a, b), (c, d) = job
    f = CACHE / f"{p}_{a}_{b}_{c}_{d}.csv"
    if needs_fetch(f, year=__import__('datetime').date.today().year, max_age_days=20):
        with urllib.request.urlopen(URL.format(p=p, a=a, b=b, c=c, d=d), timeout=300) as r:
            f.write_bytes(r.read())
    body = f.read_text().split("-END HEADER-")[1]
    return pd.read_csv(io.StringIO(body))


def main():
    jobs = list(itertools.product(PARAMS, LAT_BOXES, LON_BOXES))
    with ThreadPoolExecutor(4) as ex:
        df = pd.concat(list(ex.map(fetch, jobs)), ignore_index=True)
    long = df.melt(id_vars=["PARAMETER", "YEAR", "LAT", "LON"], value_vars=MON, var_name="MON", value_name="v")
    long = long[long["v"] > -998]
    long["mi"] = month_index(long["YEAR"], long["MON"].map({m: i + 1 for i, m in enumerate(MON)})) - M0
    # aggregate MERRA-2 0.5x0.625 cells onto 1-degree cells centred at x.5
    long["clat"] = np.floor(long["LAT"]) + .5
    long["clon"] = np.floor(long["LON"]) + .5
    g = long.groupby(["clat", "clon", "PARAMETER", "mi"])["v"].mean().reset_index()
    n = int(g["mi"].max()) + 1
    cells = []
    for (la, lo), q in g.groupby(["clat", "clon"]):
        d = {}
        for p, qq in q.groupby("PARAMETER"):
            arr = np.full(n, None, dtype=object)
            ok = qq["mi"].values >= 0
            arr[qq["mi"].values[ok]] = np.round(qq["v"].values[ok], 2)
            d[PARAMS[p]] = arr.tolist()
        cells.append([float(la), float(lo), d])
    (WEB_DATA / "weather.json").write_text(json.dumps({"res": 1.0, "source": "NASA POWER (MERRA-2) monthly", "cells": cells}, separators=(",", ":")))
    print("weather cells", len(cells), "months", n)


if __name__ == "__main__":
    main()
