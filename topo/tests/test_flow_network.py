"""Unit tests for the pure pieces of build_flow_network.py: reading D8
codes, splitting creeks into segments at junctions, the two catchment values
each segment carries, Strahler order, and the renumbering when segments are
dropped or basins merged.

build_flow_network.py imports osgeo and shapely at module top, so they are
stubbed first (the topo/tests/_native_stub.py convention).
"""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import _native_stub  # noqa: F401,E402  (stubs osgeo/shapely when absent on the host)

from build_flow_network import (  # noqa: E402
    ESRI_D8,
    basin_slug,
    check,
    downstream,
    global_ids,
    keep,
    link,
    min_cells,
    strahler,
)

NCOLS = 5
NROWS = 5


def cells(*rc):
    return np.array([r * NCOLS + c for r, c in rc], np.int64)


def y_network():
    """Two creeks meeting at (2, 2), then running south off the grid.

        col: 0 1 2 3 4
        row 0  . A . B .
        row 1  . A . B .
        row 2  . . J . .
        row 3  . . T . .
        row 4  . . T . .     (T drains south, off the grid)

    A: (0,1) S, (1,1) SE.  B: (0,3) S, (1,3) SW.  J and T: S.
    Accumulation (cells): A 3, 5; B 4, 6; J 14 = 5 + 6 + itself + 2 from the
    hillside; then 16, 17.
    """
    layout = {
        (0, 1): (4, 3),
        (0, 3): (4, 4),
        (1, 1): (2, 5),
        (1, 3): (8, 6),
        (2, 2): (4, 14),
        (3, 2): (4, 16),
        (4, 2): (4, 17),
    }
    order = sorted(layout)  # row-major, as the build reads them
    idx = cells(*order)
    ptr = np.array([layout[k][0] for k in order], np.int64)
    acc = np.array([layout[k][1] for k in order], np.float64)
    return idx, ptr, acc, order


class TestEsriD8(unittest.TestCase):
    # Mutation: swap NE (128) and NW (32), or N and S, and every creek runs
    # the wrong way; check() then fails the build, but only on real data.
    def test_codes_point_at_the_named_neighbour(self):
        self.assertEqual(
            ESRI_D8,
            {
                1: (0, 1),
                2: (1, 1),
                4: (1, 0),
                8: (1, -1),
                16: (0, -1),
                32: (-1, -1),
                64: (-1, 0),
                128: (-1, 1),
            },
        )


class TestMinCells(unittest.TestCase):
    # Mutation: a cutoff in cells (2000) instead of km², and at 20 m the
    # creeks start 16 times further down.
    def test_the_cutoff_is_the_same_area_at_any_cell_size(self):
        self.assertEqual(min_cells(0.05, 5), 2000)
        self.assertEqual(min_cells(0.05, 20), 125)
        self.assertEqual(min_cells(0.05, 30), 56)  # 55.6 cells rounds up


class TestDownstream(unittest.TestCase):
    def test_each_cell_finds_the_stream_cell_below_it(self):
        idx, ptr, _, order = y_network()
        down = downstream(idx, ptr, NROWS, NCOLS)
        at = {rc: i for i, rc in enumerate(order)}
        self.assertEqual(down[at[(1, 1)]], at[(2, 2)])
        self.assertEqual(down[at[(1, 3)]], at[(2, 2)])
        self.assertEqual(down[at[(4, 2)]], -1)  # off the south edge

    # Mutation: drop the bounds check, and a cell on the east edge draining
    # east "flows into" the first cell of the row below.
    def test_draining_off_the_east_edge_does_not_wrap_to_the_next_row(self):
        idx = cells((0, 4), (1, 0))
        ptr = np.array([1, 4], np.int64)  # (0,4) drains E, off the grid
        self.assertEqual(downstream(idx, ptr, NROWS, NCOLS).tolist(), [-1, -1])

    def test_a_cell_draining_onto_a_non_stream_cell_has_nothing_below(self):
        idx = cells((0, 0))
        ptr = np.array([4], np.int64)
        self.assertEqual(downstream(idx, ptr, NROWS, NCOLS).tolist(), [-1])


