from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

import shapely

from dracool.cities import all_cities
from dracool.constants import CONSTANTS
from dracool.shadows import shadow_displacement, shadow_length
from dracool.solar import SunPosition, sun_position


# Section 3 and Section 5 are implemented twice, here and in the browser. This
# records what the Python implementation answers, so the JavaScript suite can
# assert it answers the same. Not tests: the output is a committed artifact
# consumed by another language.
#
# The inputs below are fixed rather than sampled, for two reasons. The two
# implementations can only be compared if both are asked the same question, so
# the timestamps and places have to be pinned. And a fixed grid means any diff
# in the output file is a real change in behaviour, which is what makes
# reviewing that diff worth doing.
REFERENCE_DIR: Final[Path] = Path(__file__).resolve().parents[2] / "fixtures" / "reference"

# Both equinoxes and both solstices, sampled every three hours of UTC. The
# solstices are the extremes of solar declination and the equinoxes the middle,
# so the four dates bracket the year rather than sampling it.
DATES: Final[tuple[tuple[int, int, int], ...]] = (
    (2026, 3, 20),
    (2026, 6, 21),
    (2026, 9, 22),
    (2026, 12, 21),
)
HOURS: Final[tuple[int, ...]] = (0, 3, 6, 9, 12, 15, 18, 21)

# The defined cities are both northern and both mid-latitude. These catch a
# hemisphere sign error, an equatorial one, and a polar one, which those cannot.
EXTRA_SITES: Final[tuple[tuple[str, float, float], ...]] = (
    ("sydney", -33.8688, 151.2093),
    ("quito", -0.1807, -78.4678),
    ("tromso", 69.6492, 18.9553),
)


def _sites() -> list[tuple[str, float, float]]:
    cities = [(c.key, c.center_lat, c.center_lon) for c in all_cities()]
    return sorted(cities + list(EXTRA_SITES))


def solar_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for name, lat, lon in _sites():
        for year, month, day in DATES:
            for hour in HOURS:
                when = datetime(year, month, day, hour, tzinfo=UTC)
                sun = sun_position(when, lat=lat, lon=lon)
                cases.append(
                    {
                        "site": name,
                        "lat": lat,
                        "lon": lon,
                        "utc": when.isoformat().replace("+00:00", "Z"),
                        "altitude_deg": round(sun.altitude_deg, 9),
                        "azimuth_deg": round(sun.azimuth_deg, 9),
                        "direction": [round(v, 9) for v in sun.direction],
                        "horizontal_direction": [round(v, 9) for v in sun.horizontal_direction],
                    }
                )
    return cases


# Altitudes deliberately straddle a_min = 5 degrees, since that is where the
# Section 3.3 cap switches on and where an implementation is most likely to
# disagree with this one.
HEIGHTS_M: Final[tuple[float, ...]] = (3.0, 8.0, 15.0, 40.0)
ALTITUDES_DEG: Final[tuple[float, ...]] = (1.0, 3.0, 4.999, 5.0, 10.0, 30.0, 45.0, 70.0, 89.0)
AZIMUTHS_DEG: Final[tuple[float, ...]] = (0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0)


def shadow_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for height in HEIGHTS_M:
        for altitude in ALTITUDES_DEG:
            for azimuth in AZIMUTHS_DEG:
                sun = SunPosition(altitude_deg=altitude, azimuth_deg=azimuth)
                dx, dy = shadow_displacement(height, sun)
                cases.append(
                    {
                        "height_m": height,
                        "altitude_deg": altitude,
                        "azimuth_deg": azimuth,
                        "length_m": round(shadow_length(height, sun), 9),
                        "displacement": [round(dx, 9), round(dy, 9)],
                    }
                )
    return cases


# A small scene rather than the whole fixture: self-contained, so the browser
# suite needs nothing but this file, and small enough to commit. Sun positions
# are given directly as (a, A) because solar.json already pins the timestamp to
# position step; this file is about what happens after it.
SCENE_SIDE_M: Final[float] = 260.0
SCENE_SUNS: Final[tuple[tuple[str, float, float], ...]] = (
    ("capped", 3.0, 100.0),  # below a_min, so the Section 3.3 cap is in force
    ("low", 8.0, 100.0),
    ("high", 55.0, 180.0),
    ("night", -5.0, 270.0),  # Definition 1's convention: sigma = 1 everywhere
)


