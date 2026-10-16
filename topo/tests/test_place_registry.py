"""The place registry builder: which features it keeps, how it merges them,
and the file it writes.

The file is read by shared/src/placeRegistry.ts. Both sides test against two
fixtures in shared/src/__fixtures__/, the registry and its pointer: this test
fails when the builder stops writing them, and placeRegistry.test.ts fails
when the reader stops understanding them. After a deliberate format change,
regenerate them with REGENERATE_FIXTURE=1 (then `npm run format`) and bump
the format on both sides.

Pure Python: no osmium, which only read_extract needs.
"""

import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import build_place_registry as reg  # noqa: E402

_HERE = os.path.dirname(__file__)
_FIXTURES = os.path.join(_HERE, "..", "..", "shared", "src", "__fixtures__")
_FIXTURE = os.path.join(_FIXTURES, "place-registry.json")
_POINTER_FIXTURE = os.path.join(_FIXTURES, "place-registry-pointer.json")
_SHARED_TS = os.path.join(_HERE, "..", "..", "shared", "src", "placeRegistry.ts")

# Published OpenStreetMap names around Katoomba, at rounded positions.
FIXTURE_RAWS = [
    ("Katoomba", "place=town", 150.312, -33.714, []),
    ("Blackheath", "place=town", 150.285, -33.633, []),
    ("Katoomba Falls", "waterway=waterfall", 150.307, -33.730, []),
    # Two segments of one road: they merge.
    ("Katoomba Falls Road", "highway=tertiary", 150.305, -33.725, []),
    ("Katoomba Falls Road", "highway=tertiary", 150.306, -33.727, []),
    # Shorter than the road, ranked below it: kind before length.
    ("Katoomba Falls Inn", "amenity=cafe", 150.306, -33.729, []),
    # Same name and kind, 9 km apart: two streets.
    ("Station Street", "highway=residential", 150.311, -33.712, []),
    ("Station Street", "highway=residential", 150.287, -33.632, []),
    ("Devil's Hole", "natural=valley", 150.300, -33.715, []),
    ("Govetts Leap", "tourism=viewpoint", 150.310, -33.628, ["Govett's Leap Lookout"]),
    # "castle" starts one name, starts a word of another, is inside a third.
    # A road: only its tier puts it before the peak.
    ("Castlereagh Highway", "highway=primary", 150.150, -33.480, []),
    ("Ruined Castle", "natural=peak", 150.290, -33.740, []),
    ("Newcastle Street", "highway=residential", 150.313, -33.716, []),
    # Its own name says "Lookout"; Govetts Leap's only alternate does.
    ("Echo Point Lookout", "tourism=viewpoint", 150.312, -33.732, []),
    ("Mount Solitary", "natural=peak", 150.320, -33.760, []),
]


def fixture_registry():
    raws = [reg.Raw(*r) for r in FIXTURE_RAWS]
    return reg.registry(raws, "2026-10-01")


def fixture_pointer():
    return reg.pointer("2026-10-01", "places-2026-10-01-0123abcd.json.gz", 4_000_000)


