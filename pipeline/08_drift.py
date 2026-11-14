"""Orbit-drift detector: how much did Terra/Aqua orbital drift change MODIS fire counts?

Reference: VIIRS S-NPP, whose equator-crossing time was maintained (stable ~12:48 local).
For each year: ratio of daytime landscape-fire detections MODIS/S-NPP, normalized by
the 2012-2019 mean (before drift). Placebo: NOAA-20/S-NPP (two identical, maintained
sensors) should stay ~1. Sign test: drifting later toward the ~14-15 h fire peak (Aqua)
predicts MORE detections; drifting earlier (Terra) predicts FEWER.
95% CIs by bootstrap over days.
Output: data/work/drift.json
"""
import json
import numpy as np
import pandas as pd
from common import WORK, load_points

rng = np.random.default_rng(42)


def main():
    p = load_points()
    p = p[p["keep"] & (p["dn"] == 0) & p["year"].between(2012, 2025)].copy()  # full years; S-NPP degraded in 2026
    p["sat"] = p["sat"].astype(str)
    p["lh"] = (p["hhmm"] // 100 + (p["hhmm"] % 100) / 60 + p["lon"] / 15) % 24
    daily = p.groupby(["year", "date", "sat"]).size().unstack(fill_value=0)
    out = {"years": [], "local_time": {}, "ratio": {}, "ci": {}}
    years = sorted(daily.index.get_level_values(0).unique())
    base_years = [y for y in years if 2012 <= y <= 2019]
    pairs = {"Aqua": "N", "Terra": "N", "N20": "N"}
    base = {}
    for s in pairs:
        # baseline only over years where this satellite actually flew (NOAA-20: 2018-2021)
        yrs = [y for y in years if (2012 <= y <= (2021 if s == "N20" else 2019)) and daily.loc[y][s].sum() > 0]
        b = daily.loc[yrs]
        base[s] = b[s].sum() / b["N"].sum()
    for s in pairs:
        out["ratio"][s], out["ci"][s] = [], []
        for y in years:
            d = daily.loc[y]
            if s not in d or d[s].sum() == 0:
                out["ratio"][s].append(None); out["ci"][s].append(None); continue
            a, n = d[s].values, d["N"].values
            r = a.sum() / n.sum() / base[s]
            idx = rng.integers(0, len(a), size=(1000, len(a)))
            boots = a[idx].sum(1) / np.maximum(n[idx].sum(1), 1) / base[s]
            out["ratio"][s].append(round(float(r), 3))
            out["ci"][s].append([round(float(np.percentile(boots, 2.5)), 3), round(float(np.percentile(boots, 97.5)), 3)])
    lt = p.groupby(["year", "sat"])["lh"].median().unstack()
    for s in ["Aqua", "Terra", "N", "N20"]:
        out["local_time"][s] = [round(float(lt.loc[y, s]), 2) if s in lt and pd.notna(lt.loc[y, s]) else None for y in years]
    out["years"] = [int(y) for y in years]
    last = years.index(max(years))
    out["summary"] = {
        "aqua_shift_hours": round(out["local_time"]["Aqua"][last] - float(np.median([out["local_time"]["Aqua"][years.index(y)] for y in base_years])), 2),
        "terra_shift_hours": round(out["local_time"]["Terra"][last] - float(np.median([out["local_time"]["Terra"][years.index(y)] for y in base_years])), 2),
        "aqua_change_pct": round((out["ratio"]["Aqua"][last] - 1) * 100, 1),
        "terra_change_pct": round((out["ratio"]["Terra"][last] - 1) * 100, 1),
        "placebo_noaa20_range": [min(x for x in out["ratio"]["N20"] if x), max(x for x in out["ratio"]["N20"] if x)],
        "baseline_years": [2012, 2019], "last_year": int(max(years)),
    }
    (WORK / "drift.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out["summary"], indent=1))
    print("Aqua", out["ratio"]["Aqua"]); print("Terra", out["ratio"]["Terra"])


if __name__ == "__main__":
    main()
