"""Unit tests for scripts/sim-regions/build.py: the parts that decide what is
retried and what counts as a finished file. The builds themselves run on a host
with docker and the network (scripts/sim-regions/README.md).
"""

import http.client
import importlib.util
import subprocess
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/sim-regions/build.py"
spec = importlib.util.spec_from_file_location("sim_regions_build", SCRIPT)
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://example.test/x", code, "no", {}, None)


def failed(stderr: str) -> subprocess.CalledProcessError:
    return subprocess.CalledProcessError(1, ["pmtiles"], stderr=stderr)


class TestRetriable(unittest.TestCase):
    """What waiting can cure, and nothing else."""

    def test_a_refusal_or_a_dropped_connection_is_retried(self):
        # Mutation: return False from retriable() for every error.
        for error in (
            http_error(429),
            http_error(503),
            urllib.error.URLError(ConnectionRefusedError()),
            http.client.IncompleteRead(b""),
            ConnectionResetError(),
            TimeoutError(),
            # go-pmtiles' own wording, read from a local server that answered
            # 429 and from a socket that was closed.
            failed("Failed to extract, Failed to create range reader, HTTP error: 429"),
            failed("fetching chunks 50%\nFailed, HTTP error: 503"),
            failed('Get "https://h/x.pmtiles": EOF'),
            failed("dial tcp 1.2.3.4:443: connect: connection refused"),
            failed("read tcp 1.2.3.4:5->6:443: read: connection reset by peer"),
            failed("dial tcp: i/o timeout"),
        ):
            with self.subTest(error=error):
                self.assertTrue(build.retriable(error))

    def test_a_wrong_url_a_bad_argument_or_a_missing_binary_is_not(self):
        # Mutation: return True from retriable() for every error, or search stderr
        # for a bare "429" or "503" in place of RETRY_STDERR.
        for error in (
            http_error(404),
            http_error(403),
            FileNotFoundError("pmtiles"),
            ValueError("bad"),
            failed("pmtiles: error: unknown flag --nope"),
            failed("HTTP error: 404"),
            failed(None),
            # Digits and words that are not a refusal: a permanent failure.
            failed("fetching 1500/3000 chunks\nno space left on device"),
            failed("wrote 5030 bytes; 503 tiles left: no space left on device"),
            failed("Failed to extract: archive 4290 tiles, timeout flag unknown"),
        ):
            with self.subTest(error=error):
                self.assertFalse(build.retriable(error))

    def test_a_refusal_waits_longer_each_time_and_gives_up(self):
        # Mutation: sleep 0 s between tries, or never raise after the last.
        calls, waits = [], []

        def refuse():
            calls.append(1)
            raise http_error(429)

        with mock.patch.object(build.time, "sleep", waits.append):
            with self.assertRaises(urllib.error.HTTPError):
                build.retrying("x", refuse, tries=4)
        self.assertEqual(len(calls), 4)
        self.assertEqual(waits, [build.WAIT_S, 2 * build.WAIT_S, 4 * build.WAIT_S])

    def test_anything_else_fails_at_once_without_waiting(self):
        # Mutation: catch every Exception in retrying() and wait.
        calls = []

        def broken():
            calls.append(1)
            raise http_error(404)

        with mock.patch.object(build.time, "sleep") as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                build.retrying("x", broken)
        self.assertEqual(len(calls), 1)
        sleep.assert_not_called()


class TestWritten(unittest.TestCase):
    """A file at its final name is a whole one."""

    def test_the_target_exists_only_after_the_build_returns(self):
        # Mutation: pass `target` itself to build() and drop the rename.
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "deep" / "a.pmtiles"
            seen = []

            def build_file(part: Path) -> None:
                seen.append((target.exists(), part.name))
                part.write_bytes(b"whole")

            build.written(target, build_file)
            self.assertEqual(seen, [(False, "a.pmtiles.part")])
            self.assertEqual(target.read_bytes(), b"whole")
            self.assertFalse(target.with_name("a.pmtiles.part").exists())

    def test_a_build_that_fails_leaves_no_target(self):
        # Mutation: rename the part to target in a `finally`.
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "a.pmtiles"

            def die(part: Path) -> None:
                part.write_bytes(b"half")
                raise OSError("no space left on device")

            with self.assertRaises(OSError):
                build.written(target, die)
            self.assertFalse(target.exists())

    def test_a_part_left_by_a_killed_run_is_not_built_on(self):
        # Mutation: skip the `part.unlink` before build().
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "a.pmtiles"
            target.with_name("a.pmtiles.part").write_bytes(b"stale")
            starts = []
            build.written(
                target, lambda part: (starts.append(part.exists()), part.touch())
            )
            self.assertEqual(starts, [False])


if __name__ == "__main__":
    unittest.main()
