"""Earthdata (LP DAAC) products that need an Earthdata Login (stored by YOU in ~/.netrc).

  python 12_earthdata.py landcover   MCD12Q1 2020 land cover -> class for every hotspot
                                     (forest / grassland-steppe / cropland / other), ~160 MB
  python 12_earthdata.py cases       Daily fire masks MYD14A1 + VNP14A1 + VJ114A1 for the case
                                     studies (Abai Jun 2023, Bayanaul Oct 2024): exact share of
                                     cloud (class 4) vs clear land (class 5) over the fire, per day
  python 12_earthdata.py burned      MCD64A1 burned area, Apr-Oct of sample years on both sides
                                     of 2012 -> independent check that the harmonized record has
                                     no step relative to burned area (~2 GB)
Outputs go to data/work/earthdata/ and web/data/ (landcover.json, cases_masks.json, burned.json).
"""
import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
from common import WORK, WEB_DATA

OUT = WORK / "earthdata"
OUT.mkdir(exist_ok=True)
KZ_BBOX = (46.4, 40.5, 87.4, 55.5)  # lon_min, lat_min, lon_max, lat_max (earthaccess order)
CASES = {"abai_2023_06": ((78.8, 49.8, 81.8, 51.3), "2023-06-01", "2023-06-30"),
         "bayanaul_2024_10": ((74.6, 49.6, 76.8, 51.3), "2024-10-01", "2024-10-31")}

# MODIS sinusoidal grid
R, T, NPIX = 6371007.181, 1111950.5197665233, {"1km": 1200, "500m": 2400}


def login():
    import earthaccess
    if not (Path.home() / ".netrc").exists():
        raise SystemExit("No ~/.netrc found. Follow the steps in clearcount/LOGIN_SETUP.md first.")
    return earthaccess.login(strategy="netrc")


def sin_pixel(lat, lon, res):
    """lat/lon -> (h, v, row, col) on the MODIS sinusoidal grid."""
    x = R * np.radians(lon) * np.cos(np.radians(lat)); y = R * np.radians(lat)
    h = np.floor((x + 18 * T) / T).astype(int); v = np.floor((9 * T - y) / T).astype(int)
    n = NPIX[res]; size = T / n
    col = np.floor((x + 18 * T - h * T) / size).astype(int); row = np.floor((9 * T - y - v * T) / size).astype(int)
    return h, v, np.clip(row, 0, n - 1), np.clip(col, 0, n - 1)


def read_sds(path, name):
    if str(path).endswith(".h5"):
        import h5py
        with h5py.File(path, "r") as f:
            out = {}
            f.visit(lambda k: out.setdefault("ds", f[k]) if k.endswith(name) and isinstance(f[k], h5py.Dataset) else None)
            return out["ds"][()]
    from pyhdf.SD import SD, SDC
    return SD(str(path), SDC.READ).select(name).get()


def landcover():
    import earthaccess
    login()
    res = earthaccess.search_data(short_name="MCD12Q1", bounding_box=KZ_BBOX, temporal=("2020-01-01", "2020-12-31"))
    files = earthaccess.download(res, str(OUT / "mcd12q1"))
    tiles = {}
    for f in files:
        hv = Path(f).name.split(".")[2]; tiles[(int(hv[1:3]), int(hv[4:6]))] = read_sds(f, "LC_Type1")
    w = pd.read_pickle(WORK / "weights.pkl")
    h, v, r, c = sin_pixel(w["lat"].values, w["lon"].values, "500m")
    lc = np.full(len(w), 255, dtype=np.uint8)
    for (th, tv), arr in tiles.items():
        m = (h == th) & (v == tv); lc[m] = arr[r[m], c[m]]
    # IGBP -> 4 groups
    grp = np.select([np.isin(lc, [1, 2, 3, 4, 5]), np.isin(lc, [6, 7, 8, 9, 10]), np.isin(lc, [12, 14])], ["forest", "grass_steppe", "cropland"], "other")
    w["lc"] = grp
    w.to_pickle(WORK / "weights.pkl")
    cells = w.groupby(["cell", "mi", "lc"])["w"].sum().reset_index()
    cells.to_pickle(WORK / "harmonized_cells_lc.pkl")
    print(w.groupby("lc")["w"].sum().round(0).to_string())


