"""Gzip the large web data folders (points, looks, cloud); the app decompresses in the browser."""
import gzip
from common import WEB_DATA
for sub in ("points", "looks", "cloud"):
    for f in (WEB_DATA / sub).iterdir():
        if f.suffix in (".csv", ".json"):
            f.with_name(f.name + ".gz").write_bytes(gzip.compress(f.read_bytes(), 9)); f.unlink()
print("compressed")
