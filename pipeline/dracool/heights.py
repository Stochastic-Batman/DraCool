from __future__ import annotations

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Final

import geopandas as gpd

from dracool.constants import CONSTANTS


# Nothing standing is taller than this, so a larger tag is a typo or a unit
# mix-up. Rejecting it drops through to the next step of the chain rather than
# casting a kilometre of shadow.
MAX_PLAUSIBLE_M: Final[float] = 1000.0

FEET_TO_M: Final[float] = 0.3048

# "12", "12.5", "12 m", "12m", "40 ft", "40'". Anything else falls through.
_MEASURE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(m|metre|metres|meter|meters|ft|feet|')?\s*$", re.I)


class HeightSource(StrEnum):
    TAG = "tag"
    LEVELS = "levels"
    TYPE = "type"
    DEFAULT = "default"


@dataclass(frozen=True)
class Height:
    meters: float
    source: HeightSource


def _text(value: Any) -> str | None:
    """OSM tags arrive from pandas, so absence shows up as NaN as well as None."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).strip()
    return text or None


def parse_height(value: Any) -> float | None:
    """Metres from an OSM `height` tag, or None if it is absent or unusable."""
    text = _text(value)
    if text is None:
        return None
    match = _MEASURE.match(text)
    if match is None:
        return None

    metres = float(match.group(1))
    unit = (match.group(2) or "m").lower()
    if unit in ("ft", "feet", "'"):
        metres *= FEET_TO_M

    return metres if 0.0 < metres <= MAX_PLAUSIBLE_M else None


def parse_levels(value: Any) -> float | None:
    """Storey count from an OSM `building:levels` tag, or None."""
    text = _text(value)
    if text is None:
        return None

    # A semicolon list tags a building whose parts differ. Under the single
    # height of the LoD1 model the tallest part is what casts the shadow.
    counts = []
    for part in text.split(";"):
        match = _MEASURE.match(part)
        if match is not None and match.group(2) is None:
            counts.append(float(match.group(1)))

    if not counts:
        return None
    levels = max(counts)
    return levels if 0.0 < levels <= 200.0 else None


def resolve_height(tags: Mapping[str, Any]) -> Height:
    """The fallback chain of Section 7, reporting which step supplied the answer."""
    metres = parse_height(tags.get("height"))
    if metres is not None:
        return Height(metres, HeightSource.TAG)

    levels = parse_levels(tags.get("building:levels"))
    if levels is not None:
        return Height(levels * CONSTANTS.heights.storey_height_m, HeightSource.LEVELS)

    building = _text(tags.get("building"))
    if building is not None and building in CONSTANTS.heights.by_building_type_m:
        return Height(CONSTANTS.heights.by_building_type_m[building], HeightSource.TYPE)

    return Height(CONSTANTS.heights.default_height_m, HeightSource.DEFAULT)


def resolve_frame(buildings: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Return a copy carrying `height_m` and `height_source` columns."""
    resolved = [resolve_height(row) for row in buildings.to_dict("records")]
    out = buildings.copy()
    out["height_m"] = [h.meters for h in resolved]
    out["height_source"] = [str(h.source) for h in resolved]
    return out


def provenance(buildings: gpd.GeoDataFrame) -> dict[str, float]:
    """What fraction of heights came from each step, for meta.json and the UI.

    Section 7 calls sparse height data the dominant error source in the system.
    A router built on it should be able to say how much of its input is guessed.
    """
    if len(buildings) == 0:
        return {str(source): 0.0 for source in HeightSource}
    counts = buildings["height_source"].value_counts()
    total = len(buildings)
    return {str(source): float(counts.get(str(source), 0)) / total for source in HeightSource}
