"""Most docstrings in this file were added by Claude Sonnet 5."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any, Final

import geopandas as gpd
import numpy as np
import shapely

from dracool.cities import City
from dracool.constants import CONSTANTS
from dracool.crs import WGS84, require_wgs84, utm_crs_for
from dracool.graph import StreetGraph
from dracool.heights import HeightSource, provenance


DATA_DIR: Final[Path] = Path(__file__).resolve().parents[2] / "web" / "static" / "data"

# About 11 cm, which is two orders of magnitude finer than the building heights
COORD_DECIMALS: Final[int] = 6

# `hs` in buildings.geojson. Numbers rather than strings because there is one
# per footprint and footprints are the largest artifact.
HEIGHT_CODES: Final[dict[str, int]] = {
    HeightSource.TAG: 0,
    HeightSource.LEVELS: 1,
    HeightSource.TYPE: 2,
    HeightSource.DEFAULT: 3,
}

ATTRIBUTION: Final[str] = "© OpenStreetMap contributors"
DATA_LICENSE: Final[str] = "ODbL-1.0"


def _rounded(values: np.ndarray, decimals: int) -> list[float]:
    return [float(v) for v in np.round(values, decimals)]


def footprint_parts(buildings: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return buildings[["geometry", "height_m", "height_source"]].explode(index_parts=False)


def building_frame(parts: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {
            "h": np.round(parts["height_m"].to_numpy(dtype=float), 2),
            "hs": [HEIGHT_CODES[source] for source in parts["height_source"]],
        },
        geometry=parts.geometry.to_numpy(),
        crs=parts.crs,
    )


def graph_payload(streets: StreetGraph) -> dict[str, Any]:
    """The columnar graph of the data contract.

    `coords` holds the interior points of each polyline only. Its first and
    last points are the nodes u and v, which the client already has, and on
    this city half the edges are straight and so carry nothing at all: the
    duplication was a fifth of the whole payload. An edge is drawn as node u,
    then its slice, then node v.

    `geom_offset` indexes `coords` itself rather than counting points, so that
    slice is coords[offset[i]:offset[i + 1]] with no arithmetic on the way.
    """
    coords: list[float] = []
    offsets: list[int] = [0]
    for line in streets.geometry:
        interior = np.round(shapely.get_coordinates(line), COORD_DECIMALS)[1:-1]
        coords.extend(float(value) for value in interior.ravel())
        offsets.append(len(coords))

    return {
        "crs": WGS84,
        "nodes": {
            "lon": _rounded(streets.lon, COORD_DECIMALS),
            "lat": _rounded(streets.lat, COORD_DECIMALS),
        },
        "edges": {
            "u": streets.u.tolist(),
            "v": streets.v.tolist(),
            "len": _rounded(streets.length_m, 3),
            "geom_offset": offsets,
            "coords": coords,
        },
    }


def meta_payload(
    city: City, streets: StreetGraph, buildings: gpd.GeoDataFrame, utm_epsg: int
) -> dict[str, Any]:
    minx, miny, maxx, maxy = buildings.total_bounds
    bbox = [
        min(minx, streets.lon.min()),
        min(miny, streets.lat.min()),
        max(maxx, streets.lon.max()),
        max(maxy, streets.lat.max()),
    ]

    return {
        "city": city.key,
        "display_name": city.display_name,
        "center": [round(city.center_lon, COORD_DECIMALS), round(city.center_lat, COORD_DECIMALS)],
        "bbox": [round(value, COORD_DECIMALS) for value in bbox],
        "utm_epsg": utm_epsg,
        "counts": {
            "nodes": streets.node_count,
            "edges": streets.edge_count,
            "buildings": len(buildings),
        },
        "height_provenance": provenance(buildings),
        "constants": {
            "storey_height_m": CONSTANTS.heights.storey_height_m,
            "default_height_m": CONSTANTS.heights.default_height_m,
        },
        "attribution": ATTRIBUTION,
        "data_license": DATA_LICENSE,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "pipeline_version": version("dracool"),
        "osm_snapshot": datetime.now(UTC).date().isoformat(),
    }


def export_city(
    city: City,
    streets: StreetGraph,
    buildings: gpd.GeoDataFrame,
    directory: Path | None = None,
) -> Path:
    """Write the three artifacts. `buildings` must already carry heights.

    Every output is EPSG:4326 and each one is checked rather than assumed.
    """
    target = directory or DATA_DIR / city.key
    target.mkdir(parents=True, exist_ok=True)

    parts = footprint_parts(buildings)
    footprints = require_wgs84(building_frame(parts))
    utm_epsg = utm_crs_for(footprints, city).to_epsg()
    # The graph carries its CRS as a string, so this is the assertion for it.
    require_wgs84(gpd.GeoDataFrame(geometry=list(streets.geometry), crs=streets.crs))

    footprints.to_file(
        target / "buildings.geojson", driver="GeoJSON", COORDINATE_PRECISION=COORD_DECIMALS
    )
    _write_json(target / "graph.json", graph_payload(streets))
    _write_json(target / "meta.json", meta_payload(city, streets, parts, utm_epsg))

    return target


def write_manifest(directory: Path | None = None) -> Path:
    """The list of cities the client offers, from what is actually on disk."""
    target = directory or DATA_DIR
    target.mkdir(parents=True, exist_ok=True)

    cities = []
    for path in sorted(target.glob("*/meta.json")):
        meta = json.loads(path.read_text(encoding="utf-8"))
        cities.append({key: meta[key] for key in ("city", "display_name", "center", "bbox")})

    manifest = target / "cities.json"
    _write_json(manifest, {"cities": cities})
    return manifest


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    # ensure_ascii=False: display_name and the attribution are text meant to be
    # read, and escaping them costs bytes in the artifact for nothing.
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text + "\n", encoding="utf-8")