def cases():
    import earthaccess
    login()
    out = {}
    for name, (bbox, t0, t1) in CASES.items():
        out[name] = {}
        for sn, res_ in [("MYD14A1", "1km"), ("MOD14A1", "1km"), ("VNP14A1", "1km"), ("VJ114A1", "1km")]:
            res = earthaccess.search_data(short_name=sn, bounding_box=bbox, temporal=(t0, t1))
            files = earthaccess.download(res, str(OUT / name / sn))
            daily = {}
            for f in files:
                fm = read_sds(f, "FireMask")
                fm = fm if fm.ndim == 3 else fm[None]
                parts = Path(f).name.split("."); hv = parts[2]; doy0 = int(parts[1][5:])
                # pixels of this tile inside the bbox
                lats = np.linspace(bbox[1], bbox[3], 60); lons = np.linspace(bbox[0], bbox[2], 90)
                LA, LO = np.meshgrid(lats, lons)
                h, v, r, c = sin_pixel(LA.ravel(), LO.ravel(), "1km")
                m = (h == int(hv[1:3])) & (v == int(hv[4:6]))
                for k in range(fm.shape[0]):
                    vals = fm[k][r[m], c[m]]
                    d = daily.setdefault(doy0 + k, np.zeros(4, int))
                    d += [(vals == 4).sum(), (vals == 5).sum(), (vals >= 7).sum(), vals.size]
            out[name][sn] = {int(k): {"cloud": int(a), "clear": int(b), "fire": int(c_), "n": int(n)} for k, (a, b, c_, n) in sorted(daily.items())}
    (WEB_DATA / "cases_masks.json").write_text(json.dumps(out))
    print(json.dumps({k: list(v) for k, v in out.items()}))


def burned():
    import earthaccess
    login()
    years = [2008, 2010, 2015, 2017, 2019, 2021, 2023]
    rows = []
    for y in years:
        res = earthaccess.search_data(short_name="MCD64A1", bounding_box=KZ_BBOX, temporal=(f"{y}-04-01", f"{y}-10-31"))
        for g in res:
            f = earthaccess.download([g], str(OUT / "mcd64a1"))[0]
            bd = read_sds(f, "Burn Date")
            parts = Path(f).name.split("."); hv = parts[2]; doy = int(parts[1][5:])
            month = (pd.Timestamp(f"{y}-01-01") + pd.Timedelta(days=doy - 1)).month
            rows.append([y, month, hv, int((bd > 0).sum()) * 0.2146])  # 463.3 m pixel ~ 0.2146 km2
            Path(f).unlink()  # keep disk small
    ba = pd.DataFrame(rows, columns=["year", "month", "tile", "km2"]).groupby(["year", "month"])["km2"].sum().reset_index()
    nat = pd.read_csv(WORK / "national.csv", index_col=0)
    nat["year"], nat["month"] = 2000 + nat.index // 12, nat.index % 12 + 1
    m = ba.merge(nat[["year", "month", "harmonized", "raw_all"]], on=["year", "month"])
    yr = m.groupby("year")[["km2", "harmonized", "raw_all"]].sum()
    yr["harmonized_per_100km2"] = yr["harmonized"] / yr["km2"] * 100
    yr["raw_per_100km2"] = yr["raw_all"] / yr["km2"] * 100
    (WEB_DATA / "burned.json").write_text(yr.reset_index().round(3).to_json(orient="records"))
    print(yr.round(2).to_string())


if __name__ == "__main__":
    {"landcover": landcover, "cases": cases, "burned": burned}[sys.argv[1] if len(sys.argv) > 1 else "landcover"]()
