"""Per-overpass check of the Abai 2023 case: for every MODIS Aqua/Terra pass over the fire
area on 8-12 June 2023, what fraction of the fire zone was cloud (class 4) vs visible
land/fire at THAT moment? Uses Level-2 MYD14/MOD14 fire masks + MYD03/MOD03 geolocation.
(Daily L3 composites mark a pixel clear if ANY pass that day was clear, so they cannot
answer this.) Output: web/data/case_overpass.json
"""
import json
from pathlib import Path
import numpy as np
from common import WORK, WEB_DATA

OUT = WORK / "earthdata" / "abai_l2"
FIRE_ZONE = (79.0, 50.3, 81.1, 51.1)    # lon0, lat0, lon1, lat1 around the 2023 Semey Ormany fire (from FIRMS)
DAYS = ("2023-06-08", "2023-06-12")


def sds(path, name):
    from pyhdf.SD import SD, SDC
    return SD(str(path), SDC.READ).select(name).get()


def main():
    import earthaccess
    earthaccess.login(strategy="netrc")
    res = {}
    for fire_sn, geo_sn in (("MYD14", "MYD03"), ("MOD14", "MOD03")):
        fires = earthaccess.search_data(short_name=fire_sn, bounding_box=FIRE_ZONE, temporal=DAYS)
        for g in fires:
            t = g["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"]
            geo = earthaccess.search_data(short_name=geo_sn, bounding_box=FIRE_ZONE, temporal=(t, t))
            if not geo:
                continue
            fp = earthaccess.download([g], str(OUT))[0]
            gp = earthaccess.download(geo[:1], str(OUT))[0]
            mask = sds(fp, "fire mask"); lat = sds(gp, "Latitude"); lon = sds(gp, "Longitude")
            z = (lon >= FIRE_ZONE[0]) & (lon <= FIRE_ZONE[2]) & (lat >= FIRE_ZONE[1]) & (lat <= FIRE_ZONE[3])
            if z.sum() < 20:
                continue
            m = mask[z]
            res[f"{fire_sn} {t[:16]}Z"] = {"sat": "Aqua" if fire_sn == "MYD14" else "Terra", "time": t[:16],
                                         "pixels": int(z.sum()), "cloud_pct": round(float((m == 4).mean() * 100), 1),
                                         "clear_pct": round(float(((m == 5) | (m >= 7)).mean() * 100), 1),
                                         "fire_px": int((m >= 7).sum())}
            Path(gp).unlink(missing_ok=True)  # geolocation files are large
    res = dict(sorted(res.items(), key=lambda kv: kv[1]["time"]))
    (WEB_DATA / "case_overpass.json").write_text(json.dumps(res, indent=1))
    for k, v in res.items():
        print(f"{v['time']}  {v['sat']:5s} cloud {v['cloud_pct']:5.1f}%  clear {v['clear_pct']:5.1f}%  fire px {v['fire_px']}")


if __name__ == "__main__":
    main()
