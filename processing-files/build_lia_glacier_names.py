#!/usr/bin/env python3
"""Give each LIA outline the names of the glaciers that lie inside it today.

Neither LIA outline set has a name field, and one LIA glacier has often split
into several glaciers since. So each LIA outline gets the names of the present
glaciers it contains, from the first source that has any. The glacier nearest
the LIA terminus (the lowest point of the LIA surface) comes first, the others
follow largest first:

1. ``sgi``: Swiss Glacier Inventory 2016 (GLAMOS), the official Swiss names.
2. ``osm``: OpenStreetMap ``natural=glacier``. Its ``name`` tag holds the local
   form, and both languages where a region is officially bilingual
   ("Suldenferner - Vedretta di Solda"); see ``osm_name``.
3. ``glims``: the national inventories in GLIMS, outlines from 1990 on.
   Inventory labels rather than map names ("Gepatsch Ferner", "du Tricot"),
   so they only fill gaps; cleaned by ``clean_glims_name``.
4. ``glims-lia``: GLIMS outlines from before 1900, which are the named LIA
   outlines of the Austrian and Swiss inventories. Used for LIA glaciers whose
   ice has gone completely.

A present glacier belongs to the LIA outline that holds most of it, and only
if that is at least ``MIN_SHARE`` of its area; points (OSM nodes) belong to the
outline they fall in. The outlines are buffered by ``BUFFER_M`` first, as
today's outlines and the LIA ones were not digitised on the same base.

Inputs come from ``fetch_glacier_name_sources.py``. Output: a CSV with
``LIA_ID``, ``names`` (joined by ``SEPARATOR``, in the order above),
``names_count`` and ``names_source``, read by ``build_lia_outlines_pmtiles.py``.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

CRS = "EPSG:32632"
BUFFER_M = 50.0
MIN_SHARE = 0.5
SEPARATOR = "; "
SOURCES = ["sgi", "osm", "glims", "glims-lia"]



# ---------- names ----------

def osm_name(tags: dict, langs: tuple[str, ...] = ()) -> str | None:
    """The local name. ``langs`` are the languages of an officially bilingual
    region the glacier lies in (``regions.geojson``): a language OSM keeps only
    in ``name:xx`` is added, so both appear, as they do on the map there."""
    name = (tags.get("name") or "").strip()
    parts = [name] if name else []
    for lang in langs:
        other = (tags.get(f"name:{lang}") or "").strip()
        if other and other.casefold() not in " ".join(parts).casefold():
            parts.append(other)
    name = " / ".join(parts)
    if not name:
        name = next((tags[k].strip() for k in ("name:de", "name:it", "name:fr") if tags.get(k)), "")
    return name or None


_ESCAPE = re.compile(r"\\x([0-9a-fA-F]{2})")
_CODE = re.compile(r"\b(?:[A-Z]{2}\d[A-Z]\d{5,}[A-Z0-9-]*)\b")
_PART = re.compile(r"(?:_\d+)+$")


def clean_glims_name(raw: str | None) -> str | None:
    """Tidy a GLIMS inventory label: escaped DOS characters, inventory codes,
    split-part suffixes, trailing commas, all-capitals."""
    if not raw:
        return None
    # "Schw\\x84rze" -> "Schwärze": bytes written out as text, code page 850.
    name = _ESCAPE.sub(lambda m: bytes([int(m.group(1), 16)]).decode("cp850"), raw)
    name = _CODE.sub("", name)
    name = _PART.sub("", name)
    name = re.sub(r"\s+", " ", name).strip(" ,;-")
    if name.isupper():
        name = name.title()
    return name or None


def name_key(name: str) -> str:
    """Loose identity for de-duplicating spellings: "Gepatsch Ferner" and
    "Gepatschferner" are the same glacier."""
    return re.sub(r"[^a-zà-ÿ]", "", name.casefold())


# ---------- sources ----------

def load_sgi(folder: Path):
    import geopandas as gpd

    frame = gpd.read_file(folder / "sgi2016" / "SGI_2016_glaciers.shp")
    frame = frame[frame["name"].notna() & (frame["name"].str.strip() != "")]
    return gpd.GeoDataFrame({"name": frame["name"].str.strip()}, geometry=frame.geometry, crs=frame.crs).to_crs(CRS)


def load_regions(folder: Path):
    """Bilingual regions as (polygon, languages), in lon/lat."""
    from shapely.geometry import shape

    path = folder / "regions.geojson"
    if not path.exists():
        return []
    return [
        (shape(f["geometry"]), tuple(f["properties"]["langs"].split(",")))
        for f in json.loads(path.read_text())["features"]
    ]


def load_osm(folder: Path):
    """Named OSM glaciers, from the osmium export (one GeoJSON feature per
    line, tags as properties)."""
    import geopandas as gpd
    from shapely.geometry import shape

    regions = load_regions(folder)
    names, geometries = [], []
    with (folder / "osm_glaciers.geojsonseq").open(encoding="utf-8") as lines:
        for line in lines:
            feature = json.loads(line.lstrip("\x1e"))
            tags = feature.get("properties") or {}
            if not any(key == "name" or key.startswith("name:") for key in tags):
                continue
            geometry = shape(feature["geometry"])
            if geometry.is_empty:
                continue
            point = geometry.representative_point()
            langs = next((langs for region, langs in regions if region.contains(point)), ())
            name = osm_name(tags, langs)
            if name:
                names.append(name)
                geometries.append(geometry)
    return gpd.GeoDataFrame({"name": names}, geometry=geometries, crs="EPSG:4326").to_crs(CRS)


def load_glims(folder: Path):
    """Two frames: outlines from 1990 on, and those before 1900."""
    import geopandas as gpd
    import pandas as pd

    frame = gpd.read_file(folder / "glims_alps.geojson")
    frame["name"] = frame["glac_name"].map(clean_glims_name)
    frame["year"] = pd.to_numeric(frame["src_date"].astype(str).str[:4], errors="coerce")
    frame = frame[frame["name"].notna()]
    # Several analyses per glacier: keep the latest of each era.
    frame = frame.sort_values("year")
    recent = frame[frame["year"] >= 1990].drop_duplicates("glac_id", keep="last")
    lia = frame[frame["year"] < 1900].drop_duplicates("glac_id", keep="last")
    pick = lambda f: gpd.GeoDataFrame({"name": f["name"].values}, geometry=f.geometry.values, crs=f.crs).to_crs(CRS)
    return pick(recent), pick(lia)


# ---------- matching ----------

def termini(outlines, surface_path: Path) -> dict:
    """LIA_ID -> the lowest LIA surface cell inside the outline: the LIA
    glacier's terminus, as a point in ``CRS``."""
    import numpy as np
    import rasterio
    import rasterio.mask
    from shapely.geometry import Point

    found = {}
    with rasterio.open(surface_path) as surface:
        if surface.crs.to_string() != CRS:
            raise ValueError(f"{surface_path}: expected {CRS}, got {surface.crs}")
        for lia_id, geometry in zip(outlines["LIA_ID"], outlines.geometry):
            values, transform = rasterio.mask.mask(surface, [geometry], crop=True, filled=False)
            band = values[0]
            if band.count() == 0:
                continue
            row, col = np.unravel_index(np.ma.argmin(band), band.shape)
            x, y = rasterio.transform.xy(transform, row, col)
            found[int(lia_id)] = Point(x, y)
    return found


