from __future__ import annotations

import numpy as np


# This exists so that Proposition 3 can be checked against a real graph, 
# and so the rejected alternative of Section 6.2 can be shown to break A* 
# rather than only argued to.


def edge_cost(length_m: float, sigma: float, w: float) -> float:
    return length_m * (1.0 + w * (1.0 - sigma))


def discounted_cost(length_m: float, sigma: float, w: float) -> float:
    # The alternative Section 6.2 rejects: c'(e) = l(e) * (1 - w * sigma(e))
    return length_m * (1.0 - w * sigma)


def sun_exposure(lengths_m: np.ndarray, sigmas: np.ndarray) -> float:
    # Metres of sunlit walking along a path, sum of l(e) * (1 - sigma(e))
    return float(np.sum(np.asarray(lengths_m) * (1.0 - np.asarray(sigmas))))
