from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

import suncalc

from tenshadows.constants import CONSTANTS


@dataclass(frozen=True)
class SunPosition:
    """Where the sun is, in the horizontal system of Section 2.3."""

    altitude_deg: float
    azimuth_deg: float

    @property
    def is_night(self) -> bool:
        return self.altitude_deg <= CONSTANTS.solar.sunset_altitude_deg

    # The unit vector towards the sun in the ENU frame, s-hat.
    @property
    def direction(self) -> tuple[float, float, float]:
        a = math.radians(self.altitude_deg)
        A = math.radians(self.azimuth_deg)
        return (math.cos(a) * math.sin(A), math.cos(a) * math.cos(A), math.sin(a))

    # The horizontal unit vector towards the sun, u-hat. Azimuth only.
    @property
    def horizontal_direction(self) -> tuple[float, float]:
        A = math.radians(self.azimuth_deg)
        return (math.sin(A), math.cos(A))


def sun_position(when: datetime, lat: float, lon: float) -> SunPosition:
    """The solar position oracle of Section 3.1. ``when`` must be timezone-aware."""
    if when.tzinfo is None:
        raise ValueError(
            f"sun_position() needs a timezone-aware datetime, got {when!r}. A naive "
            f"one would be read as UTC and silently move the sun by the local offset."
        )

    # suncalc takes longitude before latitude, and reports radians clockwise
    # from south. Remark 2: the conversion to north-based happens here, once,
    # and no south-based angle exists anywhere else in the codebase.
    raw = suncalc.get_position(when, lon, lat)

    return SunPosition(
        altitude_deg=math.degrees(float(raw["altitude"])),
        azimuth_deg=math.degrees(float(raw["azimuth"]) + math.pi) % 360.0,
    )
