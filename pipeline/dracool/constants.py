from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Final


SUPPORTED_VERSION: Final[int] = 1
CONSTANTS_PATH: Final[Path] = Path(__file__).resolve().parents[2] / "shared" / "constants.json"


@dataclass(frozen=True)
class SolarConstants:
    """Thresholds on the solar altitude."""

    sunset_altitude_deg: float
    min_altitude_deg: float


@dataclass(frozen=True)
class ShadowConstants:
    """Limits on the projected shadow geometry."""

    max_length_m: float


@dataclass(frozen=True)
class SamplingConstants:
    """Discretisation of an edge into sample points."""

    spacing_m: float


@dataclass(frozen=True)
class HeightConstants:
    """Resolution of a building height from sparse OSM tags."""

    storey_height_m: float
    default_height_m: float
    by_building_type_m: Mapping[str, float]

    def for_type(self, building_type: str | None) -> float:
        """Return the type-based default height for an OSM ``building`` value.

        Falls back to :attr:`default_height_m` for a missing or unrecognised
        type. This is the last step of the chain described in Section 7; the
        caller is responsible for having already tried the ``height`` tag and
        then ``building:levels``.
        """
        if building_type is None:
            return self.default_height_m
        return self.by_building_type_m.get(building_type, self.default_height_m)


@dataclass(frozen=True)
class Constants:
    """The whole of ``shared/constants.json``, parsed and typed."""

    version: int
    solar: SolarConstants
    shadow: ShadowConstants
    sampling: SamplingConstants
    heights: HeightConstants


def load_constants(path: Path | None = None) -> Constants:
    """Read and validate ``shared/constants.json``.

    Raises:
        FileNotFoundError: if the shared file is missing, which usually means
            the package was installed without the repository around it.
        ValueError: if the file's schema version is not
            :data:`SUPPORTED_VERSION`.
    """
    source = path or CONSTANTS_PATH
    if not source.is_file():
        raise FileNotFoundError(
            f"Shared constants not found at {source}. This file is the single "
            f"source of truth for both the Python pipeline and the browser "
            f"client; the pipeline cannot run without it."
        )

    raw: dict[str, Any] = json.loads(source.read_text(encoding="utf-8"))

    version = int(raw["version"])
    if version != SUPPORTED_VERSION:
        raise ValueError(
            f"{source} declares schema version {version}, but this build of "
            f"dracool supports version {SUPPORTED_VERSION}. Update the "
            f"package or the file."
        )

    solar_raw = raw["solar"]
    shadow_raw = raw["shadow"]
    sampling_raw = raw["sampling"]
    heights_raw = raw["heights"]

    return Constants(
        version=version,
        solar=SolarConstants(
            sunset_altitude_deg=float(solar_raw["sunset_altitude_deg"]),
            min_altitude_deg=float(solar_raw["min_altitude_deg"]),
        ),
        shadow=ShadowConstants(
            max_length_m=float(shadow_raw["max_length_m"]),
        ),
        sampling=SamplingConstants(
            spacing_m=float(sampling_raw["spacing_m"]),
        ),
        heights=HeightConstants(
            storey_height_m=float(heights_raw["storey_height_m"]),
            default_height_m=float(heights_raw["default_height_m"]),
            by_building_type_m=MappingProxyType(
                {str(k): float(v) for k, v in heights_raw["by_building_type_m"].items()}
            ),
        ),
    )


# Import this rather than calling `load_constants` repeatedly.
CONSTANTS: Final[Constants] = load_constants()
