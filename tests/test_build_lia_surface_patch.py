"""The LIA surface patch generator, on small synthetic arrays.

Runs without the source TIFFs. Skipped where numpy, scipy or Pillow are missing
(the pixi environment has none of them; the conversion env does).
"""

import importlib.util
import unittest
from pathlib import Path

try:
    import numpy as np
    import PIL  # noqa: F401
    import scipy  # noqa: F401
except ImportError:  # pragma: no cover - depends on the environment
    np = None

SCRIPT = Path(__file__).resolve().parent.parent / "processing-files" / "build_lia_surface_patch.py"


def load():
    spec = importlib.util.spec_from_file_location("build_lia_surface_patch", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipIf(np is None, "numpy, scipy and Pillow are needed")
class BuildLiaSurfacePatchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = load()

    def test_weight_is_zero_off_ice_and_rises_to_one_inside(self):
        ice = np.zeros((40, 40), bool)
        ice[5:35, 5:35] = True
        weight = self.build.blend_weight(ice, pixel_size=50.0, feather=150.0)
        self.assertEqual(weight[~ice].max(), 0)
        # Edge pixels: 25 m inside the outline, a small but non-zero weight.
        self.assertGreater(weight[20, 5], 0)
        self.assertLess(weight[20, 5], 0.2)
        # 175 m inside and beyond: fully LIA.
        self.assertEqual(weight[20, 9], 1)
        self.assertEqual(weight[20, 20], 1)
        row = weight[20, 5:10]
        self.assertTrue(np.all(np.diff(row) >= 0))

    def test_tiles_round_trip_elevation_and_weight(self):
        surface = np.linspace(-500, 4800, 256 * 256, dtype=np.float32).reshape(256, 256)
        weight = np.zeros((256, 256), np.float32)
        weight[:, 100:] = np.linspace(0.05, 1, 156)
        png = self.build.encode_tile(surface, weight)
        elevation, decoded = self.build.decode_tile(png)
        self.assertTrue(np.all(np.isnan(elevation[:, :100])))
        self.assertTrue(np.all(decoded[:, :100] == 0))
        self.assertLessEqual(np.abs(elevation[:, 100:] - surface[:, 100:]).max(), 0.05 + 1e-3)
        self.assertLessEqual(np.abs(decoded[:, 100:] - weight[:, 100:]).max(), 0.5 / 255 + 1e-6)

    def test_a_tile_without_weight_is_not_written(self):
        self.assertIsNone(self.build.encode_tile(np.full((256, 256), 2000, np.float32), np.zeros((256, 256), np.float32)))

    def test_parent_elevation_ignores_off_ice_values(self):
        tile = 256
        on = (np.full((tile, tile), 3000, np.float32), np.ones((tile, tile), np.float32))
        # A neighbour whose pixels carry a surface but no ice.
        off = (np.full((tile, tile), 1000, np.float32), np.zeros((tile, tile), np.float32))
        surface, weight = self.build.downsample({(0, 0): on, (1, 0): off})
        half = tile // 2
        # Child (0, 0) fills the parent's top-left quarter, (1, 0) the top-right.
        self.assertTrue(np.allclose(surface[:half, :half], 3000))
        self.assertTrue(np.allclose(weight[:half, :half], 1))
        self.assertTrue(np.allclose(weight[:half, half:], 0))
        # The two missing children (bottom half) count as no ice.
        self.assertTrue(np.allclose(weight[tile // 2 :, :], 0))

    def test_viewer_and_generator_agree_on_the_encoding(self):
        # The browser decodes the patch in js/lia-dem.js, not through MapLibre's
        # raster-dem encoding, so that is where the constants must match.
        js = SCRIPT.parent.parent / "js"
        decoder = (js / "lia-dem.js").read_text()
        encoding = self.build.ENCODING
        self.assertEqual(encoding["redFactor"], 256 * encoding["greenFactor"])
        self.assertIn(f"PATCH_STEP = {encoding['greenFactor']};", decoder)
        self.assertIn(f"PATCH_BASE = -{encoding['baseShift']};", decoder)
        config = (js / "config.js").read_text()
        self.assertIn(Path("local-data/Alps-wide_LIA_surface_patch.pmtiles").name, config)


if __name__ == "__main__":
    unittest.main()


def load_thickness():
    path = SCRIPT.parent / "build_lia_thickness_pmtiles.py"
    spec = importlib.util.spec_from_file_location("build_lia_thickness_pmtiles", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipIf(np is None, "numpy, scipy and Pillow are needed")
class BuildLiaThicknessTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = load_thickness()

    def test_soft_alpha_is_opaque_inside_clear_outside_and_ramps_between(self):
        ice = np.zeros((60, 60), bool)
        ice[10:50, 10:50] = True
        alpha = self.build.soft_alpha(ice, pixel_size=50.0, sigma=40.0)
        self.assertEqual(alpha[30, 30], 1)
        self.assertEqual(alpha[2, 2], 0)
        edge = alpha[30, 6:14]
        self.assertTrue(np.all(np.diff(edge) >= 0))
        self.assertTrue(0 < alpha[30, 10] < 1)

    def test_ramp_ends_on_the_manifest_colours(self):
        record = self.build.layer_record(SCRIPT.parent.parent / "data" / "lia-layers.json")
        colour = self.build.ramp(record["colors"])
        first = record["colors"][0]
        last = record["colors"][-1]
        hex_rgb = lambda c: [int(c[i : i + 2], 16) for i in (1, 3, 5)]
        self.assertEqual(np.round(colour(np.array(0.0))).tolist(), hex_rgb(first))
        self.assertEqual(np.round(colour(np.array(1.0))).tolist(), hex_rgb(last))
