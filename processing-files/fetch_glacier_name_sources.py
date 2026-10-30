#!/usr/bin/env python3
"""Download the present-day glacier inventories that carry glacier names.

Neither LIA outline set has a name field, so the names come from today's
glaciers that lie inside each LIA outline (see ``build_lia_glacier_names.py``).
This script only downloads; everything lands in ``derived-data/glacier-names/``
(git-ignored), and files already there are not fetched again.

Sources:

- ``sgi2016/``: Swiss Glacier Inventory 2016, GLAMOS (Linsbauer et al. 2021),
  https://doi.glamos.ch/data/inventory/inventory_sgi2016_r2020.zip
- ``glims_alps.geojson``: every named glacier outline in the GLIMS database
  inside the Alps, from its WFS. It holds the national inventories:
  Austria (Universität Innsbruck), France (IGE Grenoble), Italy (Milano,
  Brescia), Switzerland (UZH, GLAMOS), several dates per glacier.
- ``osm_glaciers.geojsonseq``: OpenStreetMap ``natural=glacier`` features
  (nodes, closed ways, multipolygons) with their tags, cut with osmium-tool
  from Geofabrik's Alps extract (``alps-latest.osm.pbf``, about 2.2 GB, kept
  for reruns). The public Overpass servers were too overloaded for this in
  October 2026. Needs ``osmium`` (conda-forge ``osmium-tool``).
- ``regions.geojson``: the officially bilingual regions with glaciers, from
  OSM via Nominatim: Aosta Valley (relation 45155, Italian and French) and
  South Tyrol (relation 47046, German and Italian).
"""

from __future__ import annotations

import argparse
import io
import json
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

USER_AGENT = "LIA-glacier-viewer/1.0 (+https://github.com/HenzAndreas)"
SGI_URL = "https://doi.glamos.ch/data/inventory/inventory_sgi2016_r2020.zip"
GLIMS_WFS = "https://www.glims.org/geoserver/ows"
GEOFABRIK_ALPS = "https://download.geofabrik.de/europe/alps-latest.osm.pbf"
NOMINATIM = "https://nominatim.openstreetmap.org/lookup"
# OSM relation -> languages that both belong in a glacier's name there.
BILINGUAL_REGIONS = {45155: ["it", "fr"], 47046: ["de", "it"]}
# lon_min, lat_min, lon_max, lat_max: the whole Alpine arc.
ALPS = (4.9, 43.6, 16.7, 48.4)


def get(url: str, data: bytes | None = None, timeout: int = 600) -> bytes:
    request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def fetch_sgi(out: Path) -> None:
    target = out / "sgi2016"
    if (target / "SGI_2016_glaciers.shp").exists():
        return
    print("SGI 2016 …")
    zipfile.ZipFile(io.BytesIO(get(SGI_URL))).extractall(target)


def fetch_glims(out: Path) -> None:
    target = out / "glims_alps.geojson"
    if target.exists():
        return
    print("GLIMS named outlines (about 180 MB) …")
    west, south, east, north = ALPS
    query = urllib.parse.urlencode({
        "service": "WFS",
        "version": "1.0.0",
        "request": "GetFeature",
        "typeName": "GLIMS:GLIMS_Glacier_Outlines",
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "propertyName": "entity_geom,glac_id,glac_name,src_date,chief_affl,anlys_id",
        "CQL_FILTER": (
            "line_type='glac_bound' AND glac_name IS NOT NULL AND glac_name<>'' AND "
            f"BBOX(entity_geom,{west},{south},{east},{north},'EPSG:4326')"
        ),
    })
    body = get(f"{GLIMS_WFS}?{query}", timeout=1200)
    json.loads(body)  # fail here rather than in the build on an error page
    target.write_bytes(body)


def fetch_regions(out: Path) -> None:
    target = out / "regions.geojson"
    if target.exists():
        return
    print("bilingual regions …")
    query = urllib.parse.urlencode({
        "osm_ids": ",".join(f"R{rid}" for rid in BILINGUAL_REGIONS),
        "format": "geojson",
        "polygon_geojson": 1,
        "polygon_threshold": 0.002,
    })
    collection = json.loads(get(f"{NOMINATIM}?{query}"))
    for feature in collection["features"]:
        props = feature["properties"]
        feature["properties"] = {
            "osm_id": props["osm_id"],
            "name": props.get("name"),
            "langs": ",".join(BILINGUAL_REGIONS[props["osm_id"]]),
        }
    target.write_text(json.dumps(collection))


def find_osmium() -> str:
    found = shutil.which("osmium") or str(Path(sys.executable).parent / "osmium")
    if not Path(found).is_file():
        raise RuntimeError("osmium not found; install osmium-tool from conda-forge into this environment")
    return found


def fetch_osm(out: Path) -> None:
    target = out / "osm_glaciers.geojsonseq"
    if target.exists():
        return
    extract = out / "alps-latest.osm.pbf"
    if not extract.exists():
        print("Geofabrik Alps extract (about 2.2 GB) …")
        request = urllib.request.Request(GEOFABRIK_ALPS, headers={"User-Agent": USER_AGENT})
        partial = extract.with_suffix(".part")
        with urllib.request.urlopen(request, timeout=600) as response, partial.open("wb") as file:
            shutil.copyfileobj(response, file, length=1 << 20)
        partial.rename(extract)
    print("OSM glaciers …")
    osmium = find_osmium()
    glaciers = out / "osm_glaciers.osm.pbf"
    subprocess.run([osmium, "tags-filter", str(extract), "nwr/natural=glacier", "-o", str(glaciers), "--overwrite"], check=True)
    # Closed ways and multipolygons as areas, nodes as points; ways that do not
    # close are not glaciers on their own and are left out.
    subprocess.run(
        [osmium, "export", str(glaciers), "-o", str(target), "-f", "geojsonseq",
         "--geometry-types=point,polygon", "--add-unique-id=type_id", "--overwrite"],
        check=True,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=Path("derived-data/glacier-names"))
    parser.add_argument("--only", choices=["sgi", "glims", "regions", "osm"], action="append")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    steps = args.only or ["sgi", "glims", "regions", "osm"]
    if "sgi" in steps:
        fetch_sgi(args.out)
    if "glims" in steps:
        fetch_glims(args.out)
    if "regions" in steps:
        fetch_regions(args.out)
    if "osm" in steps:
        fetch_osm(args.out)
