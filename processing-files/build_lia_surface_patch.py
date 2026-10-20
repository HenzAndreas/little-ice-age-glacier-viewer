#!/usr/bin/env python3
"""Build the Alps-wide LIA surface patch PMTiles read by the 3D terrain.

The patch covers the thickness raster's extent, z0-z12, and holds tiles only
where there is LIA ice. Each 256 px PNG carries:

- R, G: the LIA surface elevation, ``(R * 256 + G) * 0.1 - 1000`` metres, i.e.
  MapLibre ``raster-dem`` encoding ``custom`` with ``redFactor 25.6``,
  ``greenFactor 0.1``, ``blueFactor 0`` and ``baseShift 1000``;
- B: the blend weight, 0-255, with which the LIA surface replaces the base DEM;
- A: 255 on LIA ice, 0 elsewhere (RGB zero there).

The weight is a smoothstep of the distance inside the LIA outline, reaching 1
at ``--feather`` metres. The browser blends Mapterhorn into the LIA surface
over that band instead of stepping at the outline, where the model's DEM and
Mapterhorn disagree. It is kept out of the alpha channel because browsers
premultiply alpha on decode, which corrupts the RGB of partly transparent
pixels; alpha stays a strict 0/255 mask.

z12 is warped from the 50 m EPSG:32632 sources (bilinear). Lower zooms are
averaged from their four children, the elevation weighted by the blend weight.
"""

from __future__ import annotations

import argparse
import io
import time
from pathlib import Path

import numpy as np

ELEVATION_BASE = -1000.0  # metres at R = G = 0
ELEVATION_STEP = 0.1  # metres per unit of R * 256 + G
TILE = 256
WEB_MERCATOR_HALF = 20037508.342789244
ENCODING = {
    "encoding": "custom",
    "redFactor": 25.6,
    "greenFactor": 0.1,
    "blueFactor": 0,
    "baseShift": 1000,
}


def blend_weight(ice: np.ndarray, pixel_size: float, feather: float) -> np.ndarray:
    """Smoothstep of the distance inside the ice, 0 off the ice, 1 at `feather` m.

    Distances are measured to the outline, half a pixel beyond the centre of the
    last ice pixel, so an edge pixel already carries a small weight.
    """
    from scipy.ndimage import distance_transform_edt

    if not ice.any():
        return np.zeros(ice.shape, np.float32)
    inside = distance_transform_edt(ice) * pixel_size - pixel_size / 2
    t = np.clip(inside / feather, 0.0, 1.0)
    return np.where(ice, t * t * (3 - 2 * t), 0.0).astype(np.float32)


def encode_tile(surface: np.ndarray, weight: np.ndarray) -> bytes | None:
    """One patch PNG, or None when no pixel carries a weight."""
    from PIL import Image

    blue = np.round(np.clip(weight, 0, 1) * 255).astype(np.uint8)
    ice = blue > 0
    if not ice.any():
        return None
    units = np.round((np.nan_to_num(surface) - ELEVATION_BASE) / ELEVATION_STEP)
    units = np.clip(units, 0, 65535).astype(np.uint32)
    rgba = np.zeros(surface.shape + (4,), np.uint8)
    rgba[..., 0] = np.where(ice, units >> 8, 0)
    rgba[..., 1] = np.where(ice, units & 255, 0)
    rgba[..., 2] = blue
    rgba[..., 3] = np.where(ice, 255, 0)
    out = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(out, format="PNG", optimize=True)
    return out.getvalue()


def decode_tile(png: bytes) -> tuple[np.ndarray, np.ndarray]:
    """The inverse of `encode_tile`: elevation (NaN off the ice) and weight."""
    from PIL import Image

    rgba = np.asarray(Image.open(io.BytesIO(png)).convert("RGBA")).astype(np.float64)
    ice = rgba[..., 3] == 255
    elevation = (rgba[..., 0] * 256 + rgba[..., 1]) * ELEVATION_STEP + ELEVATION_BASE
    return np.where(ice, elevation, np.nan), np.where(ice, rgba[..., 2] / 255, 0.0)


