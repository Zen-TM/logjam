#!/usr/bin/env python3
"""Read a recorded track off a pulled device DB and say what the fixes did.

    ./scripts/track-forensics.py <logjam-offline.db> [trackId] [--sensors log.csv]

Companion to private/todo/track-accuracy.md. It exists because the last round of
this analysis lived in a session scratchpad and was lost, so every number in the
doc had to be re-derived from scratch.

WHAT IT ANSWERS, in the order the doc asks:
  - How bad are the fixes, and where. Step lengths, accuracy, outage gaps.
  - Does the Doppler channel disagree with position differencing, and where.
    The TRAPEZOID form ((v1+v2)/2 * dt vs the haversine step), which is the one
    that works — the stateless form compares an instantaneous speed to an
    interval average and is dominated by real acceleration.
  - What the recorder threw away (`track_point_rejected`) and how far a
    stationary phone appeared to wander while it did.
  - From a sensor log: how long the GPS outages really were, how often the party
    genuinely stopped, and whether the barometer survived the carry.

PULL THE `-wal` FILE TOO. The DB runs in WAL mode; a bare `cat` of the main file
misses every recent commit, which reads as "the recording did not happen".

PRIVACY: prints distances, speeds and counts. It never prints a coordinate, so
its output can go in a bug report or a commit message. Keep it that way.
"""

import argparse
import math
import sqlite3
import statistics as st
import sys
from collections import Counter

EARTH_RADIUS_M = 6371000.0


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def quantiles(values):
    """median / p90 / max, or None for an empty series."""
    if not values:
        return None
    ordered = sorted(values)
    return (
        st.median(ordered),
        ordered[min(int(0.9 * len(ordered)), len(ordered) - 1)],
        ordered[-1],
    )


def fmt(label, values, unit="m"):
    q = quantiles(values)
    if q is None:
        print(f"  {label:<28} (none)")
        return
    print(f"  {label:<28} median {q[0]:8.1f}  p90 {q[1]:8.1f}  max {q[2]:8.1f} {unit}")


def pick_track(db, track_id):
    rows = db.execute(
        "SELECT id, name, state, pointCount, distanceM, startedAt FROM track"
        " ORDER BY startedAt DESC"
    ).fetchall()
    if not rows:
        sys.exit("no tracks in this database")
    if track_id:
        for row in rows:
            if row[0] == track_id:
                return row
        sys.exit(f"no track {track_id}")
    if len(rows) > 1:
        print("tracks (most recent first):")
        for row in rows:
            print(f"  {row[0]}  {row[2]:<10} {row[3]:>6} pts  {row[4]/1000:7.2f} km  {row[5]}")
        print()
    return rows[0]


def report_points(db, track_id):
    points = db.execute(
        "SELECT seq, segment, lon, lat, altitudeM, accuracyM, timestampMs,"
        "       suppressedCount, stationaryMs, speedMps"
        "  FROM track_point WHERE trackId = ? ORDER BY seq",
        (track_id,),
    ).fetchall()
    print(f"ACCEPTED POINTS: {len(points)}")
    if len(points) < 2:
        return
    fmt("reported accuracy", [p[5] for p in points if p[5] is not None])

    steps, gaps, ratios, excesses = [], [], [], []
    for prev, cur in zip(points, points[1:]):
        # A segment break is a pause, not a gap in the fixes.
        if cur[1] != prev[1]:
            continue
        dt = (cur[6] - prev[6]) / 1000.0
        if dt <= 0:
            continue
        step = haversine_m(prev[3], prev[2], cur[3], cur[2])
        steps.append(step)
        gaps.append(dt)
        # Trapezoid: what the receiver's own velocity says the step should be.
        if prev[9] is not None and cur[9] is not None:
            predicted = (prev[9] + cur[9]) / 2.0 * dt
            if predicted > 1.0:
                ratios.append(step / predicted)
            excesses.append(step - predicted)

    fmt("step length", steps)
    fmt("gap between fixes", gaps, "s")
    print(f"  {'total (raw haversine)':<28} {sum(steps)/1000:8.2f} km")

    if ratios:
        print()
        print("DOPPLER vs POSITION (trapezoid form)")
        fmt("actual / predicted", ratios, "x")
        fmt("|actual - predicted|", [abs(e) for e in excesses])
        # The candidate gate from track-accuracy.md. It fires on nothing in the
        # 2026-08-23 car track; what it does on a canyon is the open question.
        flagged = [
            (r, e) for r, e in zip(ratios, excesses) if r > 2 and e > 100
        ]
        print(f"  {'gate ratio>2 and excess>100m':<28} {len(flagged)} hits")
    else:
        print("\n  (no speedMps on these points — recorded before 2026-08-21)")

    stationary = [p[8] for p in points if p[8]]
    if stationary:
        print()
        print(f"DEMONSTRATED STOPS: {len(stationary)} points carry stationary evidence")
        fmt("stationaryMs", [s / 1000 for s in stationary], "s")


