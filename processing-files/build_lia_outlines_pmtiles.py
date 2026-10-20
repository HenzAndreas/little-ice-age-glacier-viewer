#!/usr/bin/env python3
"""Build the LIA glacier outline vector PMTiles for the viewer.

Reads the reconstructed outlines (ESRI Shapefile, EPSG:32632), keeps only the
attributes the viewer's popup shows, rounded to what is meaningful, and tiles
them with tippecanoe into one layer, ``lia_outlines``, z4-z13.

Kept attributes (units as in the source table):

- ``LIA_ID``: glacier identifier
- ``ela``: equilibrium-line altitude, m a.s.l.
- ``area``: modelled glacier area, km²
- ``Area_LIA``: area of the LIA outline, km²
- ``volume``: modelled glacier volume, km³
- ``lia_length``: glacier length, m
- ``Citation``: source of the LIA outline

The climate and topography fields stay in the source table and the CSV.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

LAYER = "lia_outlines"
# Column -> decimals kept. None keeps the value as it is.
FIELDS = {
    "LIA_ID": None,
    "ela": 0,
    "area": 3,
    "Area_LIA": 3,
    "volume": 5,
    "lia_length": 0,
    "Citation": None,
}
ATTRIBUTION = "LIA outlines: <a href=\"https://doi.org/10.5194/tc-19-753-2025\">Reinthaler and Paul (2025)</a>"


def popup_table(frame):
    """The outline table reduced to the popup fields, rounded."""
    missing = [name for name in FIELDS if name not in frame.columns]
    if missing:
        raise ValueError(f"outline table lacks {', '.join(missing)}")
    table = frame[list(FIELDS) + ["geometry"]].copy()
    for name, decimals in FIELDS.items():
        if decimals is not None:
            table[name] = table[name].round(decimals)
            if decimals == 0:
                table[name] = table[name].astype("Int64")
    table["LIA_ID"] = table["LIA_ID"].astype("int64")
    return table


def find_tippecanoe() -> str:
    found = shutil.which("tippecanoe") or str(Path(sys.executable).parent / "tippecanoe")
    if not Path(found).is_file():
        raise RuntimeError("tippecanoe not found; install it from conda-forge into this environment")
    return found


def build(input_path: Path, output_path: Path) -> None:
    import geopandas as gpd

    frame = gpd.read_file(input_path)
    if frame.crs is None:
        raise ValueError(f"{input_path}: no CRS")
    frame = frame[frame.geometry.notna() & ~frame.geometry.is_empty]
    table = popup_table(frame).to_crs("EPSG:4326")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lia-outlines-") as temp:
        geojson = Path(temp) / "outlines.geojson"
        table.to_file(geojson, driver="GeoJSON", index=False)
        subprocess.run(
            [
                find_tippecanoe(),
                "--output", str(output_path),
                "--force",
                "--layer", LAYER,
                "--name", "Alps-wide LIA glacier outlines",
                "--attribution", ATTRIBUTION,
                "--minimum-zoom", "4",
                "--maximum-zoom", "13",
                "--detect-shared-borders",
                "--drop-smallest-as-needed",
                "--quiet",
                str(geojson),
            ],
            check=True,
        )
    print(f"wrote {output_path}: {len(table)} outlines, {output_path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "input", nargs="?", type=Path,
        default=Path("original-data/Alps-wide_glacier_geometry_reconstruction_henz_et_al_2025_shapefile/evaluation-lia-updated-citations.shp"),
    )
    parser.add_argument("output", nargs="?", type=Path, default=Path("local-data/Alps-wide_LIA_outlines.pmtiles"))
    args = parser.parse_args()
    build(args.input, args.output)
