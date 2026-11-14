"""Monthly harmonized fire activity per Kazakhstan region (geoBoundaries ADM1, 2017 boundaries,
ODbL). 0.25-degree cells are assigned to a region by their centre point.
Output: web/data/regions.json  {names, geojson (rounded), monthly harmonized series per region}"""
import json
import numpy as np
import pandas as pd
from common import STATIC, WORK, WEB_DATA, GRID, cell_center, month_index

M0 = month_index(2000, 11)
NAMES_RU = {"Akmola Region": "Акмолинская", "Aktobe Region": "Актюбинская", "Almaty": "г. Алматы", "Almaty Region": "Алматинская",
            "Astana": "г. Астана", "Atyrau Region": "Атырауская", "East Kazakhstan Region": "Восточно-Казахстанская", "Jambyl Region": "Жамбылская",
            "Karaganda Region": "Карагандинская", "Kostanay Region": "Костанайская", "Kyzylorda Region": "Кызылординская", "Mangystau Region": "Мангистауская",
            "North Kazakhstan Region": "Северо-Казахстанская", "Pavlodar Region": "Павлодарская", "South Kazakhstan Region": "Южно-Казахстанская (Туркестанская)",
            "West Kazakhstan Region": "Западно-Казахстанская"}


def rings_of(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    return [np.array(p[0]) for p in polys]


def inside(lon, lat, rings):
    res = np.zeros(len(lon), bool)
    for r in rings:
        x1, y1 = r[:, 0], r[:, 1]; x2, y2 = np.roll(x1, -1), np.roll(y1, -1); ins = np.zeros(len(lon), bool)
        for a, b, c, d in zip(x1, y1, x2, y2):
            cond = (b > lat) != (d > lat)
            if cond.any():
                ins ^= cond & (lon < (c - a) * (lat - b) / ((d - b) if d != b else 1e-12) + a)
        res |= ins
    return res


def main():
    g = json.loads((STATIC / "kaz_adm1.geojson").read_text())
    c = pd.read_pickle(WORK / "harmonized_cells.pkl")
    cells = c["cell"].unique()
    la, lo = cell_center(cells, GRID)
    n = int(c["mi"].max()) - M0 + 1
    out = {"source": "geoBoundaries gbOpen KAZ ADM1 (2017 boundaries; OpenStreetMap, ODbL). Abai, Jetisu and Ulytau regions (created 2022) are inside East Kazakhstan, Almaty and Karaganda.",
           "regions": []}
    for f in g["features"]:
        name = f["properties"]["shapeName"]
        rs = rings_of(f["geometry"])
        m = inside(lo, la, rs)
        sel = set(cells[m])
        q = c[c["cell"].isin(sel)].groupby("mi")["h"].sum()
        arr = np.zeros(n); idx = q.index.values - M0; ok = (idx >= 0) & (idx < n); arr[idx[ok]] = q.values[ok]
        geom = f["geometry"]
        def rnd(x):
            return [rnd(v) for v in x] if isinstance(x, list) and x and isinstance(x[0], list) else [round(x[0], 3), round(x[1], 3)]
        coords = rnd(geom["coordinates"])
        out["regions"].append({"name": name, "name_ru": NAMES_RU.get(name, name), "cells": int(m.sum()),
                               "geometry": {"type": geom["type"], "coordinates": coords}, "h": [round(float(v), 2) for v in arr]})
        print(f"{name:28s} cells {m.sum():4d}  total {arr.sum():9.0f}")
    (WEB_DATA / "regions.json").write_text(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
