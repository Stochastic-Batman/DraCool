"""Most docstrings in this file were added by Claude Sonnet 5."""

from __future__ import annotations

import math
from dataclasses import dataclass

import geopandas as gpd
import networkx as nx
import numpy as np
import osmnx as ox
from shapely.geometry import LineString

from dracool.cities import City
from dracool.crs import to_utm


@dataclass(frozen=True)
class StreetGraph:
    """The node and edge tables of the data contract, in EPSG:4326."""

    crs: str
    node_ids: np.ndarray
    lon: np.ndarray
    lat: np.ndarray
    u: np.ndarray
    v: np.ndarray
    length_m: np.ndarray
    geometry: np.ndarray

    @property
    def node_count(self) -> int:
        return len(self.node_ids)

    @property
    def edge_count(self) -> int:
        return len(self.u)


def oriented(line: LineString, start: tuple[float, float]) -> LineString:
    """The same polyline, running from whichever end is nearer `start`.

    OSMnx keeps a simplified edge's geometry in the direction the OSM way was
    drawn, which after collapsing the two directions has nothing to do with
    which endpoint we ended up calling u. Most of the fixture comes back v to u.
    Left alone, a route drawn by concatenating its edges would zigzag between
    their endpoints.
    """
    first, last = line.coords[0], line.coords[-1]
    if math.dist(first, start) <= math.dist(last, start):
        return line
    return line.reverse()


def street_graph(graph: nx.MultiDiGraph, city: City | None = None) -> StreetGraph:
    """Node and edge tables from an OSMnx graph, with l(e) measured in UTM.

    A walking network is undirected, so the two directions OSMnx returns are
    collapsed into one edge. Parallel ways between the same pair of nodes stay
    separate: they are different streets and carry different shade.
    """
    undirected = ox.convert.to_undirected(graph)
    nodes = ox.graph_to_gdfs(undirected, edges=False)
    edges = ox.graph_to_gdfs(undirected, nodes=False).reset_index()

    index = {osmid: i for i, osmid in enumerate(nodes.index)}
    lon = nodes.geometry.x.to_numpy()
    lat = nodes.geometry.y.to_numpy()
    u = np.array([index[osmid] for osmid in edges["u"]], dtype=np.int64)
    v = np.array([index[osmid] for osmid in edges["v"]], dtype=np.int64)

    geometry = np.array(
        [oriented(line, (lon[i], lat[i])) for line, i in zip(edges.geometry, u, strict=True)],
        dtype=object,
    )

    length_m = to_utm(edges, city).length.to_numpy()

    return StreetGraph(
        crs=nodes.crs.to_string(),
        node_ids=nodes.index.to_numpy(),
        lon=lon,
        lat=lat,
        u=u,
        v=v,
        length_m=length_m,
        geometry=geometry,
    )


def edge_frame(streets: StreetGraph, city: City | None = None) -> gpd.GeoDataFrame:
    """The edges as a projected frame, for computing sigma against buildings."""
    frame = gpd.GeoDataFrame(
        {"u": streets.u, "v": streets.v, "length_m": streets.length_m},
        geometry=list(streets.geometry),
        crs=streets.crs,
    )
    return to_utm(frame, city)
