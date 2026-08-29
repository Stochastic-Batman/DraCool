// Section 1.3 of the roadmap. The client works in a local ENU frame about the
// city centre, and the whole approximation lives in this file so that swapping
// it for proj4js means touching nothing else. meta.json ships utm_epsg for
// exactly that.
//
// x = R cos(phi0) (theta - theta0), y = R (phi - phi0). The error is the
// cos(phi) drift across the city, about tan(phi0) * dphi in relative terms:
// under a centimetre over the 200 m a ray can travel. It is never used for
// l(e), which is measured in true UTM by the pipeline and shipped in graph.json.
const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;


export function localFrame([lon0, lat0]) {
  const metresPerDegreeLon = EARTH_RADIUS_M * DEG * Math.cos(lat0 * DEG);
  const metresPerDegreeLat = EARTH_RADIUS_M * DEG;

  return {
    origin: [lon0, lat0],

    forward(lon, lat) {
      return [(lon - lon0) * metresPerDegreeLon, (lat - lat0) * metresPerDegreeLat];
    },

    inverse(x, y) {
      return [lon0 + x / metresPerDegreeLon, lat0 + y / metresPerDegreeLat];
    },

    // Doubles rather than floats: the arrays are metres across a whole city,
    // and on the largest city here the difference is a few megabytes against a
    // 35 MB download.
    forwardInto(lon, lat) {
      const count = lon.length;
      const x = new Float64Array(count);
      const y = new Float64Array(count);
      for (let i = 0; i < count; i += 1) {
        x[i] = (lon[i] - lon0) * metresPerDegreeLon;
        y[i] = (lat[i] - lat0) * metresPerDegreeLat;
      }
      return { x, y };
    },
  };
}