def check_fixture(test, path, built):
    if os.environ.get("REGENERATE_FIXTURE"):
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(built, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
    with open(path, encoding="utf-8") as fh:
        test.assertEqual(json.load(fh), built)


class TestFixture(unittest.TestCase):
    def test_builder_writes_the_shared_fixture(self):
        # Mutation: rename `rows` or reorder a row's fields → red here, and
        # placeRegistry.test.ts would read a file the builder no longer writes.
        check_fixture(self, _FIXTURE, fixture_registry())

    def test_builder_writes_the_shared_pointer_fixture(self):
        # Mutation: rename a pointer field → red here, and
        # isPlaceRegistryPointer would refuse the builder's pointer.
        check_fixture(self, _POINTER_FIXTURE, fixture_pointer())

    def test_format_and_prefix_match_the_reader(self):
        with open(_SHARED_TS, encoding="utf-8") as fh:
            ts = fh.read()
        fmt = re.search(r"PLACE_REGISTRY_FORMAT = (\d+);", ts)
        self.assertIsNotNone(fmt)
        self.assertEqual(int(fmt.group(1)), reg.FORMAT)
        self.assertIn("`master/places/v${PLACE_REGISTRY_FORMAT}/`", ts)
        self.assertEqual(reg.S3_PREFIX, f"master/places/v{reg.FORMAT}/")
        self.assertIn("${PLACE_REGISTRY_PREFIX}latest.json", ts)


class TestKindOf(unittest.TestCase):
    def test_reads_the_first_kind_key(self):
        self.assertEqual(
            reg.kind_of({"natural": "peak", "tourism": "viewpoint"}), "natural=peak"
        )

    def test_keeps_everything_with_a_kind(self):
        self.assertEqual(reg.kind_of({"shop": "bakery"}), "shop=bakery")
        self.assertEqual(reg.kind_of({"amenity": "parking"}), "amenity=parking")

    def test_leaves_out_every_excluded_class(self):
        # Mutation: drop the EXCLUDED check in kind_of → red. Each case also
        # carries a kind key, so only EXCLUDED can leave it out.
        for key, value in reg.EXCLUDED:
            tags = {"amenity": "x", key: value or "stop_position"}
            with self.subTest(key=key, value=value):
                self.assertIsNone(reg.kind_of(tags))

    def test_excluded_entries_are_the_documented_ones(self):
        # Mutation: drop an EXCLUDED entry → red. ADR 0034 names this list.
        self.assertEqual(
            reg.EXCLUDED,
            {
                ("type", "route"),
                ("boundary", "administrative"),
                ("public_transport", None),
                ("highway", "bus_stop"),
                ("highway", "platform"),
                ("railway", "platform"),
            },
        )

    def test_a_closed_road_or_creek_is_a_line(self):
        # Mutation: read every closed way as an area → red.
        self.assertTrue(reg.is_line({}, "highway=residential"))
        self.assertTrue(reg.is_line({}, "waterway=stream"))
        self.assertTrue(reg.is_line({"area": "no"}, "leisure=track"))
        self.assertFalse(reg.is_line({}, "leisure=park"))
        self.assertFalse(reg.is_line({"area": "yes"}, "highway=pedestrian"))

    def test_no_kind_no_row(self):
        self.assertIsNone(reg.kind_of({"name": "Somewhere"}))


class TestRegistry(unittest.TestCase):
    def setUp(self):
        self.doc = fixture_registry()
        self.rows = self.doc["rows"]

    def named(self, name):
        return [r for r in self.rows if r[0] == name]

    def test_segments_merge_and_distant_namesakes_do_not(self):
        self.assertEqual(len(self.named("Katoomba Falls Road")), 1)
        self.assertEqual(len(self.named("Station Street")), 2)

    def test_merged_point_is_on_a_segment(self):
        (road,) = self.named("Katoomba Falls Road")
        self.assertIn((road[2], road[3]), [(150.305, -33.725), (150.306, -33.727)])

    def test_near_names_the_closest_settlement(self):
        near = {(r[2], r[3]): self.rows[r[4]][0] for r in self.named("Station Street")}
        self.assertEqual(near[(150.311, -33.712)], "Katoomba")
        self.assertEqual(near[(150.287, -33.632)], "Blackheath")

    def test_a_settlement_is_near_another(self):
        # Mutation: let nearest() return the settlement itself → red.
        (katoomba,) = self.named("Katoomba")
        self.assertEqual(self.rows[katoomba[4]][0], "Blackheath")

    def test_settlements_come_first(self):
        kinds = self.doc["kinds"]
        firsts = [kinds[r[1]] for r in self.rows[:2]]
        self.assertEqual(firsts, ["place=town", "place=town"])

    def test_alternates_ride_along(self):
        (leap,) = self.named("Govetts Leap")
        self.assertEqual(leap[5], ["Govett's Leap Lookout"])


class TestMerge(unittest.TestCase):
    def line(self, kind, west, east):
        return reg.Raw(
            "Wollangambe River",
            kind,
            (west + east) / 2,
            -33.5,
            [],
            (west, -33.5, east, -33.5),
            True,
        )

    def test_segments_chain_through_a_neighbour(self):
        # A and C are 0.2° apart; B touches both. Read in the order A, C, B,
        # a merge that only joins a new object to one group leaves two rows.
        # Mutation: join each object to the first group it touches → red.
        a = self.line("waterway=stream", 150.0, 150.1)
        c = self.line("waterway=stream", 150.3, 150.4)
        b = self.line("waterway=river", 150.1, 150.3)
        rows = reg.merge([a, c, b])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].kind, "waterway=stream")

    def test_lines_of_different_keys_stay_apart(self):
        road = reg.Raw("X", "highway=track", 150.0, -33.5, [], None, True)
        creek = reg.Raw("X", "waterway=stream", 150.0, -33.5, [], None, True)
        self.assertEqual(len(reg.merge([road, creek])), 2)

    def test_a_point_does_not_merge_into_a_line(self):
        path = reg.Raw("X", "highway=path", 150.0, -33.5, [], None, True)
        head = reg.Raw("X", "highway=trailhead", 150.0, -33.5, [])
        self.assertEqual(len(reg.merge([path, head])), 2)


