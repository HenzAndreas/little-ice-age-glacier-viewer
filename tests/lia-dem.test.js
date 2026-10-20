/*
 * The `lia-dem://` protocol: Mapterhorn with the LIA surface blended in.
 *
 * js/lia-dem.js imports nothing and takes its archive, its fetch and its image
 * codecs as arguments, so these tests drive it with synthetic tiles and raw
 * RGBA arrays in place of PNG and WebP — no DOM, no network, no source TIFFs.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  blendTile,
  createLiaDemProtocol,
  decodePatch,
  patchWindow,
  terrariumElevation,
  windowHasIce,
  writeTerrarium,
} from "../js/lia-dem.js";

const BASE = 8; // Mapterhorn tile size, scaled down from 512
const PATCH = 4; // patch tile size, scaled down from 256

/* A Terrarium tile at one elevation. */
function terrariumTile(size, elevation) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < size * size; p++) writeTerrarium(rgba, p * 4, elevation);
  return rgba;
}

/* One patch pixel as processing-files/build_lia_surface_patch.py writes it:
 * elevation in R, G; blend weight in B; alpha 255 on the ice. */
function setPatchPixel(rgba, at, elevation, weight = 1) {
  const n = Math.round((elevation + 1000) * 10);
  rgba.set([n >> 8, n & 255, Math.round(weight * 255), 255], at);
}

/* A patch tile: `ice(col, row)` decides the mask. Off-ice pixels are all zero
 * (elevation -1000 m) with alpha 0. */
function patchTile(size, elevation, ice, weight = 1) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (ice(col, row)) setPatchPixel(rgba, (row * size + col) * 4, elevation, weight);
    }
  }
  return rgba;
}

const elevations = (rgba) => {
  const out = [];
  for (let at = 0; at < rgba.length; at += 4) out.push(terrariumElevation(rgba[at], rgba[at + 1], rgba[at + 2]));
  return out;
};
const close = (actual, expected, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test("a tile reads its own patch tile up to the patch's maximum zoom", () => {
  assert.deepEqual(patchWindow(9, 267, 180, 12), { z: 9, x: 267, y: 180, scale: 1, col: 0, row: 0 });
  assert.deepEqual(patchWindow(12, 2139, 1446, 12), { z: 12, x: 2139, y: 1446, scale: 1, col: 0, row: 0 });
});

test("above the patch's maximum zoom a tile reads its cell of the ancestor", () => {
  // z17 68467/46287 sits in z12 2139/1446, cell (19, 15) of a 32 × 32 grid.
  assert.deepEqual(patchWindow(17, 68467, 46287, 12), { z: 12, x: 2139, y: 1446, scale: 32, col: 19, row: 15 });
});

test("Terrarium round-trips an elevation to its 1/256 m step", () => {
  const rgba = new Uint8ClampedArray(4);
  for (const elevation of [-412.3, 0, 1234.567, 4808.72]) {
    writeTerrarium(rgba, 0, elevation);
    close(terrariumElevation(rgba[0], rgba[1], rgba[2]), elevation, 1 / 256);
    assert.equal(rgba[3], 255);
  }
});

test("inside the ice the LIA surface replaces Mapterhorn", () => {
  const patch = decodePatch(patchTile(PATCH, 2500.3, () => true), PATCH);
  const out = elevations(blendTile(terrariumTile(BASE, 1800), BASE, patch, patchWindow(12, 0, 0, 12)));
  for (const value of out) close(value, 2500.3);
});

test("the blend weight sets how far the LIA surface replaces Mapterhorn", () => {
  // Weight 0.4 everywhere, as in the feathered band just inside an outline.
  const patch = decodePatch(patchTile(PATCH, 2500, () => true, 0.4), PATCH);
  const out = elevations(blendTile(terrariumTile(BASE, 1800), BASE, patch, patchWindow(12, 0, 0, 12)));
  const expected = 1800 + (Math.round(0.4 * 255) / 255) * (2500 - 1800);
  for (const value of out) close(value, expected, 0.05);
});

test("off the ice Mapterhorn is untouched, and the placeholder never leaks in", () => {
  // Ice in the left half of the patch only.
  const patch = decodePatch(patchTile(PATCH, 2500, (col) => col < 2), PATCH);
  const base = terrariumTile(BASE, 1800);
  const out = blendTile(base, BASE, patch, patchWindow(12, 0, 0, 12));
  const values = elevations(out);
  for (let row = 0; row < BASE; row++) {
    const line = values.slice(row * BASE, (row + 1) * BASE);
    // Far left: ice. Far right: Mapterhorn, byte for byte.
    close(line[0], 2500);
    close(line[BASE - 1], 1800);
    assert.deepEqual(out.slice((row * BASE + BASE - 2) * 4, (row + 1) * BASE * 4), base.slice((row * BASE + BASE - 2) * 4, (row + 1) * BASE * 4));
    // The margin is a ramp between the two, never below either.
    for (let i = 1; i < BASE; i++) assert.ok(line[i] <= line[i - 1] + 1e-6, `not monotone at ${i}: ${line}`);
    assert.ok(Math.min(...line) >= 1800 - 0.01);
  }
});

test("above z12 the window is upsampled from the ancestor's cell", () => {
  // Ice elevation rises 100 m per patch column.
  const rgba = new Uint8ClampedArray(PATCH * PATCH * 4);
  for (let row = 0; row < PATCH; row++) {
    for (let col = 0; col < PATCH; col++) setPatchPixel(rgba, (row * PATCH + col) * 4, 2000 + 100 * col);
  }
  const patch = decodePatch(rgba, PATCH);
  // z13 tile (1, 0) of z12 (0, 0): the right half, patch columns 2–3.
  const values = elevations(blendTile(terrariumTile(BASE, 0), BASE, patch, patchWindow(13, 1, 0, 12)));
  const line = values.slice(0, BASE);
  assert.ok(line[0] > 2150 && line[0] < 2250, `left edge ${line[0]}`);
  close(line[BASE - 1], 2300); // clamped at the tile edge
  for (let i = 1; i < BASE; i++) assert.ok(line[i] >= line[i - 1]);
});

test("inside the ice a curved surface is interpolated smoothly, not in facets", () => {
  // A valley-shaped surface, quadratic across the patch columns. Catmull-Rom
  // reproduces quadratics exactly; bilinear would sag up to 2.5 m between
  // samples and break the slope at each one.
  const size = 8;
  const height = (u) => 2000 + 10 * u * u;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) setPatchPixel(rgba, (row * size + col) * 4, height(col));
  }
  const out = elevations(blendTile(terrariumTile(32, 0), 32, decodePatch(rgba, size), patchWindow(12, 0, 0, 12)));
  // Output pixel i sits at patch column u = (i + 0.5) / 4 - 0.5. Away from the
  // tile edges, where the samples are clamped, it follows the quadratic.
  for (let i = 6; i < 26; i++) close(out[16 * 32 + i], height((i + 0.5) / 4 - 0.5), 0.15);
});

