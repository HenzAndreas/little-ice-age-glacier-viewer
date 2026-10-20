#!/usr/bin/env python3
"""Build the LIA thickness display PMTiles with soft glacier margins.

A colour raster for display only: the thickness values are coloured with the
ramp and stretch of the layer record in ``data/lia-layers.json``, so the
legend and the tiles cannot drift apart. The scientific values stay in the
source TIFF.

The 50 m ice mask is blurred (Gaussian, ``--edge-sigma`` metres) and passed
through a smoothstep before it becomes alpha. Margins are anti-aliased and the
50 m stair steps are rounded off, instead of showing as blocks once zoomed in
past the data's resolution. Partial alpha is fine here, unlike in the surface
patch: these RGB values are colours, not encoded elevations.

z12 is warped from EPSG:32632 (bilinear). Lower zooms are averaged from their
children, the thickness weighted by alpha.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_lia_surface_patch import TILE, WEB_MERCATOR_HALF, downsample, tile_pixel_size  # noqa: E402

LAYER_ID = "lia-thickness"


def soft_alpha(ice: np.ndarray, pixel_size: float, sigma: float) -> np.ndarray:
    """0-1 opacity: the ice mask blurred by `sigma` metres, then sharpened back
    with a smoothstep so the interior stays opaque and the edge stays near the
    outline."""
    from scipy.ndimage import gaussian_filter

    blurred = gaussian_filter(ice.astype(np.float32), sigma / pixel_size)
    t = np.clip((blurred - 0.2) / 0.6, 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def ramp(stops: list[str]):
    """A function mapping 0-1 to RGB along evenly spaced hex colour stops."""
    rgb = np.array([[int(c[i : i + 2], 16) for i in (1, 3, 5)] for c in stops], np.float32)
    positions = np.linspace(0, 1, len(stops))

    def colour(scale: np.ndarray) -> np.ndarray:
        return np.stack([np.interp(scale, positions, rgb[:, k]) for k in range(3)], axis=-1)

    return colour


def encode_tile(thickness: np.ndarray, alpha: np.ndarray, colour, vmin: float, vmax: float) -> bytes | None:
    from PIL import Image

    a = np.round(np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    if not a.any():
        return None
    scale = np.clip((np.nan_to_num(thickness) - vmin) / max(vmax - vmin, 1e-9), 0, 1)
    rgba = np.dstack((np.round(colour(scale)).astype(np.uint8), a))
    out = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(out, format="PNG", optimize=True)
    return out.getvalue()


def layer_record(manifest: Path) -> dict:
    layers = json.loads(manifest.read_text())["layers"]
    for layer in layers:
        if layer["id"] == LAYER_ID:
            return layer
    raise ValueError(f"{manifest} has no layer {LAYER_ID}")


def build(thickness_path: Path, output_path: Path, manifest: Path, max_zoom: int, sigma: float) -> None:
    import mercantile
    import rasterio
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer
    from rasterio.enums import Resampling
    from rasterio.transform import Affine
    from rasterio.warp import reproject, transform_bounds

    started = time.monotonic()
    log = lambda message: print(f"[{time.monotonic() - started:6.1f} s] {message}", flush=True)
    record = layer_record(manifest)
    colour = ramp(record["colors"])
    vmin, vmax = float(record["vmin"]), float(record["vmax"])

    with rasterio.open(thickness_path) as src:
        if src.crs is None or src.crs.to_epsg() != 32632:
            raise ValueError(f"{src.name}: expected EPSG:32632, got {src.crs}")
        thickness = src.read(1)
        crs, transform, pixel_size = src.crs, src.transform, src.res[0]
        lonlat = transform_bounds(crs, "EPSG:4326", *src.bounds)
    ice = np.isfinite(thickness) & (thickness > 0)
    thickness = np.where(ice, thickness, 0).astype(np.float32)
    alpha = soft_alpha(ice, pixel_size, sigma)
    del ice
    log(f"read and softened {thickness.shape[1]} x {thickness.shape[0]} px, sigma {sigma:g} m")

    corner = mercantile.tile(lonlat[0], lonlat[3], max_zoom)
    far = mercantile.tile(lonlat[2], lonlat[1], max_zoom)
    columns, rows = far.x - corner.x + 1, far.y - corner.y + 1
    size = tile_pixel_size(max_zoom)
    grid = Affine(size, 0, -WEB_MERCATOR_HALF + corner.x * TILE * size, 0, -size, WEB_MERCATOR_HALF - corner.y * TILE * size)
    shape = (rows * TILE, columns * TILE)
    warped_thickness = np.zeros(shape, np.float32)
    warped_alpha = np.zeros(shape, np.float32)
    for source, destination in ((thickness, warped_thickness), (alpha, warped_alpha)):
        reproject(source, destination, src_transform=transform, src_crs=crs, dst_transform=grid, dst_crs="EPSG:3857", resampling=Resampling.bilinear, num_threads=8)
    del thickness, alpha
    log(f"warped to {columns} x {rows} z{max_zoom} tiles")

    level = {}
    for row in range(rows):
        for column in range(columns):
            r = slice(row * TILE, (row + 1) * TILE)
            c = slice(column * TILE, (column + 1) * TILE)
            a = warped_alpha[r, c]
            if np.round(a.max() * 255) < 1:
                continue
            level[(corner.x + column, corner.y + row)] = (warped_thickness[r, c].copy(), a.copy())
    del warped_thickness, warped_alpha

    tiles: dict[int, bytes] = {}
    for zoom in range(max_zoom, -1, -1):
        for (x, y), (t, a) in level.items():
            png = encode_tile(t, a, colour, vmin, vmax)
            if png is not None:
                tiles[zxy_to_tileid(zoom, x, y)] = png
        log(f"z{zoom}: {len(level)} tiles")
        if zoom == 0:
            break
        parents: dict = {}
        for (x, y), data in level.items():
            parents.setdefault((x // 2, y // 2), {})[(x % 2, y % 2)] = data
        level = {key: downsample(children) for key, children in parents.items()}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as handle:
        writer = Writer(handle)
        for tile_id in sorted(tiles):
            writer.write_tile(tile_id, tiles[tile_id])
        writer.finalize(
            {
                "tile_compression": Compression.NONE,
                "tile_type": TileType.PNG,
                "min_zoom": 0,
                "max_zoom": max_zoom,
                "min_lon_e7": round(lonlat[0] * 1e7),
                "min_lat_e7": round(lonlat[1] * 1e7),
                "max_lon_e7": round(lonlat[2] * 1e7),
                "max_lat_e7": round(lonlat[3] * 1e7),
                "center_zoom": 7,
                "center_lon_e7": round((lonlat[0] + lonlat[2]) / 2 * 1e7),
                "center_lat_e7": round((lonlat[1] + lonlat[3]) / 2 * 1e7),
            },
            {
                "name": "Alps-wide LIA glacier thickness (display)",
                "format": "png",
                "type": "overlay",
                "source": thickness_path.name,
                "stretch_m": [vmin, vmax],
                "colors": record["colors"],
                "edge_sigma_m": sigma,
                "attribution": "LIA thickness: <a href=\"https://doi.org/10.5194/tc-19-5913-2025\">Henz et al. (2025)</a>",
            },
        )
    log(f"wrote {output_path}: {len(tiles)} tiles, {sum(map(len, tiles.values())) / 1e6:.1f} MB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("thickness", nargs="?", type=Path, default=Path("original-data/Alps-wide_LIA_glacier_thickness_henz_et_al_2025.tif"))
    parser.add_argument("output", nargs="?", type=Path, default=Path("local-data/Alps-wide_LIA_glacier_thickness_soft.pmtiles"))
    parser.add_argument("--manifest", type=Path, default=Path("data/lia-layers.json"))
    parser.add_argument("--max-zoom", type=int, default=12)
    parser.add_argument("--edge-sigma", type=float, default=40.0, help="Gaussian blur of the ice mask, metres")
    args = parser.parse_args()
    build(args.thickness, args.output, args.manifest, args.max_zoom, args.edge_sigma)