def shade_cases() -> dict[str, Any]:
    """Footprints, edges and their shadow fractions for one small scene.

    Coordinates are metres in a local frame whose origin is stated in the file,
    deliberately not degrees. Projection is tested on its own; this file exists
    to test Proposition 2 and the Section 5.2 sampling, and feeding both
    languages identical metric coordinates keeps a projection difference from
    being mistaken for a shading difference.
    """
    import osmnx as ox

    from dracool.cities import get_city
    from dracool.crs import to_utm, utm_crs_for
    from dracool.fetch import load_fixture_buildings, load_fixture_graph
    from dracool.fraction import Occluders, fraction_raycast
    from dracool.heights import resolve_frame

    city = get_city("tbilisi")
    buildings = to_utm(resolve_frame(load_fixture_buildings()), city).reset_index(drop=True)
    crs = utm_crs_for(buildings)
    edges = ox.graph_to_gdfs(ox.project_graph(load_fixture_graph(), to_crs=crs), nodes=False)

    minx, miny, maxx, maxy = buildings.total_bounds
    ox0, oy0 = (minx + maxx) / 2.0, (miny + maxy) / 2.0
    scene = shapely.box(
        ox0 - SCENE_SIDE_M / 2,
        oy0 - SCENE_SIDE_M / 2,
        ox0 + SCENE_SIDE_M / 2,
        oy0 + SCENE_SIDE_M / 2,
    )

    # Clip both to the same box. Sigma is then computed from exactly the
    # buildings this file carries, so the scene is self-consistent even though
    # buildings outside it would shade differently in the real city.
    inside = buildings[buildings.intersects(scene)].reset_index(drop=True)
    edges = edges[edges.intersects(scene)].reset_index(drop=True)
    occluders = Occluders.from_frame(inside)

    suns = [
        {"label": label, "altitude_deg": altitude, "azimuth_deg": azimuth}
        for label, altitude, azimuth in SCENE_SUNS
    ]
    sigma = [
        [
            round(
                fraction_raycast(geometry, occluders, SunPosition(altitude_deg=a, azimuth_deg=A)),
                9,
            )
            for _, a, A in SCENE_SUNS
        ]
        for geometry in edges.geometry
    ]

    def local(geometry: Any) -> list[list[float]]:
        return [
            [round(x - ox0, 3), round(y - oy0, 3)] for x, y in shapely.get_coordinates(geometry)
        ]

    return {
        "units": "metres, local frame",
        "origin_utm": {"epsg": crs.to_epsg(), "easting": round(ox0, 3), "northing": round(oy0, 3)},
        "sampling_spacing_m": CONSTANTS.sampling.spacing_m,
        "suns": suns,
        "buildings": [
            {"height_m": round(float(h), 3), "polygon": local(g)}
            for g, h in zip(inside.geometry, inside["height_m"], strict=True)
        ],
        "edges": [
            {"polyline": local(g), "sigma": s} for g, s in zip(edges.geometry, sigma, strict=True)
        ],
    }


def _write(target: Path, comment: str, cases: list[dict[str, Any]]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {"_comment": comment, "cases": cases}
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_reference(directory: Path | None = None) -> Path:
    target = directory or REFERENCE_DIR
    generated = (
        "Generated by `python -m dracool.reference`. What the Python pipeline answers, "
        "asserted by the browser test suite so the two implementations cannot drift apart. "
        "Regenerate deliberately: a change here is a change in behaviour."
    )
    _write(
        target / "solar.json",
        f"{generated} Section 3. Angles in degrees, azimuth clockwise from north.",
        solar_cases(),
    )
    _write(
        target / "shadow_points.json",
        f"{generated} Proposition 1 and the Section 3.3 cap. Lengths in metres.",
        shadow_cases(),
    )

    scene = shade_cases()
    scene["_comment"] = (
        f"{generated} Proposition 2 and the Section 5.2 sampling, on one small self-contained "
        f"scene. Coordinates are metres in the local frame described by origin_utm, not degrees."
    )
    (target / "shade_mini.json").write_text(json.dumps(scene, indent=2) + "\n", encoding="utf-8")

    return target


if __name__ == "__main__":
    print(write_reference())