def match(outlines, glaciers, ends: dict | None = None):
    """LIA_ID -> names. ``outlines`` holds ``LIA_ID`` and the buffered outline;
    ``glaciers`` holds ``name`` and today's geometry. The glacier nearest the
    LIA terminus in ``ends`` comes first, as an LIA glacier is known by its
    tongue (Mer de Glace, not the larger Glacier du Géant above it); the
    others follow, largest first."""
    import geopandas as gpd
    import pandas as pd

    glaciers = glaciers[glaciers.geometry.notna() & ~glaciers.geometry.is_empty].copy()
    glaciers["geometry"] = glaciers.geometry.make_valid()
    glaciers["gid"] = range(len(glaciers))
    points = glaciers[glaciers.geom_type == "Point"]
    areas = glaciers[glaciers.geom_type != "Point"].copy()
    areas["full_area"] = areas.geometry.area
    areas = areas[areas["full_area"] > 0]

    pieces = gpd.overlay(areas, outlines, how="intersection", keep_geom_type=True)
    pieces["inside"] = pieces.geometry.area
    pieces["share"] = pieces["inside"] / pieces["full_area"]
    # Each glacier goes to the outline holding most of it, if that is enough.
    pieces = pieces.sort_values("inside", ascending=False).drop_duplicates("gid")
    pieces = pieces[pieces["share"] >= MIN_SHARE][["LIA_ID", "name", "inside", "geometry"]]

    hits = gpd.sjoin(points, outlines, predicate="within")[["LIA_ID", "name", "geometry"]]
    hits["inside"] = 0.0  # after every polygon

    found = {}
    every = pd.concat([pieces, hits]).sort_values("inside", ascending=False)
    for lia_id, group in every.groupby("LIA_ID", sort=False):
        end = (ends or {}).get(int(lia_id))
        if end is not None and len(group) > 1:
            first = group.geometry.distance(end).to_numpy().argmin()
            group = pd.concat([group.iloc[[first]], group.drop(group.index[first])])
        names, keys = [], set()
        for name in group["name"]:
            if name_key(name) not in keys:
                keys.add(name_key(name))
                names.append(name)
        found[int(lia_id)] = names
    return found


