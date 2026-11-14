"""ClearCount automatic update. Runs locally or in GitHub Actions.

  python pipeline/update.py --mode auto|daily|weekly|monthly|full

auto  = full on an empty cache, monthly on the 1st, weekly on Mondays, otherwise daily.
daily   : new FIRMS hotspots (archive + near-real-time), harmonization, events, regions,
          uncertainty, calendar/web export                                   (~10-15 min)
weekly  : + cloud & rain (NASA POWER), satellite passes (CMR), weather, trends & regimes,
          cloud-hidden correction, ML early warning                          (~25-40 min)
monthly : + Earthdata products (land cover, case masks, burned area), Mongolia transfer test,
          raw-vs-harmonized ML experiment                                    (~1-2 h)
Each step is isolated: if a NASA service is down, the step is skipped and the previous
output stays in place, so the site never breaks. Writes web/data/build.json.
"""
import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PY = sys.executable
WORK = ROOT / "data" / "work"
WEB = ROOT / "web" / "data"


def run(label, args, needs=None, log=None):
    """Run one pipeline step; never raise."""
    if needs and not needs():
        log.append({"step": label, "status": "skipped (credentials missing)"}); print(f"-- skip {label}"); return False
    t = time.time(); print(f">> {label}", flush=True)
    try:
        r = subprocess.run(args, cwd=HERE, capture_output=True, text=True, timeout=3 * 3600)
        ok = r.returncode == 0
        tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
    except Exception as e:  # timeout etc.
        ok, tail = False, [repr(e)]
    log.append({"step": label, "status": "ok" if ok else "failed", "seconds": round(time.time() - t), "tail": tail if not ok else []})
    print(("   ok" if ok else "   FAILED: " + " | ".join(tail)), f"({round(time.time() - t)} s)", flush=True)
    return ok


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--mode", default="auto"); a = ap.parse_args()
    today = dt.date.today()
    mode = a.mode
    if mode == "auto":
        mode = "full" if not (WORK / "points.pkl").exists() else "monthly" if today.day == 1 else "weekly" if today.weekday() == 0 else "daily"
    level = {"daily": 1, "weekly": 2, "monthly": 3, "full": 3}[mode]
    has_key = lambda: (ROOT / ".env").exists() and "FIRMS_MAP_KEY=" in (ROOT / ".env").read_text() or bool(os.environ.get("FIRMS_MAP_KEY"))
    has_ed = lambda: (Path.home() / ".netrc").exists()
    WORK.mkdir(parents=True, exist_ok=True); WEB.mkdir(parents=True, exist_ok=True)
    log = []
    print(f"ClearCount update · mode={mode} · {today}")

    # ---- data in
    run("FIRMS yearly country files", ["bash", "01_download_firms.sh"], log=log)
    run("FIRMS API: current year + NOAA-21", [PY, "11_firms_api.py"], needs=has_key, log=log)
    if level >= 2 or not (WORK / "cloud_daily.pkl").exists():
        run("NASA POWER daily cloud", [PY, "04_clouds.py"], log=log)
    if level >= 2 or not (WORK / "precip_daily.pkl").exists():
        run("NASA POWER daily rain", [PY, "22_daily_precip.py"], log=log)

    # ---- core (every run)
    run("prepare + flare mask", [PY, "02_prepare.py"], log=log)
    run("harmonize + validate", [PY, "03_harmonize.py"], log=log)
    run("fire events", [PY, "05_events.py"], log=log)
    run("web export", [PY, "06_export_web.py"], log=log)
    if run("orbit-drift detector", [PY, "08_drift.py"], log=log):
        shutil.copy(WORK / "drift.json", WEB / "drift.json")
    run("regions", [PY, "20_regions.py"], log=log)
    run("calibration uncertainty", [PY, "18_uncertainty.py"], log=log)

    # ---- weekly
    if level >= 2:
        run("satellite passes (FIRMS swath outlines / CMR)", [PY, "07_looks.py"], log=log)
        run("passes export", [PY, "09_looks_export.py"], log=log)
        run("fire weather (POWER monthly)", [PY, "10_weather.py"], log=log)
        run("trends + regimes", [PY, "19_trends_regimes.py"], log=log)
        run("cloud-hidden correction", [PY, "23_blind_correction.py"], log=log)
        run("ML early warning", [PY, "13_ml_outlook.py"], log=log)

    # ---- monthly
    if level >= 3:
        run("land cover (MCD12Q1)", [PY, "12_earthdata.py", "landcover"], needs=has_ed, log=log)
        run("land-cover export", [PY, "15_export_lc.py"], log=log)
        run("case masks (MxD14A1/VNP14A1)", [PY, "12_earthdata.py", "cases"], needs=has_ed, log=log)
        run("case per-pass check (L2)", [PY, "14_case_overpass.py"], needs=has_ed, log=log)
        run("burned area check (MCD64A1)", [PY, "12_earthdata.py", "burned"], needs=has_ed, log=log)
        mng = ROOT / "data" / "raw_mng"; mng.mkdir(parents=True, exist_ok=True)
        run("Mongolia files", ["bash", "-c", "cd ../data/raw_mng && for s in modis viirs-snpp; do for y in $(seq 2012 2021); do f=${s}_${y}_Mongolia.csv; [ -s $f ] || curl -sfL --retry 3 -o $f https://firms.modaps.eosdis.nasa.gov/data/country/$s/$y/$f; done; done"], log=log)
        run("Mongolia transfer test", [PY, "17_transfer_mongolia.py"], log=log)
        run("ML: raw vs harmonized", [PY, "21_ml_raw_vs_harmonized.py"], log=log)

    run("compress web data", [PY, "16_compress_web.py"], log=log)

    # ---- build stamp
    try:
        meta = json.loads((WEB / "validation.json").read_text()).get("meta", {})
    except Exception:
        meta = {}
    stamp = {"updated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "build": dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M"),
             "mode": mode, "data_through": meta.get("end"), "steps": log,
             "failed": [s["step"] for s in log if s["status"] == "failed"]}
    (WEB / "build.json").write_text(json.dumps(stamp, indent=1))
    print(f"done · {len([s for s in log if s['status'] == 'ok'])} ok · {len(stamp['failed'])} failed · data through {stamp['data_through']}")


if __name__ == "__main__":
    main()
