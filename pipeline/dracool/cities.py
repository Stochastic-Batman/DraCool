from __future__ import annotations

import math
import re
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Final


CITIES_DIR: Final[Path] = Path(__file__).resolve().parents[1] / "cities"

KEY_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


@dataclass(frozen=True)
class City:
    """A city the pipeline knows how to build."""

    # Short lowercase identifier, taken from the filename stem. Used on the
    # command line and as the output directory name under web/static/data/.
    key: str

    # Human-readable name, shown in the client.
    display_name: str

    # Query string handed to OSMnx to resolve the city boundary.
    osm_query: str

    # IANA zone name, travelling to the client in meta.json. Stated rather than
    # derived: the offset is a political fact about a place, not a function of
    # its longitude, and getting it wrong moves the sun by a whole hour.
    timezone: str

    # Longitude of the ENU projection origin, in degrees east.
    center_lon: float

    # Latitude of the ENU projection origin, in degrees north.
    center_lat: float

    # The UTM zone this city falls in, as an EPSG code. Asserted against
    # estimate_utm_crs() rather than derived from it, so that a wrong
    # projection cannot reach the geometry stage. Derived from the centre when
    # the definition omits it.
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


def utm_epsg_for(lon: float, lat: float) -> int:
    """Return the UTM zone containing ``(lon, lat)`` as an EPSG code.

    The regular zone rule only. Norway and Svalbard widen and shift several
    zones, and this does not model those exceptions, which is why a city
    definition may state its zone explicitly instead.
    """
    zone = math.floor((lon + 180.0) / 6.0) + 1
    return (32600 if lat >= 0.0 else 32700) + zone


def _require(raw: Mapping[str, Any], path: Path, *keys: str) -> Any:
    """Fetch a nested key from a parsed definition, or explain what is missing."""
    node: Any = raw
    for depth, key in enumerate(keys):
        if not isinstance(node, Mapping) or key not in node:
            missing = ".".join(keys[: depth + 1])
            raise ValueError(f"{path}: missing required field {missing!r}.")
        node = node[key]
    return node


def load_city_file(path: Path) -> City:
    """Parse one city definition. The filename stem becomes the city key."""
    key = path.stem
    if not KEY_PATTERN.match(key):
        raise ValueError(
            f"{path}: filename {key!r} is not a usable city key. It becomes a "
            f"command-line argument and an output directory name, so it must be "
            f"lowercase letters, digits, hyphens and underscores only."
        )

    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as error:
        raise ValueError(f"{path}: not valid TOML. {error}") from error

    lon = float(_require(raw, path, "center", "lon"))
    lat = float(_require(raw, path, "center", "lat"))
    if not -180.0 <= lon <= 180.0:
        raise ValueError(f"{path}: center.lon is {lon}, outside [-180, 180].")
    if not -90.0 <= lat <= 90.0:
        raise ValueError(f"{path}: center.lat is {lat}, outside [-90, 90].")

    declared = raw.get("crs", {}).get("expected_utm_epsg")

    return City(
        key=key,
        display_name=str(_require(raw, path, "display_name")),
        osm_query=str(_require(raw, path, "osm_query")),
        timezone=str(_require(raw, path, "timezone")),
        center_lon=lon,
        center_lat=lat,
        expected_utm_epsg=int(declared) if declared is not None else utm_epsg_for(lon, lat),
    )


def load_cities(directory: Path | None = None) -> Mapping[str, City]:
    """Parse every ``*.toml`` in the city directory, sorted by key."""
    source = directory or CITIES_DIR
    if not source.is_dir():
        raise FileNotFoundError(
            f"City directory not found at {source}. Each city is defined by one "
            f"TOML file there; the pipeline has nothing to build without it."
        )

    cities = [load_city_file(path) for path in sorted(source.glob("*.toml"))]
    return MappingProxyType({city.key: city for city in cities})


CITIES: Final[Mapping[str, City]] = load_cities()


def get_city(key: str) -> City:
    """Look up a city by key.

    Raises:
        KeyError: if no city is defined under that key, with the known keys
            listed in the message.
    """
    try:
        return CITIES[key]
    except KeyError:
        known = ", ".join(sorted(CITIES)) or "none found"
        raise KeyError(
            f"Unknown city {key!r}. Defined cities: {known}. Add one by "
            f"creating {CITIES_DIR / (key + '.toml')}."
        ) from None


def all_cities() -> tuple[City, ...]:
    """Every defined city, ordered by key."""
    return tuple(CITIES.values())
