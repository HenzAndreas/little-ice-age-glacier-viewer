/*
 * The 3D terrain with the Little Ice Age glaciers in it, composed per tile in
 * the browser rather than baked into an archive.
 *
 * `lia-dem://{z}/{x}/{y}` answers with the Mapterhorn tile for z/x/y, and where
 * the LIA surface patch has ice it blends the LIA surface into it. Mapterhorn
 * keeps its full resolution (to z17, about 1 m) everywhere off the LIA ice; on
 * the ice the 50 m LIA surface is upsampled, which is the most detail it
 * carries. Only the patch archive (to z12) is ours to host: above
 * z12 a tile reads the window of its z12 ancestor that it covers.
 *
 * Tiles that touch no ice — most of the Alps — pass Mapterhorn's bytes
 * through untouched, so they cost what the online terrain costs.
 *
 * The patch is written by processing-files/build_lia_surface_patch.py: R and G
 * are the elevation, (R * 256 + G) * 0.1 - 1000 m; B is the blend weight, how
 * far the LIA surface replaces Mapterhorn, rising from ~0 at the LIA outline
 * to 1 at 150 m inside it; A is the ice mask. Only alpha == 255 pixels are
 * trusted: browsers decode into premultiplied canvases, which keeps opaque
 * pixels exact but destroys the RGB of transparent ones. That is why the
 * weight has a channel of its own rather than living in alpha.
 *
 * The module imports nothing: the archive, the Mapterhorn template and the
 * image codecs are handed in, so the blending runs under plain Node in tests.
 */

const PATCH_STEP = 0.1;
const PATCH_BASE = -1000;
const TERRARIUM_OFFSET = 32768;
const OPAQUE = 255;

export const LIA_DEM_TILES = "lia-dem://{z}/{x}/{y}";
const TILE_URL = /^lia-dem:\/\/(\d+)\/(\d+)\/(\d+)$/;

/* Decoded patch tiles shared by the tiles under them: one z12 tile answers
 * 1024 z17 tiles, and a viewport asks for many of them at once. */
const PATCH_CACHE_SIZE = 128;

/**
 * Where tile z/x/y reads the patch: the patch tile itself up to the archive's
 * maximum zoom, and above it the ancestor at that zoom, of which this tile is
 * the `col`, `row` cell in a `scale` × `scale` grid.
 */
export function patchWindow(z, x, y, patchMaxZoom) {
  const scale = 2 ** Math.max(0, z - patchMaxZoom);
  const px = Math.floor(x / scale);
  const py = Math.floor(y / scale);
  return { z: Math.min(z, patchMaxZoom), x: px, y: py, scale, col: x - px * scale, row: y - py * scale };
}

export const terrariumElevation = (r, g, b) => r * 256 + g + b / 256 - TERRARIUM_OFFSET;
export const patchElevation = (r, g) => (r * 256 + g) * PATCH_STEP + PATCH_BASE;

/** Writes `elevation` as Terrarium into `out` at byte offset `at`, opaque. */
export function writeTerrarium(out, at, elevation) {
  const n = Math.min(0xffffff, Math.max(0, Math.round((elevation + TERRARIUM_OFFSET) * 256)));
  out[at] = n >> 16;
  out[at + 1] = (n >> 8) & 255;
  out[at + 2] = n & 255;
  out[at + 3] = OPAQUE;
}

/** A decoded patch tile: elevations, blend weights, and which pixels are ice. */
export function decodePatch(rgba, size) {
  const elevation = new Float32Array(size * size);
  const weight = new Float32Array(size * size);
  const ice = new Uint8Array(size * size);
  let any = false;
  for (let p = 0; p < size * size; p++) {
    if (rgba[p * 4 + 3] !== OPAQUE) continue;
    elevation[p] = patchElevation(rgba[p * 4], rgba[p * 4 + 1]);
    weight[p] = rgba[p * 4 + 2] / 255;
    ice[p] = 1;
    any = true;
  }
  return { size, elevation, weight, ice, any };
}

/* The patch pixels a window samples, one pixel wider on each side for the
 * bilinear neighbours, clamped to the tile. */
function windowPixels(size, win) {
  const span = size / win.scale;
  return {
    c0: Math.max(0, Math.floor(win.col * span) - 1),
    c1: Math.min(size - 1, Math.ceil((win.col + 1) * span)),
    r0: Math.max(0, Math.floor(win.row * span) - 1),
    r1: Math.min(size - 1, Math.ceil((win.row + 1) * span)),
  };
}

