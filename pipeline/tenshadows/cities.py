from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final


@dataclass(frozen=True)
class City:
    """A city the pipeline knows how to build."""

    # Short lowercase identifier. Used on the command line and as the output
    # directory name under ``web/static/data/``.
    key: str

    # Human-readable name, shown in the client.
    display_name: str

    # Query string handed to OSMnx to resolve the city boundary.
    osm_query: str

    # Longitude of the ENU projection origin, in degrees east.
    center_lon: float

    # Latitude of the ENU projection origin, in degrees north.
    center_lat: float

    # The UTM zone this city falls in, as an EPSG code. This is asserted
    # against ``estimate_utm_crs()`` rather than derived from it, so that a
    # wrong projection cannot reach the geometry stage.
    expected_utm_epsg: int

    @property
    def center(self) -> tuple[float, float]:
        """The projection origin as ``(lon, lat)``.

        Longitude first, matching EPSG:4326 axis order as GeoJSON requires and
        as the exported artifacts use throughout.

        This value is hand-specified and deliberately stable. It becomes the
        origin of the client's local East-North-Up frame (Section 3.2), so
        every projected coordinate in the browser is measured relative to it.
        Deriving it from the downloaded data instead would let it drift with
        every OSM re-download, shifting the whole local frame.
        """
        return (self.center_lon, self.center_lat)


TBILISI: Final[City] = City(
    key="tbilisi",
    display_name="Tbilisi",
    osm_query="Tbilisi, Georgia",
    center_lon=44.8336,
    center_lat=41.6941,
    expected_utm_epsg=32638,  # UTM zone 38N
)

SAARBRUECKEN: Final[City] = City(
    key="saarbruecken",
    display_name="Saarbrücken",
    osm_query="Saarbrücken, Germany",
    center_lon=7.0000,  # Section 2.1: to four decimal places, exactly 7.0
    center_lat=49.2326,
    expected_utm_epsg=32632,  # UTM zone 32N
)

CITIES: Final[Mapping[str, City]] = MappingProxyType(
    {city.key: city for city in (TBILISI, SAARBRUECKEN)}
)


def get_city(key: str) -> City:
    """Look up a city by :attr:`City.key`.

    Raises:
        KeyError: if no city is registered under that key, with the known keys
            listed in the message.
    """
    try:
        return CITIES[key]
    except KeyError:
        known = ", ".join(sorted(CITIES))
        raise KeyError(f"Unknown city {key!r}. Registered cities: {known}.") from None


def all_cities() -> tuple[City, ...]:
    """Every registered city, in registration order."""
    return tuple(CITIES.values())
