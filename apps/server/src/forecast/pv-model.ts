/**
 * The PV power model: irradiance + ambient conditions → expected AC watts for
 * one array. Provider-agnostic and pure, so any {@link SolarIrradianceProvider}
 * series can be turned into power by {@link ./solar-forecast}.
 *
 * Three physical corrections sit between plane-of-array irradiance and AC
 * output: the incidence-angle modifier (glass reflects glancing beam light),
 * the cell-temperature derate (hot cells lose voltage), and the static system
 * loss percentage. Each degrades gracefully to a simpler form when the provider
 * omits the input it needs.
 */

// Cell-temperature models. Fallback (NOCT): cells run ~25 °C above ambient at
// 800 W/m², scaling linearly with irradiance. With wind data, Faiman
// (IEC 61853-2 open-rack coefficients, W/m²K): the same sun heats cells less
// when wind carries the heat away — at ~1 m/s both models agree.
const CELL_TEMP_RISE_PER_WM2 = 25 / 800;
const FAIMAN_U0 = 25;
const FAIMAN_U1 = 6.84;

/** Standard-test-condition cell temperature the datasheet coefficient is relative to. */
export const STC_CELL_TEMP_C = 25;

// Incidence-angle modifier (Martin & Ruiz 2001): panel glass reflects a
// growing share of the *beam* as the sun hits it at ever more glancing angles
// — the physical loss behind low-sun (morning/evening) over-forecasts that a
// flat system-loss percentage cannot capture. Diffuse light arrives from the
// whole sky dome, so its integrated modifier is roughly constant.
const MARTIN_RUIZ_AR = 0.16;
const IAM_DIFFUSE = 0.95;

function iamMartinRuiz(cosTheta: number): number {
  if (cosTheta <= 0) return 0;
  return (1 - Math.exp(-cosTheta / MARTIN_RUIZ_AR)) / (1 - Math.exp(-1 / MARTIN_RUIZ_AR));
}

/** One timestamp's environment for a single array. Optional fields unlock the
 * finer physics; without them the model degrades to its simpler forms. */
export interface PvSample {
  /** Plane-of-array (tilted) irradiance, W/m². */
  gtiWm2: number;
  /** Ambient 2 m temperature, °C. */
  ambientC: number;
  /** Direct-normal irradiance, W/m² — with `cosAoi`, enables the IAM split. */
  dniWm2?: number;
  /** Cosine of the sun→panel angle of incidence (≤ 0 = sun behind the plane). */
  cosAoi?: number;
  /** 10 m wind speed, m/s — enables Faiman convective cooling. */
  windMs?: number;
}

/**
 * The irradiance that reaches the cells after reflection: the beam share
 * (DNI projected onto the plane, capped by the GTI itself) is derated by the
 * Martin–Ruiz IAM at the current incidence angle, the diffuse remainder by a
 * constant sky-dome factor. Without a beam/diffuse split, applying a beam IAM
 * to the total would over-penalise cloudy hours — so it falls back to raw GTI.
 */
function effectiveIrradianceWm2(sample: PvSample): number {
  if (sample.dniWm2 === undefined || sample.cosAoi === undefined) return sample.gtiWm2;
  const beam = Math.min(sample.gtiWm2, sample.dniWm2 * Math.max(0, sample.cosAoi));
  const diffuse = sample.gtiWm2 - beam;
  return beam * iamMartinRuiz(sample.cosAoi) + diffuse * IAM_DIFFUSE;
}

/** Cell temperature heats with the *full* incident irradiance (reflected or
 * not, the plane sits in the same sun), cooled by wind when known. */
function cellTempC(sample: PvSample): number {
  if (sample.windMs === undefined) return sample.ambientC + sample.gtiWm2 * CELL_TEMP_RISE_PER_WM2;
  return sample.ambientC + sample.gtiWm2 / (FAIMAN_U0 + FAIMAN_U1 * sample.windMs);
}

/**
 * Expected AC power of one array for a sample. DC = kWp scaled by the
 * IAM-effective irradiance relative to STC (1000 W/m²), derated by the
 * datasheet temperature coefficient at the estimated cell temperature; AC
 * applies the static system-loss percentage.
 */
export function pvPowerW(
  sample: PvSample,
  kwp: number,
  tempCoefficientPctPerC: number,
  systemLossPct: number,
): number {
  const effectiveWm2 = effectiveIrradianceWm2(sample);
  if (effectiveWm2 <= 0) return 0;
  const derate = 1 + (tempCoefficientPctPerC / 100) * (cellTempC(sample) - STC_CELL_TEMP_C);
  const dcW = kwp * effectiveWm2 * Math.max(0, derate); // kwp * 1000 * (eff / 1000)
  return Math.max(0, dcW * (1 - systemLossPct / 100));
}
