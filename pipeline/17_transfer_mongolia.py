"""Transfer test: does the Kazakhstan calibration work in another country?
Apply the ratios learned in Kazakhstan (Aqua per S-NPP, national by day/night x season) to
Mongolia's S-NPP hotspots and compare with Mongolia's own MODIS Aqua, 2012-2021.
Baselines: a single naive ratio, and Mongolia's own in-country calibration (upper bound).
Output: web/data/transfer.json
"""
import glob
import json
import numpy as np
import pandas as pd
from common import ROOT, WORK, WEB_DATA, cell_id, season_of, month_index, FLARE_CELL

RAWM = ROOT / "data" / "raw_mng"


def load(country_dir):
    fr = []
    for f in glob.glob(str(country_dir / "*.csv")):
        d = pd.read_csv(f, dtype={"acq_time": str, "satellite": str})
        fr.append(d[["latitude", "longitude", "acq_date", "satellite", "daynight", "type"]])
    p = pd.concat(fr)
    p["date"] = pd.to_datetime(p["acq_date"]); p["year"] = p["date"].dt.year; p["month"] = p["date"].dt.month
    p["dn"] = (p["daynight"] == "N").astype(int); p["season"] = season_of(p["month"])
    # same persistence mask idea as in Kazakhstan
    c = cell_id(p["latitude"], p["longitude"], FLARE_CELL)
    g = pd.DataFrame({"c": c, "y": p["year"], "m": p["month"], "d": p["date"]}).groupby(["c", "y"]).agg(days=("d", "nunique"), mo=("m", "nunique"))
    hot = g[(g.days >= 10) & (g.mo >= 6)].reset_index().groupby("c")["y"].nunique()
    bad = set(hot[hot >= 3].index) | set(np.unique(c[p["type"].values == 2]))
    p = p[~np.isin(c, list(bad)) & (p["type"] == 0)]
    p["block"] = cell_id(p["latitude"], p["longitude"], 1.0)
    p["mi"] = month_index(p["year"], p["month"])
    return p


def r2log(o, q):
    df = pd.DataFrame({"o": o, "p": q}).fillna(0); df = df[(df.o + df.p) > 0]
    lo, lp = np.log1p(df.o), np.log1p(df.p)
    return round(float(1 - ((lo - lp) ** 2).sum() / ((lo - lo.mean()) ** 2).sum()), 3), round(float((df.p.sum() / df.o.sum() - 1) * 100), 1), int(len(df))


def main():
    kz = pd.read_pickle(WORK / "points.pkl")
    kz = kz[kz["keep"] & kz["year"].between(2012, 2021)]
    kz["season"] = season_of(kz["month"]); s = kz["sat"].astype(str)
    k_kz = (kz[s == "Aqua"].groupby(["dn", "season"]).size() / kz[s == "N"].groupby(["dn", "season"]).size()).to_dict()
    naive = (s == "Aqua").sum() / (s == "N").sum()

    m = load(RAWM); sm = m["satellite"].astype(str)
    aqua, snpp = m[sm == "Aqua"], m[sm == "N"]
    obs = aqua.groupby(["block", "mi"]).size()
    w = snpp.apply(lambda r: k_kz.get((r["dn"], r["season"]), naive), axis=1)
    pred_kz = pd.Series(w.values, index=pd.MultiIndex.from_arrays([snpp["block"], snpp["mi"]])).groupby(level=[0, 1]).sum()
    pred_naive = snpp.groupby(["block", "mi"]).size() * naive
    # in-country upper bound: fit on 2012-2017, test 2018-2021
    tr = m[m["year"] <= 2017]; st = tr["satellite"].astype(str)
    k_mn = (tr[st == "Aqua"].groupby(["dn", "season"]).size() / tr[st == "N"].groupby(["dn", "season"]).size()).to_dict()
    te = m["year"] >= 2018
    w2 = snpp[snpp["year"] >= 2018].apply(lambda r: k_mn.get((r["dn"], r["season"]), naive), axis=1)
    s2 = snpp[snpp["year"] >= 2018]
    pred_mn = pd.Series(w2.values, index=pd.MultiIndex.from_arrays([s2["block"], s2["mi"]])).groupby(level=[0, 1]).sum()
    obs_te = aqua[aqua["year"] >= 2018].groupby(["block", "mi"]).size()
    pred_kz_te = pred_kz[pred_kz.index.get_level_values(1) >= month_index(2018, 1)]
    out = {"country": "Mongolia", "period": "2012-2021", "unit": "1-degree block-months",
           "kz_transfer_all": dict(zip(["r2_log", "bias_pct", "n"], r2log(obs, pred_kz))),
           "naive_all": dict(zip(["r2_log", "bias_pct", "n"], r2log(obs, pred_naive))),
           "kz_transfer_2018_21": dict(zip(["r2_log", "bias_pct", "n"], r2log(obs_te, pred_kz_te))),
           "mongolia_own_2018_21": dict(zip(["r2_log", "bias_pct", "n"], r2log(obs_te, pred_mn))),
           "ratio_day_kz": round(float(k_kz.get((0, 2), np.nan)), 4), "ratio_day_mn": round(float(k_mn.get((0, 2), np.nan)), 4)}
    nat = pd.DataFrame({"aqua": aqua.groupby("year").size(), "kz": pd.Series(w.values, index=snpp["year"].values).groupby(level=0).sum()})
    out["yearly"] = [[int(y), int(r.aqua), round(float(r.kz), 1)] for y, r in nat.iterrows()]
    (WEB_DATA / "transfer.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "yearly"}, indent=1)); print(out["yearly"])


if __name__ == "__main__":
    main()
