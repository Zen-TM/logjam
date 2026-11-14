"""Unit tests for regions.py: the regions topo/ reads from regions.json (written
from shared/src/regions.ts; shared/src/topoRegions.test.ts holds the file equal
to it). Every coordinate here is a place on a map or made up."""

import os
import subprocess
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo when absent on the host)

import regions  # noqa: E402

TOPO = os.path.dirname(os.path.dirname(__file__))
KATOOMBA = (150.31, -33.71)
WANAKA = (169.1, -44.62)
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


class TestRegionLookup(unittest.TestCase):
    def test_nsw_is_declared_with_the_archives_the_builds_read(self):
        terrain = regions.region("nsw")["terrain"]
        for layer in ("heights", "slope", "contours"):
            self.assertTrue(terrain[layer]["archivePath"].startswith("master/"), layer)

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


if __name__ == "__main__":
    unittest.main()