test("a window with no ice in it is recognised before any blending", () => {
  // Ice only in the top-left patch pixel.
  const patch = decodePatch(patchTile(PATCH, 2500, (col, row) => col === 0 && row === 0), PATCH);
  assert.equal(windowHasIce(patch, patchWindow(12, 0, 0, 12)), true);
  assert.equal(windowHasIce(patch, patchWindow(14, 0, 0, 12)), true);
  assert.equal(windowHasIce(patch, patchWindow(14, 3, 3, 12)), false);
  assert.equal(windowHasIce(decodePatch(new Uint8ClampedArray(PATCH * PATCH * 4), PATCH), patchWindow(12, 0, 0, 12)), false);
});

/* The protocol with recording fakes: "PNG bytes" are objects that decode to
 * the RGBA they carry. */
function harness({ patchTiles = {}, maxZoom = 12 } = {}) {
  const calls = { fetched: [], patchReads: [], decoded: 0, encoded: 0 };
  const baseRgba = terrariumTile(BASE, 1800);
  const protocol = createLiaDemProtocol({
    baseTileUrl: async (z, x, y) => `https://tiles.example/${z}/${x}/${y}.webp`,
    fetchBytes: async (url) => {
      calls.fetched.push(url);
      return { rgba: baseRgba, width: BASE, url };
    },
    patch: async () => ({
      maxZoom,
      tile: async (z, x, y) => {
        calls.patchReads.push(`${z}/${x}/${y}`);
        const rgba = patchTiles[`${z}/${x}/${y}`];
        return rgba && { rgba, width: PATCH };
      },
    }),
    decode: async (bytes) => {
      calls.decoded++;
      return { data: bytes.rgba, width: bytes.width };
    },
    encode: async (rgba, size) => {
      calls.encoded++;
      return { rgba, size };
    },
  });
  return { protocol, calls };
}

test("tiles outside the patch pass Mapterhorn's bytes through", async () => {
  const { protocol, calls } = harness();
  const { data } = await protocol({ url: "lia-dem://15/17116/11571" });
  assert.equal(data.url, "https://tiles.example/15/17116/11571.webp");
  assert.equal(calls.encoded, 0);
  assert.equal(calls.decoded, 0);
});

test("tiles on the ice come back blended and re-encoded", async () => {
  const ice = patchTile(PATCH, 2600, () => true);
  const { protocol, calls } = harness({ patchTiles: { "12/2139/1446": ice } });
  const { data } = await protocol({ url: "lia-dem://17/68467/46287" });
  assert.equal(calls.encoded, 1);
  assert.equal(data.size, BASE);
  for (const value of elevations(data.rgba)) close(value, 2600);
});

test("one decoded patch tile serves every tile under it", async () => {
  const ice = patchTile(PATCH, 2600, () => true);
  const { protocol, calls } = harness({ patchTiles: { "12/0/0": ice } });
  await Promise.all([0, 1, 2, 3].map((x) => protocol({ url: `lia-dem://14/${x}/0` })));
  assert.deepEqual(calls.patchReads, ["12/0/0"]);
  assert.equal(calls.encoded, 4);
});

test("an aborted tile is not encoded", async () => {
  const ice = patchTile(PATCH, 2600, () => true);
  const { protocol, calls } = harness({ patchTiles: { "12/0/0": ice } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(protocol({ url: "lia-dem://12/0/0" }, controller), { name: "AbortError" });
  assert.equal(calls.encoded, 0);
});

test("a URL of another shape is refused", async () => {
  const { protocol } = harness();
  await assert.rejects(protocol({ url: "lia-dem://12/0" }), /not a lia-dem tile URL/);
});
