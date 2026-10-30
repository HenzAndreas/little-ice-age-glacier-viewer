"""Glacier names for the LIA outlines: name cleaning, languages, matching.

Runs on small synthetic geometries, without the downloaded inventories.
"""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("names", ROOT / "processing-files" / "build_lia_glacier_names.py")
names = importlib.util.module_from_spec(spec)
sys.modules["names"] = names
spec.loader.exec_module(names)

try:
    import geopandas as gpd
    from shapely.geometry import Point, box
except ImportError:  # pragma: no cover
    gpd = None


class NameText(unittest.TestCase):
    def test_glims_labels_are_tidied(self):
        clean = names.clean_glims_name
        self.assertEqual(clean("Schw\\x84rze-W"), "Schwärze-W")
        self.assertEqual(clean("Mont Min\\x82-S-II"), "Mont Miné-S-II")
        self.assertEqual(clean("FR4N01166B04 Ouest du Soreiller"), "Ouest du Soreiller")
        self.assertEqual(clean("Civetta Est IT4L00022001"), "Civetta Est")
        self.assertEqual(clean("Glacier Est des Sellettes_1_4"), "Glacier Est des Sellettes")
        self.assertEqual(clean("Weissee Kees, "), "Weissee Kees")
        self.assertEqual(clean("SUSTENLOCHFIRN"), "Sustenlochfirn")
        self.assertIsNone(clean(""))

    def test_spellings_of_one_glacier_share_a_key(self):
        self.assertEqual(names.name_key("Gepatsch Ferner"), names.name_key("Gepatschferner"))
        self.assertNotEqual(names.name_key("Gepatschferner"), names.name_key("Hintereisferner"))

    def test_osm_name_is_the_local_one(self):
        tags = {"name": "Grosser Aletschgletscher", "name:fr": "Glacier d'Aletsch"}
        self.assertEqual(names.osm_name(tags), "Grosser Aletschgletscher")

    def test_bilingual_region_gets_both_languages(self):
        tags = {"name": "Ghiacciaio del Rutor", "name:it": "Ghiacciaio del Rutor", "name:fr": "Glacier du Ruitor"}
        self.assertEqual(names.osm_name(tags, ("it", "fr")), "Ghiacciaio del Rutor / Glacier du Ruitor")
        both = {"name": "Suldenferner - Vedretta di Solda", "name:de": "Suldenferner", "name:it": "Vedretta di Solda"}
        self.assertEqual(names.osm_name(both, ("de", "it")), "Suldenferner - Vedretta di Solda")


@unittest.skipIf(gpd is None, "geopandas not installed")
class Matching(unittest.TestCase):
    def test_glaciers_go_to_the_outline_holding_most_of_them(self):
        outlines = gpd.GeoDataFrame({"LIA_ID": [1, 2]}, geometry=[box(0, 0, 1000, 1000), box(1000, 0, 2000, 1000)], crs=names.CRS)
        today = gpd.GeoDataFrame(
            {"name": ["Big", "Small", "Straddling", "Outside", "Peak"]},
            geometry=[
                box(100, 100, 600, 600),       # inside 1, larger
                box(700, 700, 800, 800),       # inside 1, smaller
                box(900, 100, 1300, 300),      # mostly in 2
                box(5000, 5000, 5100, 5100),   # in neither
                Point(1500, 500),              # an OSM node in 2
            ],
            crs=names.CRS,
        )
        self.assertEqual(names.match(outlines, today), {1: ["Big", "Small"], 2: ["Straddling", "Peak"]})

    def test_the_glacier_at_the_lia_terminus_comes_first(self):
        outlines = gpd.GeoDataFrame({"LIA_ID": [1]}, geometry=[box(0, 0, 1000, 3000)], crs=names.CRS)
        today = gpd.GeoDataFrame(
            {"name": ["Upper basin", "Tongue"]},
            geometry=[box(100, 1500, 900, 2900), box(400, 300, 600, 1400)],
            crs=names.CRS,
        )
        self.assertEqual(names.match(outlines, today), {1: ["Upper basin", "Tongue"]})
        self.assertEqual(names.match(outlines, today, {1: Point(500, 50)}), {1: ["Tongue", "Upper basin"]})

    def test_a_glacier_mostly_outside_is_left_out(self):
        outlines = gpd.GeoDataFrame({"LIA_ID": [1]}, geometry=[box(0, 0, 1000, 1000)], crs=names.CRS)
        today = gpd.GeoDataFrame({"name": ["Mostly out"]}, geometry=[box(800, 0, 2000, 100)], crs=names.CRS)
        self.assertEqual(names.match(outlines, today), {})


if __name__ == "__main__":
    unittest.main()
