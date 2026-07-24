/**
 * Sun-position geometry for the PV forecast's incidence-angle physics.
 *
 * Uses the Spencer (1971) Fourier series for solar declination and the
 * equation of time — accurate to a few tenths of a degree, which is far more
 * than the incidence-angle modifier needs. Pure math, no env/DB, so it stays
 * importable from tests and other pure model code.
 */

const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;

export interface SunPosition {
  /** Sun elevation above the horizon, degrees (negative = below horizon). */
  elevationDeg: number;
  /** Sun azimuth, degrees (0 = south, -90 = east, 90 = west) — the project's panel convention. */
  azimuthDeg: number;
}

/** Sun elevation and azimuth at `atMs` (UTC epoch ms) for a location. */
export function sunPosition(latitudeDeg: number, longitudeDeg: number, atMs: number): SunPosition {
  const date = new Date(atMs);
  const yearStartMs = Date.UTC(date.getUTCFullYear(), 0, 1);
  // Fractional year angle, radians (0 at Jan 1, 2π a "year" of 365 days later).
  const gamma = ((atMs - yearStartMs) / DAY_MS) * ((2 * Math.PI) / 365);

  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const eqOfTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // True solar time: clock UTC corrected for longitude (4 min/degree) and the
  // equation of time; the hour angle is its offset from solar noon.
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const solarMin = utcMin + 4 * longitudeDeg + eqOfTimeMin;
  const hourAngle = (solarMin / 4 - 180) * DEG;

  const lat = latitudeDeg * DEG;
  const sinElevation =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat),
  );

  return { elevationDeg: Math.asin(sinElevation) / DEG, azimuthDeg: azimuth / DEG };
}

/**
 * Cosine of the angle of incidence between the sun and a tilted panel's
 * normal. ≤ 0 means the sun is behind the plane (no direct beam hits it).
 */
export function cosAoi(sun: SunPosition, tiltDeg: number, panelAzimuthDeg: number): number {
  const elevation = sun.elevationDeg * DEG;
  const tilt = tiltDeg * DEG;
  return (
    Math.sin(elevation) * Math.cos(tilt) +
    Math.cos(elevation) * Math.sin(tilt) * Math.cos((sun.azimuthDeg - panelAzimuthDeg) * DEG)
  );
}