def report_rejected(db, track_id):
    print()
    try:
        rows = db.execute(
            "SELECT seq, reason, lon, lat, accuracyM, timestampMs, speedMps"
            "  FROM track_point_rejected WHERE trackId = ? ORDER BY seq",
            (track_id,),
        ).fetchall()
    except sqlite3.OperationalError:
        # A snapshot pulled before the table landed. Not an error — say so and
        # carry on, because the rest of the report is still the whole point.
        print("REJECTED FIXES: table absent (snapshot predates 2026-08-25)")
        return
    print(f"REJECTED FIXES: {len(rows)}")
    if not rows:
        print("  (none stored for this track)")
        return
    for reason, count in sorted(Counter(r[1] for r in rows).items()):
        print(f"  {reason:<28} {count}")

    # How far a REFUSED-as-too-close fix appeared to move. This is a stationary
    # phone's drift, which is the same error as canyon spaghetti seen from the
    # other end — and it was invisible before these rows were kept.
    still = [r for r in rows if r[1] == "too-close"]
    if len(still) > 2:
        mlat = st.mean(r[3] for r in still)
        mlon = st.mean(r[2] for r in still)
        spread = [
            math.hypot(
                (r[2] - mlon) * 111320 * math.cos(math.radians(mlat)),
                (r[3] - mlat) * 110540,
            )
            for r in still
        ]
        print()
        print("STATIONARY DRIFT (too-close fixes, distance from their centroid)")
        fmt("apparent wander", spread)
        speeds = [r[6] for r in still if r[6] is not None]
        if speeds:
            fmt("reported speed", speeds, "m/s")
            print("    ^ near zero while the position wanders = the Doppler channel")
            print("      disagreeing with position differencing, correctly.")


def report_sensors(path):
    """Summarise a logjam-sensors CSV. Format is documented in the Kotlin module."""
    kinds = Counter()
    baro, steps, gnss = [], [], []
    anchor = None
    with open(path) as handle:
        for line in handle:
            if line.startswith("#"):
                continue
            parts = line.rstrip("\n").split(",")
            kinds[parts[0]] += 1
            try:
                if parts[0] == "anchor":
                    anchor = (int(parts[1]), int(parts[2]))
                elif parts[0] == "bar":
                    baro.append((int(parts[1]), float(parts[2])))
                elif parts[0] == "stp":
                    steps.append((int(parts[1]), float(parts[2])))
                elif parts[0] == "gnss":
                    gnss.append(
                        (int(parts[1]), int(parts[2]), int(parts[3]), float(parts[4]))
                    )
            except (ValueError, IndexError):
                continue

    print()
    print("SENSOR LOG")
    for kind, count in sorted(kinds.items()):
        print(f"  {kind:<28} {count}")
    if anchor:
        print(f"  {'wall-clock anchor':<28} epoch {anchor[1]}")

    if baro:
        span_s = (baro[-1][0] - baro[0][0]) / 1e9
        hpa = [b[1] for b in baro]
        # ~8.4 m per hPa near sea level. Relative only — absolute pressure is
        # weather, and a submersion reads as an ~820 m drop per metre of water.
        drop_m = (max(hpa) - min(hpa)) * 8.4
        print()
        print(f"  barometer: {span_s/60:.1f} min, {min(hpa):.2f}-{max(hpa):.2f} hPa")
        print(f"             = {drop_m:.1f} m of apparent elevation range")
        if drop_m > 200:
            print("             WARNING: >200 m range — check for submersion spikes")

    if steps:
        walked = steps[-1][1] - steps[0][1]
        print(f"  steps: {walked:.0f} over the log")

    if gnss:
        used = [g[2] for g in gnss]
        cn0 = [g[3] for g in gnss]
        print()
        print("  GNSS STATUS — the channel coords.accuracy cannot give you")
        fmt("satellites used", used, "")
        fmt("mean top-4 C/N0", cn0, "dBHz")
        # Below ~4 satellites there is no 3D fix at all: that is a real outage,
        # as opposed to a fix that is merely wrong, and telling those apart is
        # what decides whether dead reckoning is worth building.
        starved = sum(1 for u in used if u < 4)
        print(f"  {'callbacks with <4 used':<28} {starved} of {len(used)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", help="pulled logjam-offline.db (with its -wal)")
    parser.add_argument("track_id", nargs="?", help="defaults to the most recent")
    parser.add_argument("--sensors", help="a logjam-sensors CSV for the same track")
    args = parser.parse_args()

    db = sqlite3.connect(f"file:{args.database}?mode=ro", uri=True)
    track = pick_track(db, args.track_id)
    print(f"TRACK {track[0]}  {track[2]}  started {track[5]}")
    print(f"  stored distance {track[4]/1000:.2f} km over {track[3]} points")
    print()
    report_points(db, track[0])
    report_rejected(db, track[0])
    if args.sensors:
        report_sensors(args.sensors)


if __name__ == "__main__":
    main()
