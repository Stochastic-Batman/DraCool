from __future__ import annotations

import math
from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.geometry.base import BaseGeometry

from tenshadows.constants import CONSTANTS
from tenshadows.shadows import shadow_length
from tenshadows.solar import SunPosition


# All three estimators here compute the same quantity, Definition 1, by
# different routes. That is the point: Proposition 2 claims the ray cast the
# browser runs is equivalent to membership of the polygon union, and the only
# way to hold that claim honest is to implement both and compare them.


def sample_offsets(length_m: float, spacing_m: float | None = None) -> np.ndarray:
    spacing = spacing_m if spacing_m is not None else CONSTANTS.sampling.spacing_m
    count = max(1, math.ceil(length_m / spacing))
    return (np.arange(count) + 0.5) * (length_m / count)


def sample_xy(edge: LineString, spacing_m: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    points = shapely.line_interpolate_point(edge, sample_offsets(edge.length, spacing_m))
    return shapely.get_x(points), shapely.get_y(points)


@dataclass(frozen=True)
class Occluders:
    """Footprints and heights behind a static index."""

    geometries: np.ndarray
    heights_m: np.ndarray
    tree: shapely.STRtree

    @classmethod
    def from_frame(cls, buildings: gpd.GeoDataFrame) -> Occluders:
        geometries = buildings.geometry.to_numpy()
        return cls(
            geometries=geometries,
            heights_m=buildings["height_m"].to_numpy(dtype=float),
            tree=shapely.STRtree(geometries),
        )

    def shadow_lengths(self, sun: SunPosition) -> np.ndarray:
        return np.array([shadow_length(h, sun) for h in self.heights_m], dtype=float)


def raycast_shaded(xs: np.ndarray, ys: np.ndarray, occluders: Occluders, sun: SunPosition):
    """Proposition 2, point by point.

    Look towards the sun and walk; you are shaded if you meet a building before
    going further than that building's own shadow length. No union is built at
    all, which is what makes this cheap enough for the browser.
    """
    lengths = occluders.shadow_lengths(sun)
    east, north = sun.horizontal_direction
    reach = float(lengths.max()) if len(lengths) else 0.0

    shaded = np.zeros(len(xs), dtype=bool)
    if reach == 0.0:
        return shaded

    for i, (x, y) in enumerate(zip(xs, ys, strict=True)):
        # One query at the furthest any building could possibly reach, then the
        # real test per candidate at that building's own length.
        probe = LineString([(x, y), (x + reach * east, y + reach * north)])
        for idx in occluders.tree.query(probe):
            span = lengths[idx]
            ray = LineString([(x, y), (x + span * east, y + span * north)])
            if ray.intersects(occluders.geometries[idx]):
                shaded[i] = True
                break
    return shaded


def fraction_exact(edge: LineString, shadows: BaseGeometry, sun: SunPosition) -> float:
    """Definition 1 itself: the shaded length over the total length."""
    if sun.is_night:
        return 1.0
    if edge.length == 0.0:
        return 1.0
    return edge.intersection(shadows).length / edge.length


def fraction_sampled(edge: LineString, shadows: BaseGeometry, sun: SunPosition) -> float:
    """Estimator deciding membership against the built union."""
    if sun.is_night:
        return 1.0
    xs, ys = sample_xy(edge)
    return float(np.mean(shapely.intersects_xy(shadows, xs, ys)))


def fraction_raycast(edge: LineString, occluders: Occluders, sun: SunPosition) -> float:
    """Estimator deciding membership by Proposition 2."""
    if sun.is_night:
        return 1.0
    xs, ys = sample_xy(edge)
    return float(np.mean(raycast_shaded(xs, ys, occluders, sun)))
