"""Load FIRMS SP yearly country files, unify MODIS/VIIRS schemas, build a
persistent-source (gas flare / industry) mask, and save one tidy table.

Output: data/work/points.pkl, data/work/flare_cells.csv
"""
import glob
import numpy as np
import pandas as pd
from common import RAW, WORK, COUNTRY, FLARE_CELL, cell_id, cell_center

COLS = ["latitude", "longitude", "scan", "track", "acq_date", "acq_time",
        "satellite", "confidence", "frp", "daynight", "type"]


def read_all():
    frames = []
    for path in sorted(glob.glob(str(RAW / f"*_{COUNTRY}.csv"))):
        df = pd.read_csv(path, usecols=lambda c: c in COLS,
                         dtype={"acq_time": str, "confidence": str, "satellite": str})
        df["src"] = path.split("/")[-1].split("_")[0]
        frames.append(df)
        print(f"  {path.split('/')[-1]:38s} {len(df):>9,d}")
    df = pd.concat(frames, ignore_index=True)
    # NOAA-20 files sometimes encode satellite as '1' or 'N20'
    df["satellite"] = df["satellite"].replace({"1": "N20", "N1": "N20", "J1": "N20", "2": "N21", "N2": "N21"})
    return df


def tidy(df):
    out = pd.DataFrame({
        "lat": df["latitude"].astype("float32"),
        "lon": df["longitude"].astype("float32"),
        "scan": df["scan"].astype("float32"),
        "track": df["track"].astype("float32"),
        "frp": df["frp"].astype("float32"),
        "dn": (df["daynight"] == "N").astype("int8"),       # 1 = night
        "type": df["type"].fillna(0).astype("int8"),
        "sat": df["satellite"].astype("category"),
        "conf": df["confidence"].astype(str).str.lower(),
    })
    d = pd.to_datetime(df["acq_date"])
    out["date"] = d.values.astype("datetime64[D]")
    out["year"] = d.dt.year.astype("int16")
    out["month"] = d.dt.month.astype("int8")
    t = df["acq_time"].str.zfill(4)
    out["hhmm"] = t.astype("int16")
    out["sensor"] = np.where(out["sat"].isin(["Terra", "Aqua"]), "MODIS", "VIIRS")
    return out


def flare_mask(p):
    """Persistent thermal sources: a ~2 km cell that is hot on many days, spread over
    many months, in several years. Built from VIIRS (375 m) and MODIS together.
    Rule (stricter than FIRMS 'type 2', which is single-year >=16 days):
      in >=3 distinct years the cell has >=10 detection-days spread over >=6 months.
    """
    c = cell_id(p["lat"], p["lon"], FLARE_CELL)
    g = pd.DataFrame({"c": c, "year": p["year"], "month": p["month"], "date": p["date"]})
    per_year = g.groupby(["c", "year"]).agg(days=("date", "nunique"), months=("month", "nunique"))
    hot = per_year[(per_year["days"] >= 10) & (per_year["months"] >= 6)]
    n_years = hot.reset_index().groupby("c")["year"].nunique()
    cells = set(n_years[n_years >= 3].index)
    # FIRMS static-source flag also marks a cell as persistent
    cells |= set(np.unique(c[p["type"].values == 2]))
    # dilate by one cell to absorb MODIS 1 km geolocation scatter
    ncol = int(round(360 / FLARE_CELL))
    dil = set()
    for x in cells:
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                dil.add(x + di * ncol + dj)
    return dil, cells


def main():
    print("Reading FIRMS files")
    raw = read_all()
    p = tidy(raw)
    del raw
    print(f"Total detections: {len(p):,}")
    print(p.groupby("sat", observed=True).size().to_string())

    dil, core = flare_mask(p)
    c = cell_id(p["lat"], p["lon"], FLARE_CELL)
    p["flare"] = np.isin(c, list(dil))
    p["keep"] = (p["type"] == 0) & (~p["flare"])
    print(f"Persistent-source cells: {len(core):,} (dilated {len(dil):,})")
    print(f"Flagged as flare/industrial: {p['flare'].mean():.1%}; FIRMS type!=0: {(p['type'] != 0).mean():.1%}")
    print(f"Kept as vegetation/landscape fire: {p['keep'].mean():.1%}")

    lat, lon = cell_center(np.array(sorted(core)), FLARE_CELL)
    fc = pd.DataFrame({"lat": lat.round(3), "lon": lon.round(3)})
    cnt = pd.Series(c[p["flare"].values]).value_counts()
    fc["detections"] = [int(cnt.get(x, 0)) for x in sorted(core)]
    fc.to_csv(WORK / "flare_cells.csv", index=False)

    p.to_pickle(WORK / "points.pkl")
    print("saved", WORK / "points.pkl")


if __name__ == "__main__":
    main()
