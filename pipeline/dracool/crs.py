from __future__ import annotations

import geopandas as gpd
from pyproj import CRS

from dracool.cities import City


WGS84: str = "EPSG:4326"


def utm_crs_for(gdf: gpd.GeoDataFrame, city: City | None = None) -> CRS:
    """The projected metric CRS to do geometry in, per Section 2.2.

    When a city is given its declared zone is asserted rather than trusted, so
    that a definition naming the wrong EPSG code fails here instead of quietly
    distorting every shadow downstream.
    """
    crs = gdf.estimate_utm_crs()
    if city is not None and crs.to_epsg() != city.expected_utm_epsg:
        raise ValueError(
            f"{city.key}: geometry falls in EPSG:{crs.to_epsg()}, but the city "
            f"definition declares EPSG:{city.expected_utm_epsg}. Fix the definition "
            f"or drop its [crs] block to derive the zone from the centre."
        )
    return crs


def to_utm(gdf: gpd.GeoDataFrame, city: City | None = None) -> gpd.GeoDataFrame:
    return gdf.to_crs(utm_crs_for(gdf, city))


def to_wgs84(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return gdf.to_crs(WGS84)


def require_wgs84(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Assert an export is in EPSG:4326. Section 2.2 makes this a hard rule."""
    if gdf.crs is None:
        raise ValueError("Refusing to export a frame with no CRS.")
    if CRS.from_user_input(gdf.crs).to_epsg() != 4326:
        raise ValueError(f"Exports must be EPSG:4326, got {gdf.crs.to_string()}.")
    return gdf
