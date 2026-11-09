"""Writes the pv crate's golden fixtures from pvlib (ADR 17).

Run with pvlib 0.16.1: `uv run --with pvlib==0.16.1 python generate.py`.
Azimuths in the CSVs follow ADR 17 (0 = south, -90 = east, 90 = west);
pvlib's are 180 more.
"""

import csv
import math
from pathlib import Path

from pvlib import iam, irradiance, pvsystem, temperature

HERE = Path(__file__).parent
PLANES = [(0, 0), (30, 0), (35, -90), (45, 90), (30, 180), (90, 0), (90, -90), (20, 45)]
SUNS = [(20, 0), (45, -60), (60, 80), (75, 170), (87, -100)]
# DNI / DHI ratios that land in each of Perez's eight clearness bins.
RATIOS = [0, 0.15, 0.35, 0.7, 1.4, 3, 5, 8]
DIFFUSE_IAM = 0.95
MODULE_PMAX, GAMMA_PCT, MODULES, LOSS_PCT, NOCT = 400.0, -0.35, 16, 2.0, 45.0


def cases():
    for i, ((tilt, plane_az), (zenith, sun_az)) in enumerate(
        (p, s) for p in PLANES for s in SUNS
    ):
        dhi = 30.0 + 2.5 * i
        dni = dhi * RATIOS[i % len(RATIOS)]
        ghi = dhi + dni * math.cos(math.radians(zenith))
        doy = 1 + 9 * i
        temp_air = -5.0 + 1.1 * i
        wind = None if i % 3 == 0 else 0.5 * i
        yield tilt, plane_az, zenith, sun_az, doy, ghi, dni, dhi, temp_air, wind
    # Twilight: diffuse light with the sun below the horizon.
    yield 30, 0, 92, -110, 80, 5.0, 0.0, 5.0, 3.0, 2.0


def main():
    perez = [["tilt", "plane_azimuth", "zenith", "sun_azimuth", "day_of_year", "ghi", "dni", "dhi",
              "beam", "sky_diffuse", "ground_diffuse"]]
    string = [["tilt", "plane_azimuth", "zenith", "sun_azimuth", "day_of_year", "ghi", "dni", "dhi",
               "temperature", "wind", "power"]]
    for tilt, plane_az, zenith, sun_az, doy, ghi, dni, dhi, temp_air, wind in cases():
        dni_extra = irradiance.get_extra_radiation(doy)
        poa = irradiance.get_total_irradiance(
            tilt, plane_az + 180, zenith, sun_az + 180, dni, ghi, dhi,
            dni_extra=dni_extra, model="perez",
        )
        inputs = [tilt, plane_az, zenith, sun_az, doy, ghi, dni, dhi]
        perez.append([*inputs, poa["poa_direct"], poa["poa_sky_diffuse"], poa["poa_ground_diffuse"]])

        aoi = irradiance.aoi(tilt, plane_az + 180, zenith, sun_az + 180)
        effective = poa["poa_direct"] * iam.martin_ruiz(aoi) + poa["poa_diffuse"] * DIFFUSE_IAM
        if wind is None:
            cell = temperature.ross(poa["poa_global"], temp_air, noct=NOCT)
        else:
            cell = temperature.faiman(poa["poa_global"], temp_air, wind)
        dc = pvsystem.pvwatts_dc(effective, cell, MODULES * MODULE_PMAX, GAMMA_PCT / 100)
        power = dc * (1 - LOSS_PCT / 100)
        string.append([*inputs, temp_air, "" if wind is None else wind, power])

    for name, rows in (("perez.csv", perez), ("string.csv", string)):
        with open(HERE / name, "w", newline="") as f:
            csv.writer(f, lineterminator="\n").writerows(
                [[v if isinstance(v, (str, int)) else repr(float(v)) for v in row] for row in rows]
            )


main()
