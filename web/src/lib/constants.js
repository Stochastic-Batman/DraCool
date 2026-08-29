import shared from "../../../shared/constants.json";


// The Python side checks the same number in constants.py. Both languages read
// this one file, so the only way they can disagree about a_min or Delta is if
// one of them is running against a schema it does not understand.
const SUPPORTED_VERSION = 1;

if (shared.version !== SUPPORTED_VERSION) {
  throw new Error(
    `shared/constants.json is version ${shared.version}, this client supports ${SUPPORTED_VERSION}.`,
  );
}

export const SUNSET_ALTITUDE_DEG = shared.solar.sunset_altitude_deg;
export const MIN_ALTITUDE_DEG = shared.solar.min_altitude_deg;
export const MAX_SHADOW_LENGTH_M = shared.shadow.max_length_m;
export const SAMPLE_SPACING_M = shared.sampling.spacing_m;

// Keyless vector tiles. Set to null to draw on a bare background instead; the
// city data does not depend on it, and neither does anything computed.
export const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