class FakeS3:
    class exceptions:
        class NoSuchKey(Exception):
            pass

    def __init__(self, current=None):
        self.current = current
        self.uploads = []

    def get_object(self, Bucket, Key):
        if self.current is None:
            raise self.exceptions.NoSuchKey()
        body = json.dumps(self.current).encode()
        return {"Body": type("B", (), {"read": lambda _self: body})()}

    def upload_file(self, path, bucket, key, ExtraArgs):
        self.uploads.append((key, ExtraArgs["CacheControl"]))


class TestUpload(unittest.TestCase):
    def setUp(self):
        import tempfile
        from pathlib import Path

        self.tmp = tempfile.TemporaryDirectory()
        self.data, self.pointer = reg.build_files(
            fixture_registry(), Path(self.tmp.name)
        )

    def tearDown(self):
        self.tmp.cleanup()

    def test_data_file_goes_up_before_the_pointer(self):
        # Mutation: swap the two uploads → red.
        s3 = FakeS3()
        reg.upload(s3, "bucket", self.data, self.pointer)
        keys = [key for key, _ in s3.uploads]
        self.assertRegex(
            keys[0], r"^master/places/v1/places-2026-10-01-[0-9a-f]{8}\.json\.gz$"
        )
        self.assertEqual(keys[1], "master/places/v1/latest.json")
        self.assertIn("immutable", s3.uploads[0][1])
        self.assertNotIn("immutable", s3.uploads[1][1])

    def test_refuses_a_build_far_smaller_than_the_current_one(self):
        # Mutation: drop the size check → red.
        size = self.data.stat().st_size
        s3 = FakeS3({"bytes": size * 2})
        with self.assertRaises(SystemExit):
            reg.upload(s3, "bucket", self.data, self.pointer)
        self.assertEqual(s3.uploads, [])

    def test_refuses_over_an_unreadable_pointer(self):
        s3 = FakeS3({"size": 1})
        with self.assertRaises(SystemExit):
            reg.upload(s3, "bucket", self.data, self.pointer)
        self.assertEqual(s3.uploads, [])

    def test_a_rebuild_with_other_bytes_gets_another_name(self):
        # Mutation: name the file by version alone → red; the CDN would
        # keep serving the old bytes under an immutable name.
        from pathlib import Path

        other = fixture_registry()
        other["rows"] = other["rows"][:-1]
        data, _ = reg.build_files(other, Path(self.tmp.name) / "again")
        self.assertNotEqual(data.name, self.data.name)

    def test_a_similar_size_replaces_the_current_one(self):
        s3 = FakeS3({"bytes": self.data.stat().st_size})
        reg.upload(s3, "bucket", self.data, self.pointer)
        self.assertEqual(len(s3.uploads), 2)


class TestAlternates(unittest.TestCase):
    def test_splits_dedupes_and_skips_the_name(self):
        tags = {"alt_name": "A;B", "loc_name": "B", "old_name": "Name"}
        self.assertEqual(reg.alternates_of(tags, "Name"), ["A", "B"])


if __name__ == "__main__":
    unittest.main()
