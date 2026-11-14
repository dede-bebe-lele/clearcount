#!/usr/bin/env bash
# Download FIRMS standard-processing (SP) yearly country files (public, no login).
# Source: https://firms.modaps.eosdis.nasa.gov/data/country/
# Usage: ./01_download_firms.sh [Country]   (parallel, resumable)
set -euo pipefail
cd "$(dirname "$0")/../data/raw"
COUNTRY="${1:-Kazakhstan}"
BASE="https://firms.modaps.eosdis.nasa.gov/data/country"
{
  for y in $(seq 2000 2025); do echo "modis $y"; done
  for y in $(seq 2012 2025); do echo "viirs-snpp $y"; done
  for y in $(seq 2018 2025); do echo "viirs-jpss1 $y"; done
} | while read -r s y; do
  f="${s}_${y}_${COUNTRY}.csv"; [ -s "$f" ] || echo "$s $y $f"
done | xargs -P 6 -n 3 sh -c '
  url="'"$BASE"'/$0/$1/$2"
  if curl -sfL --retry 4 --compressed -o "$2.part" "$url"; then mv "$2.part" "$2"; echo "ok   $2"; else rm -f "$2.part"; echo "miss $2"; fi'
echo DONE
