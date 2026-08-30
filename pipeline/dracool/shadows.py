"""`_boundary_rings` and `sweep` were written by Claude Sonnet 5."""

from __future__ import annotations

import math

import geopandas as gpd
import shapely
from shapely.affinity import translate
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

from dracool.constants import CONSTANTS
from dracool.solar import SunPosition


def shadow_length(height_m: float, sun: SunPosition) -> float:
    """L = h / tan(a), with the low-sun cap of Section 3.3."""
    if sun.is_night:
        raise ValueError(
            f"The sun is at {sun.altitude_deg:.2f} degrees, at or below the horizon, "
            f"where a building shadow means nothing. Definition 1 fixes sigma(e) = 1 "
            f"for every edge instead; the caller decides that, not this function."
        )

    length = height_m / math.tan(math.radians(sun.altitude_deg))
    if sun.altitude_deg < CONSTANTS.solar.min_altitude_deg:
        return min(length, CONSTANTS.shadow.max_length_m)
    return length


def shadow_displacement(height_m: float, sun: SunPosition) -> tuple[float, float]:
    """Proposition 1: d = -L * u-hat, pointing away from the sun."""
    length = shadow_length(height_m, sun)
    east, north = sun.horizontal_direction
    return (-length * east, -length * north)


def _boundary_rings(geom: BaseGeometry) -> list[shapely.LinearRing]:
    """Every ring of the boundary, holes included.

    Holes matter: the sweep of Section 4.2 is over the whole boundary, and a
    courtyard's inner wall casts shadow into the courtyard just as the outer
    wall casts it into the street.
    """
    parts = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    rings: list[shapely.LinearRing] = []
    for part in parts:
        rings.append(part.exterior)
        rings.extend(part.interiors)
    return rings


def sweep(geom: BaseGeometry, dx: float, dy: float) -> BaseGeometry:
    """The Minkowski sum B + [0, d] of Section 4.3.

    Assembled as the n + 2 pieces the specification names: the footprint, its
    translate, and one parallelogram per boundary edge. This is not
    hull(B union (B + d)) - Remark 3 shows that shortcut is correct only for
    convex footprints, and it reports shade over re-entrant corners that are
    in fact sunlit.
    """
    if dx == 0.0 and dy == 0.0:
        return geom

    pieces: list[BaseGeometry] = [geom, translate(geom, dx, dy)]

    for ring in _boundary_rings(geom):
        coords = list(ring.coords)
        for (x0, y0), (x1, y1) in zip(coords, coords[1:], strict=False):
            # An edge parallel to d sweeps no area. Skipping it keeps a
            # degenerate polygon out of the union.
            if abs((x1 - x0) * dy - (y1 - y0) * dx) == 0.0:
                continue
            # The four corners in order are the specification's hull() of them,
            # a parallelogram being convex.
            pieces.append(Polygon([(x0, y0), (x1, y1), (x1 + dx, y1 + dy), (x0 + dx, y0 + dy)]))

    return shapely.union_all(pieces)


def building_shadow(footprint: BaseGeometry, height_m: float, sun: SunPosition) -> BaseGeometry:
    """S_k for one building, on flat ground."""
    dx, dy = shadow_displacement(height_m, sun)
    return sweep(footprint, dx, dy)


def shadow_union(buildings: gpd.GeoDataFrame, sun: SunPosition) -> BaseGeometry:
    """S, the union of every building's shadow."""
    shadows = [
        building_shadow(geom, height, sun)
        for geom, height in zip(buildings.geometry, buildings["height_m"], strict=True)
    ]
    return shapely.union_all(shadows)