export function windowHasIce(patch, win) {
  if (!patch.any) return false;
  const { c0, c1, r0, r1 } = windowPixels(patch.size, win);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) if (patch.ice[r * patch.size + c]) return true;
  }
  return false;
}

/* Catmull-Rom weights for the four samples around a point `t` of the way from
 * the second to the third. */
function cubicWeights(t, into) {
  const t2 = t * t;
  const t3 = t2 * t;
  into[0] = (-t3 + 2 * t2 - t) / 2;
  into[1] = (3 * t3 - 5 * t2 + 2) / 2;
  into[2] = (-3 * t3 + 4 * t2 + t) / 2;
  into[3] = (t3 - t2) / 2;
  return into;
}

/* Catmull-Rom over the 4 × 4 patch pixels around (u0 + fu, v0 + fv), or NaN
 * when any of them is off the ice or off the tile. Clamping at the tile edge
 * instead would overshoot there, by metres on a steep surface, and open a seam
 * against the neighbouring tile. */
function cubicSample(patch, u0, fu, v0, fv, wu, wv) {
  const P = patch.size;
  if (u0 < 1 || v0 < 1 || u0 + 2 >= P || v0 + 2 >= P) return NaN;
  cubicWeights(fu, wu);
  cubicWeights(fv, wv);
  let sum = 0;
  for (let b = 0; b < 4; b++) {
    const row = (v0 - 1 + b) * P;
    for (let a = 0; a < 4; a++) {
      const p = row + u0 - 1 + a;
      if (!patch.ice[p]) return NaN;
      sum += wu[a] * wv[b] * patch.elevation[p];
    }
  }
  return sum;
}

/**
 * Mapterhorn's Terrarium RGBA (`size` × `size`) with the patch window blended
 * in, as a new Terrarium RGBA array.
 *
 * Each output pixel samples the four nearest patch pixels. Only ice pixels
 * contribute elevation, renormalised over their bilinear weights, so the
 * transparent pixels' placeholder values never leak in. How far the LIA
 * surface replaces Mapterhorn is the patch's blend weight, interpolated
 * bilinearly with 0 off the ice: 1 well inside, fading to 0 at the outline.
 *
 * Where all sixteen surrounding pixels are ice the elevation is Catmull-Rom
 * instead. Bilinear makes every patch cell a near-planar facet, which a
 * hillshade shows as a grid of squares once a cell spans tens of output
 * pixels; Catmull-Rom has a continuous slope across cells.
 */
export function blendTile(base, size, patch, win) {
  const out = new Uint8ClampedArray(base);
  const P = patch.size;
  const last = P - 1;
  const step = P / win.scale / size;
  const originU = (win.col * P) / win.scale - 0.5;
  const originV = (win.row * P) / win.scale - 0.5;
  const wu = new Float64Array(4);
  const wv = new Float64Array(4);
  for (let j = 0; j < size; j++) {
    const v = originV + (j + 0.5) * step;
    const v0 = Math.floor(v);
    const fv = v - v0;
    const rows = [Math.min(last, Math.max(0, v0)), Math.min(last, Math.max(0, v0 + 1))];
    for (let i = 0; i < size; i++) {
      const u = originU + (i + 0.5) * step;
      const u0 = Math.floor(u);
      const fu = u - u0;
      const cols = [Math.min(last, Math.max(0, u0)), Math.min(last, Math.max(0, u0 + 1))];
      let iceWeight = 0;
      let sum = 0;
      let blend = 0;
      for (let b = 0; b < 2; b++) {
        const wv = b ? fv : 1 - fv;
        for (let a = 0; a < 2; a++) {
          const p = rows[b] * P + cols[a];
          if (!patch.ice[p]) continue;
          const w = (a ? fu : 1 - fu) * wv;
          iceWeight += w;
          sum += w * patch.elevation[p];
          blend += w * patch.weight[p];
        }
      }
      if (blend <= 0) continue;
      const at = (j * size + i) * 4;
      let lia = sum / iceWeight;
      if (iceWeight > 1 - 1e-9) {
        const smooth = cubicSample(patch, u0, fu, v0, fv, wu, wv);
        if (!Number.isNaN(smooth)) lia = smooth;
      }
      if (blend >= 1 - 1e-9) {
        writeTerrarium(out, at, lia);
        continue;
      }
      const below = terrariumElevation(base[at], base[at + 1], base[at + 2]);
      writeTerrarium(out, at, blend * lia + (1 - blend) * below);
    }
  }
  return out;
}