def build(outlines_path: Path, folder: Path, output: Path, surface_path: Path | None = None) -> None:
    import geopandas as gpd
    import pandas as pd

    lia = gpd.read_file(outlines_path).to_crs(CRS)
    outlines = gpd.GeoDataFrame({"LIA_ID": lia["LIA_ID"].astype(int)}, geometry=lia.geometry.make_valid().buffer(BUFFER_M), crs=CRS)

    glims_recent, glims_lia = load_glims(folder)
    frames = {"sgi": load_sgi(folder), "osm": load_osm(folder), "glims": glims_recent, "glims-lia": glims_lia}
    # The unbuffered outline, so the terminus is on the LIA glacier itself.
    ends = termini(gpd.GeoDataFrame({"LIA_ID": outlines["LIA_ID"]}, geometry=lia.geometry.make_valid(), crs=CRS), surface_path) if surface_path else None
    matches = {source: match(outlines, frame, ends) for source, frame in frames.items()}
    for source in SOURCES:
        print(f"{source}: {len(frames[source])} named glaciers, names for {len(matches[source])} LIA outlines")

    rows = []
    for lia_id in outlines["LIA_ID"]:
        for source in SOURCES:
            names = matches[source].get(int(lia_id))
            if names:
                rows.append({"LIA_ID": int(lia_id), "names": SEPARATOR.join(names), "names_count": len(names), "names_source": source})
                break
    table = pd.DataFrame(rows, columns=["LIA_ID", "names", "names_count", "names_source"])
    output.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(output, index=False)
    print(f"wrote {output}: {len(table)} of {len(outlines)} LIA outlines named")
    print(table["names_source"].value_counts().to_string())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--outlines", type=Path,
        default=Path("original-data/Alps-wide_glacier_geometry_reconstruction_henz_et_al_2025_shapefile/evaluation-lia-updated-citations.shp"),
    )
    parser.add_argument("--sources", type=Path, default=Path("derived-data/glacier-names"))
    parser.add_argument(
        "--surface", type=Path,
        default=Path("original-data/Alps-wide_LIA_surface_elevation_with_glaciers_henz_et_al_2025.tif"),
        help="LIA surface DEM, for the terminus that decides the first name",
    )
    parser.add_argument("--output", type=Path, default=Path("derived-data/lia_glacier_names.csv"))
    args = parser.parse_args()
    build(args.outlines, args.sources, args.output, args.surface if args.surface.exists() else None)
