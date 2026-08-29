from __future__ import annotations

from pathlib import Path
from typing import Final

import geopandas as gpd
import networkx as nx
import osmnx as ox

from tenshadows.cities import City


CACHE_DIR: Final[Path] = Path(__file__).resolve().parents[1] / ".cache"
FIXTURE_DIR: Final[Path] = Path(__file__).resolve().parents[1] / "fixtures" / "mini"

# About 1 km2 over Abanotubani and Sololaki in old Tbilisi, as (west, south,
# east, north). Chosen because the footprints there are dense and irregular:
# Remark 3 says a re-entrant corner is exactly where the convex-hull shortcut
# for shadows goes wrong, so the fixture should contain plenty of them.
MINI_BBOX: Final[tuple[float, float, float, float]] = (44.8005, 41.6860, 44.8125, 41.6950)

FIXTURE_COLUMNS: Final[tuple[str, ...]] = ("geometry", "building", "height", "building:levels")


def configure_cache() -> None:
    """Let OSMnx cache Overpass responses so iterating does not re-download."""
    ox.settings.use_cache = True
    ox.settings.cache_folder = str(CACHE_DIR)


def polygons_only(features: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Drop `building` tags carried on nodes rather than ways.

    A handful per city, and they have no footprint at all. The LoD1 model of
    Section 4.1 extrudes a polygon, and every later stage assumes one, so they
    are removed here rather than crashing the Minkowski sum later.
    """
    return features[features.geometry.geom_type.isin(("Polygon", "MultiPolygon"))]


def fetch_buildings(city: City) -> gpd.GeoDataFrame:
    configure_cache()
    return polygons_only(ox.features_from_place(city.osm_query, tags={"building": True}))


def fetch_graph(city: City) -> nx.MultiDiGraph:
    configure_cache()
    return ox.graph_from_place(city.osm_query, network_type="walk")


def load_fixture_buildings() -> gpd.GeoDataFrame:
    return gpd.read_file(FIXTURE_DIR / "buildings.geojson")


def load_fixture_graph() -> nx.MultiDiGraph:
    return ox.load_graphml(FIXTURE_DIR / "graph.graphml")


def write_fixture(directory: Path | None = None) -> Path:
    """Rebuild the committed test fixture from OSM. Hits the network; run rarely.

    Everything downstream of Phase 2 develops and tests against this extract, so
    that the suite stays offline, fast and deterministic, and CI never depends
    on Overpass being up.
    """
    configure_cache()
    target = directory or FIXTURE_DIR
    target.mkdir(parents=True, exist_ok=True)

    buildings = polygons_only(ox.features_from_bbox(MINI_BBOX, tags={"building": True}))
    keep = [c for c in FIXTURE_COLUMNS if c in buildings.columns]
    buildings = buildings[keep].reset_index(drop=True)
    # Six decimals is about 11 cm, more than enough
    buildings.to_file(target / "buildings.geojson", driver="GeoJSON", COORDINATE_PRECISION=6)

    graph = ox.graph_from_bbox(MINI_BBOX, network_type="walk")
    ox.save_graphml(graph, target / "graph.graphml")

    return target
