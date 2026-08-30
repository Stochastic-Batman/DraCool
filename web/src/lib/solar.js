import SunCalc from "suncalc";
import { SUNSET_ALTITUDE_DEG } from "./constants.js";


// The mirror of pipeline/dracool/solar.py. suncalc@1.9 is the JavaScript
// original that suncalc-py ports, and it reproduces fixtures/reference/
// solar.json to 5e-10 degrees. suncalc@2 rewrote the series against
// Terrestrial Time and disagrees by up to a degree of azimuth, which is a
// degree of rotation on every shadow in the city. The pin is the contract.
const DEG = Math.PI / 180;


// Remark 2: suncalc reports radians clockwise from south. The conversion to
// north-based happens here, once, and no south-based angle exists anywhere
// else in the client.
export function sunPosition(when, lat, lon) {
  const raw = SunCalc.getPosition(when, lat, lon);
  return {
    alt: raw.altitude / DEG,
    azi: (((raw.azimuth / DEG + 180) % 360) + 360) % 360,
  };
}

export const isNight = (sun) => sun.alt <= SUNSET_ALTITUDE_DEG;

// s-hat, the unit vector towards the sun in the ENU frame.
export function direction({ alt, azi }) {
  const a = alt * DEG;
  const A = azi * DEG;
  return [Math.cos(a) * Math.sin(A), Math.cos(a) * Math.cos(A), Math.sin(a)];
}

// u-hat, the horizontal part. Azimuth only, which is why a shadow's direction
// does not depend on how high the sun is.
export function horizontal({ azi }) {
  const A = azi * DEG;
  return [Math.sin(A), Math.cos(A)];
}

// meta.json ships an IANA name and the oracle above wants UTC, so the slider's
// wall-clock reading has to be resolved through the city's own zone. Intl
// knows the offsets and their DST; the second pass is what makes an hour that
// the clocks moved across land on the right instant.
function offsetMs(tz, at) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const f = {};
  for (const { type, value } of parts) f[type] = value;
  const local = Date.UTC(f.year, f.month - 1, f.day, f.hour % 24, f.minute, f.second);
  return local - at.getTime();
}

export function zonedToUtc(tz, y, m, d, h, min) {
  const wall = Date.UTC(y, m - 1, d, h, min);
  const first = wall - offsetMs(tz, new Date(wall));
  return new Date(wall - offsetMs(tz, new Date(first)));
}

export function utcToZoned(tz, at) {
  return new Date(at.getTime() + offsetMs(tz, at));
}