class TestLink(unittest.TestCase):
    def setUp(self):
        self.idx, ptr, self.acc, order = y_network()
        self.at = {rc: i for i, rc in enumerate(order)}
        self.down = downstream(self.idx, ptr, NROWS, NCOLS)
        self.net = link(self.down)
        # Name each segment by its first cell.
        first = self.net.first.tolist()
        self.seg = {rc: first.index(self.at[rc]) for rc in [(0, 1), (0, 3), (2, 2)]}

    def test_a_y_is_three_segments_split_at_the_junction(self):
        self.assertEqual(len(self.net), 3)
        trunk = self.seg[(2, 2)]
        a, b = self.net.offsets[trunk], self.net.offsets[trunk + 1]
        self.assertEqual(
            self.net.cells[a:b].tolist(),
            [self.at[(2, 2)], self.at[(3, 2)], self.at[(4, 2)]],
        )

    def test_both_creeks_flow_into_the_trunk_and_the_trunk_into_nothing(self):
        trunk = self.seg[(2, 2)]
        self.assertEqual(self.net.flows_into[self.seg[(0, 1)]], trunk)
        self.assertEqual(self.net.flows_into[self.seg[(0, 3)]], trunk)
        self.assertEqual(self.net.flows_into[trunk], -1)

    # Mutation: end a creek's segment AT the junction cell (sampling it for
    # the creek's end), and creek A reads 14 instead of 5: it is credited with
    # the whole of creek B.
    def test_a_creek_ends_just_above_the_junction_and_the_trunk_starts_on_it(self):
        start = self.acc[self.net.first]
        end = self.acc[self.net.last]
        self.assertEqual(end[self.seg[(0, 1)]], 5)
        self.assertEqual(end[self.seg[(0, 3)]], 6)
        self.assertEqual(start[self.seg[(2, 2)]], 14)
        self.assertEqual(end[self.seg[(2, 2)]], 17)

    def test_the_trunk_starts_with_at_least_what_both_creeks_bring(self):
        check(self.net, self.down, self.acc)  # does not raise

    def test_a_loop_in_the_flow_directions_fails_the_build(self):
        # Two cells draining into each other: no source, no junction.
        with self.assertRaises(ValueError):
            link(np.array([1, 0], np.int64))


class TestCheck(unittest.TestCase):
    # Mutation: misread one D8 code so a cell "drains" uphill, and the build
    # must stop rather than write it.
    def test_catchment_falling_downstream_fails_the_build(self):
        idx, ptr, acc, _ = y_network()
        down = downstream(idx, ptr, NROWS, NCOLS)
        net = link(down)
        acc = acc.copy()
        acc[-1] = 1  # the last trunk cell now holds less than the one above
        with self.assertRaises(ValueError):
            check(net, down, acc)


class TestStrahler(unittest.TestCase):
    # Mutation: add one at every junction, and a small side creek joining a
    # big one raises the big one's order.
    def test_two_firsts_make_a_second(self):
        # 0 and 1 flow into 2.
        self.assertEqual(strahler(np.array([2, 2, -1])).tolist(), [1, 1, 2])

    def test_a_first_joining_a_second_leaves_it_second(self):
        # 0, 1 -> 2 (a second); 2 and 3 -> 4.
        out = strahler(np.array([2, 2, 4, 4, -1]))
        self.assertEqual(out.tolist(), [1, 1, 2, 1, 2])

    def test_three_firsts_at_one_d8_junction_make_a_second(self):
        self.assertEqual(strahler(np.array([3, 3, 3, -1])).tolist(), [1, 1, 1, 2])

    def test_two_seconds_make_a_third(self):
        out = strahler(np.array([2, 2, 6, 5, 5, 6, -1]))
        self.assertEqual(out[6], 3)

    def test_a_loop_fails_the_build(self):
        with self.assertRaises(ValueError):
            strahler(np.array([1, 0]))


class TestKeep(unittest.TestCase):
    # Mutation: keep the old positions in flows_into, and segments point at
    # the wrong segment (or past the end) once others are dropped.
    def test_dropping_segments_renumbers_and_cuts_links_to_dropped_ones(self):
        # 0 -> 1 -> 3, 2 -> 3; drop 1.
        flows_into = np.array([1, 3, 3, -1])
        kept = np.array([True, False, True, True])
        # Kept: old 0, 2, 3 are now 0, 1, 2. Old 0 drained into dropped 1.
        self.assertEqual(keep(flows_into, kept).tolist(), [-1, 2, -1])


class TestGlobalIds(unittest.TestCase):
    # Mutation: offset the ids but not flows_into, and the second basin's
    # segments drain into the first basin's.
    def test_a_second_basin_keeps_its_own_links_after_the_offset(self):
        ids, into = global_ids(np.array([2, 2, -1]), 101)
        self.assertEqual(ids.tolist(), [101, 102, 103])
        self.assertEqual(into.tolist(), [103, 103, -1])


class TestBasinSlug(unittest.TestCase):
    def test_a_name_becomes_a_safe_directory_name(self):
        self.assertEqual(
            basin_slug("Hawkesbury–Nepean River"), "hawkesbury-nepean-river"
        )
        self.assertEqual(basin_slug("///"), "basin")


if __name__ == "__main__":
    unittest.main()
