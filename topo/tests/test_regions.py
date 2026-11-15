"""Unit tests for regions.py: the regions topo/ reads from regions.json (written
from shared/src/regions.ts; shared/src/topoRegions.test.ts holds the file equal
to it). Every coordinate here is a place on a map or made up."""

import json
import os
import re
import subprocess
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

import regions  # noqa: E402

TOPO = os.path.dirname(os.path.dirname(__file__))
AREA_CASES = os.path.join(TOPO, "..", "shared/src/__fixtures__/area-region.json")
EXPORT_CASES = os.path.join(TOPO, "..", "shared/src/__fixtures__/export-region.json")
KATOOMBA = (150.31, -33.71)
WANAKA = (169.25, -44.055)
DEV = {"DB_HOST": "postgres"}


def load(env):
    with mock.patch.dict(os.environ, env, clear=True):
        return regions._load()


class TestSimulatedRegions(unittest.TestCase):
    # Mutation: drop the `or not r.get("sim")` filter in `_load` and a prod
    # worker places a job in a region with no data.
    def test_are_ignored_unless_the_switch_is_on(self):
        self.assertEqual([r["id"] for r in load(DEV)], ["nsw"])
        self.assertEqual([r["id"] for r in load({})], ["nsw"])
        self.assertEqual(
            [r["id"] for r in load({**DEV, "SIM_REGIONS": "1"})],
            ["nsw", "simnz", "simutah"],
        )

    # Mutation: read any non-empty value as on (`bool(env.get("SIM_REGIONS"))`).
    def test_only_the_value_1_turns_them_on(self):
        for value in ("0", "", "true"):
            self.assertEqual(
                [r["id"] for r in load({**DEV, "SIM_REGIONS": value})], ["nsw"], value
            )

    # Mutation: drop one signal from `prod_runtime`; each case goes red for its
    # own. The first row is the local worker's environment, which is let through.
    def test_a_prod_runtime_refuses_the_switch(self):
        for name, extra, refused in (
            ("a local worker", {}, False),
            ("no database host", {"DB_HOST": None}, False),
            ("LOGJAM_RUNTIME=prod", {"LOGJAM_RUNTIME": "prod"}, True),
            ("an ECS container", {"ECS_CONTAINER_METADATA_URI_V4": "http://x"}, True),
            ("a Fargate task", {"AWS_EXECUTION_ENV": "AWS_ECS_FARGATE"}, True),
            ("a Lambda", {"AWS_LAMBDA_FUNCTION_NAME": "fn"}, True),
            ("a remote database", {"DB_HOST": "db.example.com"}, True),
        ):
            env = {**DEV, "SIM_REGIONS": "1", **extra}
            env = {k: v for k, v in env.items() if v is not None}
            with self.subTest(name):
                if refused:
                    with self.assertRaisesRegex(RuntimeError, "SIM_REGIONS=1 refused"):
                        load(env)
                else:
                    self.assertEqual(len(load(env)), 3)

    # Mutation: call `sim_regions_on` only when a region is looked up instead
    # of when `_load` runs at import, and a prod worker starts with the switch.
    def test_a_prod_worker_stops_at_import(self):
        env = {
            **os.environ,
            "SIM_REGIONS": "1",
            "LOGJAM_RUNTIME": "prod",
        }
        done = subprocess.run(
            [
                sys.executable,
                "-I",
                "-c",
                f"import sys; sys.path.insert(0, {TOPO!r}); import regions",
            ],
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("SIM_REGIONS=1 refused", done.stderr)


RUNTIME_TS = os.path.join(TOPO, "..", "api", "src", "lib", "runtime.ts")


class TestRuntimeParity(unittest.TestCase):
    """`prod_runtime` is `nonDevRuntime` (api/src/lib/runtime.ts) as a worker
    reads it, so the two lists of signals and of local database hosts must
    agree. Not NODE_ENV: no worker's task definition sets it, so an unset one
    would refuse every local worker."""

    def setUp(self):
        with open(RUNTIME_TS, encoding="utf-8") as f:
            self.ts = f.read()

    # Mutation: add a host to `LOCAL_DB_HOSTS` here, or to the host pattern in
    # runtime.ts, alone.
    def test_the_local_database_hosts_are_the_apis(self):
        pattern = re.search(r"/\^\(([^)]*)\)\$/", self.ts)
        self.assertIsNotNone(pattern, "no host pattern in runtime.ts")
        hosts = {h.replace("\\.", ".") for h in pattern.group(1).split("|")}
        self.assertGreaterEqual(len(hosts), 4)
        self.assertEqual(hosts, set(regions.LOCAL_DB_HOSTS))

    # Mutations: add an env signal to `nonDevRuntime` in runtime.ts, or to
    # `RUNTIME_SIGNALS` here, alone; or read one in runtime.ts as
    # `env["AWS_EXECUTION_ENV"]`, which the pattern would not see.
    def test_the_environment_signals_are_the_apis(self):
        code = "\n".join(
            line for line in self.ts.splitlines() if not line.lstrip().startswith("//")
        ).replace("(env: NodeJS.ProcessEnv)", "")
        self.assertEqual(
            re.findall(r"\benv\b(?!\.[A-Z])", code),
            [],
            "runtime.ts reads `env` in a form this test cannot see "
            "(env[...], a destructure): read each signal as env.NAME",
        )
        names = set(re.findall(r"\benv\.([A-Z][A-Z0-9_]+)", self.ts))
        signals = names - {"NODE_ENV", "DB_HOST"}
        self.assertGreaterEqual(len(signals), 4)
        self.assertIn("DB_HOST", names)
        self.assertEqual(signals, {"LOGJAM_RUNTIME", *regions.RUNTIME_SIGNALS})


class TestRegionLookup(unittest.TestCase):
    def setUp(self):
        # The module's own list follows the caller's shell (SIM_REGIONS), which
        # a test must not.
        patch = mock.patch.object(regions, "REGIONS", load(DEV))
        patch.start()
        self.addCleanup(patch.stop)

    # Mutation: return None instead of raising, and a typo in an id is a region
    # with no archives rather than an error.
    def test_an_unknown_region_is_an_error(self):
        with self.assertRaises(KeyError):
            regions.region("simnz")

    # Mutation: test the region's bounding box instead of its rings.
    def test_region_at_finds_the_region_holding_a_point(self):
        self.assertEqual(regions.region_at(*KATOOMBA)["id"], "nsw")
        self.assertIsNone(regions.region_at(*WANAKA))
        self.assertIsNone(regions.region_at(156.0, -33.0))  # the Tasman Sea
        # Victoria, inside NSW's bounding box.
        self.assertIsNone(regions.region_at(141.5, -36.5))
        with mock.patch.object(regions, "REGIONS", load({**DEV, "SIM_REGIONS": "1"})):
            self.assertEqual(regions.region_at(*WANAKA)["id"], "simnz")
            # Inside the box round NZ's two rings, between them.
            self.assertIsNone(regions.region_at(172.0, -40.0))

    # Mutation: return the last match instead of the first.
    def test_the_first_region_in_file_order_wins_where_borders_overlap(self):
        square = lambda w, s, e, n: [[[w, s], [e, s], [e, n], [w, n]]]  # noqa: E731
        a = {"id": "a", "borders": square(0, 0, 2, 2)}
        b = {"id": "b", "borders": square(1, 1, 3, 3)}
        with mock.patch.object(regions, "REGIONS", [a, b]):
            self.assertEqual(regions.region_at(1.5, 1.5)["id"], "a")
            self.assertEqual(regions.region_at(2.5, 2.5)["id"], "b")


class TestRegionOfArea(unittest.TestCase):
    # Mutation: `region_of_area` testing a corner of the box (`region_at(west,
    # south, regions)`) in place of its centre: the worker then fills an area
    # from one region and the clients credit another
    # (shared/src/regions.test.ts reads the same cases for `regionOfArea`).
    def test_an_area_belongs_to_the_region_holding_its_centre(self):
        with open(AREA_CASES, encoding="utf-8") as f:
            cases = json.load(f)["cases"]
        self.assertGreaterEqual(len(cases), 6)
        every = load({**DEV, "SIM_REGIONS": "1"})
        for case in cases:
            with self.subTest(case["why"]):
                found = regions.region_of_area(case["coverage"], every)
                self.assertEqual(found and found["id"], case["region"])


class TestExportRegion(unittest.TestCase):
    # Mutation: `export_region` testing the centre only (no touching
    # fallback): a box over NSW's edge is then read from no region, though
    # the API admitted it and named MGA for it
    # (shared/src/areaExport.test.ts reads the same cases for `areaExportRegion`).
    def test_a_box_is_read_from_the_region_the_api_names_its_grid_by(self):
        with open(EXPORT_CASES, encoding="utf-8") as f:
            cases = json.load(f)["cases"]
        self.assertGreaterEqual(len(cases), 8)
        every = load({**DEV, "SIM_REGIONS": "1"})
        for case in cases:
            with self.subTest(case["why"]):
                found = regions.export_region(case["bbox"], every)
                self.assertEqual(found and found["id"], case["region"])

    @staticmethod
    def made_up():
        def ring(w, s, e, n):
            return [[w, s], [e, s], [e, n], [w, n], [w, s]]

        def one(rid, heights, *borders):
            terrain = {"heights": {"id": rid}} if heights else {}
            return {"id": rid, "borders": list(borders), "terrain": terrain}

        # `bare` holds the box's centre but has no heights.
        return [
            one("bare", False, ring(10, 10, 20, 20)),
            one("full", True, ring(15, 10, 25, 20)),
            one("other", True, ring(5, 22, 12, 30)),
        ]

    # Mutation: leave the `heights` filter out, and a box centred in a region
    # that has none is read from it, with no archive to read.
    def test_a_region_with_no_heights_is_never_the_one(self):
        every = self.made_up()
        found = regions.export_region((8, 12, 16, 18), every)  # centre (12, 15)
        self.assertEqual(found["id"], "full")

    # Mutation: take the last touching region, or the nearest, in place of the
    # first in the list's order.
    def test_two_regions_touching_the_box_go_by_list_order(self):
        box = (8, 19, 20, 31)  # centred in none, over `full` and `other`
        every = self.made_up()
        self.assertEqual(regions.export_region(box, every)["id"], "full")
        self.assertEqual(
            regions.export_region(box, [every[0], every[2], every[1]])["id"], "other"
        )


class TestSharpenEntry(unittest.TestCase):
    # Mutation: give a region whose heights go deeper than z15 (simnz, to z17)
    # `mode: "upload"` in shared/src/regions.ts and regenerate: sharpen.py
    # would read its z15 tiles as the finest it has and write an area that
    # starts at z15 over heights that are already finer. Or drop the slope
    # archive from an upload region.
    def test_an_upload_region_is_filled_from_z15(self):
        import sharpen

        every = load({**DEV, "SIM_REGIONS": "1"})
        upload = [r for r in every if r["sharpen"]["mode"] == "upload"]
        self.assertIn("nsw", [r["id"] for r in upload])
        for r in upload:
            with self.subTest(r["id"]):
                self.assertEqual(r["terrain"]["heights"]["sampleZoom"], sharpen.ZMIN)
                self.assertEqual(r["terrain"]["slope"]["maxzoom"], sharpen.ZMIN)

    # Mutation: declare a region in shared/src/regions.ts with a `reason` that
    # `NOT_SHARPENED` has no sentence for and regenerate: a survey of its ground
    # then fails with a KeyError instead of a sentence for its owner.
    def test_every_reason_a_region_gives_has_a_sentence(self):
        import sharpen

        every = load({**DEV, "SIM_REGIONS": "1"})
        off = [r for r in every if r["sharpen"]["mode"] == "off"]
        self.assertGreaterEqual(len(off), 1)
        for r in off:
            with self.subTest(r["id"]):
                self.assertIn(r["sharpen"]["reason"], sharpen.NOT_SHARPENED)


if __name__ == "__main__":
    unittest.main()
