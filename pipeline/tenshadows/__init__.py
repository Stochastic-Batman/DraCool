"""TenShadows data pipeline.

Fetches OpenStreetMap street networks and building footprints, resolves
building heights from sparse OSM tags, and exports pre-projected static
artifacts for the browser client to route over.

Note that this package does NOT pre-compute shadow fractions. A shadow
fraction is a function of the sun's position, and the sun moves, so baking one
into the artifacts would freeze the app at a single instant. Section 5.3 of
``docs/TenShadows.pdf`` derives the ray-casting criterion that lets the client
compute shade live instead. The polygon machinery in this package exists as the
reference implementation those client-side results are tested against.
"""

from __future__ import annotations

from tenshadows.cities import CITIES, City, all_cities, get_city
from tenshadows.constants import CONSTANTS, Constants, load_constants


__version__ = "0.1.0"

__all__ = [
    "CITIES",
    "CONSTANTS",
    "City",
    "Constants",
    "__version__",
    "all_cities",
    "get_city",
    "load_constants",
]