/**
 * The protocol handler, from its dependencies:
 *
 * - `baseTileUrl(z, x, y)` → Promise of the Mapterhorn tile URL;
 * - `fetchBytes(url, signal)` → Promise of an ArrayBuffer, rejecting on HTTP errors;
 * - `patch()` → Promise of `{ maxZoom, tile(z, x, y) }`, where `tile` resolves
 *   to the PNG bytes or undefined;
 * - `decode(bytes)` → Promise of `{ data, width }`, RGBA not premultiplied;
 * - `encode(rgba, size)` → Promise of PNG bytes.
 */
export function createLiaDemProtocol({ baseTileUrl, fetchBytes, patch, decode, encode }) {
  const cache = new Map();

  function patchTile(win, archive) {
    const key = `${win.z}/${win.x}/${win.y}`;
    let entry = cache.get(key);
    if (entry) {
      cache.delete(key);
    } else {
      entry = archive.tile(win.z, win.x, win.y).then(async (bytes) => {
        if (!bytes) return null;
        const { data, width } = await decode(bytes);
        return decodePatch(data, width);
      });
      // A failed read is not remembered, so the next tile tries again.
      entry.catch(() => cache.delete(key));
    }
    cache.set(key, entry);
    if (cache.size > PATCH_CACHE_SIZE) cache.delete(cache.keys().next().value);
    return entry;
  }

  return async function liaDemProtocol(params, abortController) {
    const at = TILE_URL.exec(params.url);
    if (at === null) throw new Error(`not a lia-dem tile URL: ${params.url}`);
    const [z, x, y] = [Number(at[1]), Number(at[2]), Number(at[3])];
    const signal = abortController?.signal;

    const [baseBytes, ice] = await Promise.all([
      baseTileUrl(z, x, y).then((url) => fetchBytes(url, signal)),
      patch().then(async (archive) => {
        const win = patchWindow(z, x, y, archive.maxZoom);
        const tile = await patchTile(win, archive);
        return tile && windowHasIce(tile, win) ? { tile, win } : null;
      }),
    ]);
    if (signal?.aborted) throw new DOMException("tile aborted", "AbortError");
    if (!ice) return { data: baseBytes };

    const base = await decode(baseBytes);
    if (signal?.aborted) throw new DOMException("tile aborted", "AbortError");
    return { data: await encode(blendTile(base.data, base.width, ice.tile, ice.win), base.width) };
  };
}

/* ---------- browser wiring ---------- */

async function decodeImage(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes]), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const { width, height } = bitmap;
  const context = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { data: context.getImageData(0, 0, width, height).data, width };
}

async function encodePng(rgba, size) {
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext("2d").putImageData(new ImageData(rgba, size, size), 0, 0);
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

async function fetchBytes(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

/**
 * The handler as the page registers it: Mapterhorn's tiles from its TileJSON,
 * the patch from a PMTiles archive read with the global `pmtiles` library.
 * Neither is touched until the first tile is asked for.
 */
export function browserLiaDemProtocol({ tilejsonUrl, patchUrl }) {
  let template = null;
  let archive = null;
  return createLiaDemProtocol({
    baseTileUrl: async (z, x, y) => {
      template ??= fetch(tilejsonUrl)
        .then((response) => response.json())
        .then((tilejson) => tilejson.tiles[0])
        .catch((error) => {
          template = null;
          throw error;
        });
      return (await template).replace("{z}", z).replace("{x}", x).replace("{y}", y);
    },
    fetchBytes,
    patch: () => {
      archive ??= (async () => {
        const reader = new pmtiles.PMTiles(new URL(patchUrl, document.baseURI).href);
        const { maxZoom } = await reader.getHeader();
        return {
          maxZoom,
          tile: async (z, x, y) => (await reader.getZxy(z, x, y))?.data,
        };
      })().catch((error) => {
        archive = null;
        throw error;
      });
      return archive;
    },
    decode: decodeImage,
    encode: encodePng,
  });
}