def downsample(children: dict[tuple[int, int], tuple[np.ndarray, np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    """A parent tile from its up-to-four children, keyed by (dx, dy) in {0, 1}.

    The weight is the plain 2 × 2 mean, missing children counting as 0. The
    elevation is the weight-weighted mean, so off-ice values do not drag it.
    """
    surface = np.zeros((2 * TILE, 2 * TILE), np.float64)
    weight = np.zeros((2 * TILE, 2 * TILE), np.float64)
    for (dx, dy), (s, w) in children.items():
        rows = slice(dy * TILE, (dy + 1) * TILE)
        cols = slice(dx * TILE, (dx + 1) * TILE)
        surface[rows, cols] = np.nan_to_num(s)
        weight[rows, cols] = w
    blocks = lambda a: a.reshape(TILE, 2, TILE, 2).sum(axis=(1, 3))
    total = blocks(weight)
    mean = np.divide(blocks(surface * weight), total, out=np.zeros((TILE, TILE)), where=total > 0)
    return mean.astype(np.float32), (total / 4).astype(np.float32)


def tile_pixel_size(zoom: int) -> float:
    return 2 * WEB_MERCATOR_HALF / (TILE * 2**zoom)


def build(surface_path: Path, thickness_path: Path, output_path: Path, max_zoom: int, feather: float) -> None:
    import mercantile
    import rasterio
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer
    from rasterio.enums import Resampling
    from rasterio.transform import Affine
    from rasterio.warp import reproject, transform_bounds
    from rasterio.windows import from_bounds

    started = time.monotonic()
    log = lambda message: print(f"[{time.monotonic() - started:6.1f} s] {message}", flush=True)

    with rasterio.open(thickness_path) as thickness_src, rasterio.open(surface_path) as surface_src:
        for src in (thickness_src, surface_src):
            if src.crs is None or src.crs.to_epsg() != 32632:
                raise ValueError(f"{src.name}: expected EPSG:32632, got {src.crs}")
        if thickness_src.res != surface_src.res:
            raise ValueError("thickness and surface must share a pixel size")
        crs, transform = thickness_src.crs, thickness_src.transform
        pixel_size = thickness_src.res[0]
        thickness = thickness_src.read(1)
        window = from_bounds(*thickness_src.bounds, transform=surface_src.transform).round_offsets().round_lengths()
        surface = surface_src.read(1, window=window)
        if surface.shape != thickness.shape:
            raise ValueError(f"surface window {surface.shape} does not match thickness {thickness.shape}")
        lonlat = transform_bounds(crs, "EPSG:4326", *thickness_src.bounds)
    log(f"read {thickness.shape[1]} x {thickness.shape[0]} px at {pixel_size} m")

    ice = np.isfinite(thickness) & (thickness > 0)
    del thickness
    weight = blend_weight(ice, pixel_size, feather)
    surface = np.where(np.isfinite(surface), surface, np.nan).astype(np.float32)
    log(f"blend weight: {ice.sum()} ice px, feather {feather:g} m")

    # The z12 grid: every z12 tile the thickness extent touches.
    corner = mercantile.tile(lonlat[0], lonlat[3], max_zoom)
    far = mercantile.tile(lonlat[2], lonlat[1], max_zoom)
    columns, rows = far.x - corner.x + 1, far.y - corner.y + 1
    size = tile_pixel_size(max_zoom)
    grid = Affine(size, 0, -WEB_MERCATOR_HALF + corner.x * TILE * size, 0, -size, WEB_MERCATOR_HALF - corner.y * TILE * size)
    shape = (rows * TILE, columns * TILE)
    warped_surface = np.full(shape, np.nan, np.float32)
    warped_weight = np.zeros(shape, np.float32)
    for source, destination in ((surface, warped_surface), (weight, warped_weight)):
        reproject(
            source, destination,
            src_transform=transform, src_crs=crs,
            dst_transform=grid, dst_crs="EPSG:3857",
            resampling=Resampling.bilinear, num_threads=8,
        )
    del surface, weight, ice
    log(f"warped to {columns} x {rows} z{max_zoom} tiles ({shape[1]} x {shape[0]} px)")

    level: dict[tuple[int, int], tuple[np.ndarray, np.ndarray]] = {}
    for row in range(rows):
        for column in range(columns):
            window_rows = slice(row * TILE, (row + 1) * TILE)
            window_cols = slice(column * TILE, (column + 1) * TILE)
            w = warped_weight[window_rows, window_cols]
            if np.round(w.max() * 255) < 1:
                continue
            level[(corner.x + column, corner.y + row)] = (warped_surface[window_rows, window_cols].copy(), w.copy())
    del warped_surface, warped_weight
    log(f"z{max_zoom}: {len(level)} tiles with ice")

    tiles: dict[int, bytes] = {}
    for zoom in range(max_zoom, -1, -1):
        for (x, y), (s, w) in level.items():
            png = encode_tile(s, w)
            if png is not None:
                tiles[zxy_to_tileid(zoom, x, y)] = png
        if zoom == 0:
            break
        parents: dict[tuple[int, int], dict] = {}
        for (x, y), data in level.items():
            parents.setdefault((x // 2, y // 2), {})[(x % 2, y % 2)] = data
        level = {key: downsample(children) for key, children in parents.items()}
        log(f"z{zoom}: encoded; z{zoom - 1}: {len(level)} tiles")

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
                "name": "Alps-wide LIA glacier surface patch",
                "format": "png",
                "type": "terrain",
                **ENCODING,
                "channels": "R,G elevation; B blend weight x255; A ice mask",
                "feather_m": feather,
                "surface": surface_path.name,
                "mask": thickness_path.name,
                "attribution": "LIA surface: <a href=\"https://doi.org/10.5194/tc-19-5913-2025\">Henz et al. (2025)</a>",
            },
        )
    total = sum(len(png) for png in tiles.values())
    log(f"wrote {output_path}: {len(tiles)} tiles, {total / 1e6:.1f} MB of PNG")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("surface", nargs="?", type=Path, default=Path("original-data/Alps-wide_LIA_surface_elevation_with_glaciers_henz_et_al_2025.tif"))
    parser.add_argument("thickness", nargs="?", type=Path, default=Path("original-data/Alps-wide_LIA_glacier_thickness_henz_et_al_2025.tif"))
    parser.add_argument("output", nargs="?", type=Path, default=Path("local-data/Alps-wide_LIA_surface_patch.pmtiles"))
    parser.add_argument("--max-zoom", type=int, default=12)
    parser.add_argument("--feather", type=float, default=150.0, help="metres inside the outline at which the LIA surface fully replaces the base DEM")
    args = parser.parse_args()
    build(args.surface, args.thickness, args.output, args.max_zoom, args.feather)
