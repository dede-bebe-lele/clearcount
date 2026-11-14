"""ClearCount auto-update: python pipeline/update.py --mode auto|daily|weekly|monthly|full (see README)."""
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
    if needs and not needs():
        log.append({"step": label, "status": "skipped"}); print(f"-- skip {label}"); return False
    t = time.time(); print(f">> {label}")
    try:
        r = subprocess.run(args, cwd=HERE, capture_output=True, text=True, timeout=3 * 3600)
        ok = r.returncode == 0
        tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
    except Exception as e:
        ok, tail = False, [repr(e)]
    log.append({"step": label, "status": "ok" if ok else "failed", "seconds": round(time.time() - t), "tail": tail if not ok else []})
    print(("   ok" if ok else "   FAILED: " + " | ".join(tail)), f"({round(time.time() - t)} s)")
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
    for d in (WORK, WEB, ROOT / "data" / "raw", ROOT / "data" / "raw_mng"):
        d.mkdir(parents=True, exist_ok=True)
    log = []
    print(f"ClearCount update · mode={mode} · {today}")

    run("FIRMS country files", ["bash", "01_download_firms.sh"], log=log)
    run("FIRMS API", [PY, "11_firms_api.py"], needs=has_key, log=log)
    if level >= 2 or not (WORK / "cloud_daily.pkl").exists():
        run("NASA POWER daily cloud", [PY, "04_clouds.py"], log=log)
    if level >= 2 or not (WORK / "precip_daily.pkl").exists():
        run("NASA POWER daily rain", [PY, "22_daily_precip.py"], log=log)

    run("prepare + flare mask", [PY, "02_prepare.py"], log=log)
    run("harmonize + validate", [PY, "03_harmonize.py"], log=log)
    run("fire events", [PY, "05_events.py"], log=log)
    run("web export", [PY, "06_export_web.py"], log=log)
    if run("orbit-drift detector", [PY, "08_drift.py"], log=log):
        shutil.copy(WORK / "drift.json", WEB / "drift.json")
    run("regions", [PY, "20_regions.py"], log=log)
    run("uncertainty", [PY, "18_uncertainty.py"], log=log)

    if level >= 3 or not (WORK / "harmonized_cells_lc.pkl").exists():  # land cover feeds the regimes, so it runs first
        run("land cover", [PY, "12_earthdata.py", "landcover"], needs=has_ed, log=log)
        run("land-cover export", [PY, "15_export_lc.py"], log=log)

    if level >= 2:
        run("satellite passes", [PY, "07_looks.py"], log=log)
        run("passes export", [PY, "09_looks_export.py"], log=log)
        run("weather", [PY, "10_weather.py"], log=log)
        run("trends + regimes", [PY, "19_trends_regimes.py"], log=log)
        run("cloud correction", [PY, "23_blind_correction.py"], log=log)
        run("ML early warning", [PY, "13_ml_outlook.py"], log=log)

    if level >= 3:
        run("case masks", [PY, "12_earthdata.py", "cases"], needs=has_ed, log=log)
        run("case passes", [PY, "14_case_overpass.py"], needs=has_ed, log=log)
        run("burned area", [PY, "12_earthdata.py", "burned"], needs=has_ed, log=log)
        run("Mongolia files", ["bash", "01_download_firms.sh", "Mongolia"], log=log)
        run("Mongolia transfer test", [PY, "17_transfer_mongolia.py"], log=log)
        run("ML: raw vs harmonized", [PY, "21_ml_raw_vs_harmonized.py"], log=log)

    run("compress web data", [PY, "16_compress_web.py"], log=log)

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
