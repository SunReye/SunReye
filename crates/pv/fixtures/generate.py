"""Writes the pv crate's golden fixtures from pvlib (ADR 17).

Run with pvlib 0.16.1: `uv run --with pvlib==0.16.1 python generate.py`.
Azimuths in the CSVs follow ADR 17 (0 = south, -90 = east, 90 = west);
pvlib's are 180 more.
"""

import csv
import math
from pathlib import Path

import pandas as pd
from pvlib import iam, irradiance, pvsystem, solarposition, temperature

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


# Places (latitude, longitude) and UTC instants: the owner's latitude, the tropics, the far
# south and a date line neighbour, across seasons and times of day.
PLACES = [(52.52, 13.38), (48.14, 11.58), (-33.87, 151.21), (1.29, 103.85), (64.15, -21.94),
          (37.77, -122.42)]
INSTANTS = ["2026-03-20T06:00:00Z", "2026-06-21T11:30:00Z", "2026-11-09T09:15:00Z",
            "2026-12-21T14:45:00Z", "2030-08-01T03:00:00Z", "2024-02-29T20:00:00Z"]


def sun():
    rows = [["unix", "latitude", "longitude", "zenith", "azimuth"]]
    for latitude, longitude in PLACES:
        times = pd.DatetimeIndex(INSTANTS)
        # Geometric (unrefracted) topocentric position; delta T as NREL SPA's default.
        position = solarposition.spa_python(times, latitude, longitude, delta_t=67.0)
        for time, (_, row) in zip(times, position.iterrows()):
            rows.append([int(time.timestamp()), latitude, longitude, row["zenith"],
                         row["azimuth"] - 180])
    return rows


# The owner's layout (ADR 17): input 1 holds 16 modules south and 16 north in parallel, input 2
# holds 14 south. Berlin, through one day; irradiance is made up, not measured.
OWNER = {"south": (35, 0, 16), "north": (35, 180, 16), "second_south": (35, 0, 14)}
BERLIN = (52.52, 13.38)
DAY = [  # UTC instant, ghi, dni, dhi, temperature, wind
    ("2026-06-21T03:00:00Z", 15.0, 40.0, 10.0, 12.0, 1.0),
    ("2026-06-21T06:15:00Z", 320.0, 450.0, 110.0, 16.0, 2.5),
    ("2026-06-21T09:30:00Z", 780.0, 720.0, 160.0, 22.0, None),
    ("2026-06-21T11:00:00Z", 880.0, 800.0, 150.0, 25.0, 3.0),
    ("2026-06-21T15:45:00Z", 420.0, 380.0, 170.0, 24.0, 4.0),
    ("2026-06-21T22:00:00Z", 0.0, 0.0, 0.0, 14.0, 1.0),
    ("2026-11-09T11:00:00Z", 250.0, 300.0, 90.0, 4.0, 2.0),
]


def estimate():
    rows = [["unix", "ghi", "dni", "dhi", "temperature", "wind", *OWNER]]
    for instant, ghi, dni, dhi, temp_air, wind in DAY:
        time = pd.DatetimeIndex([instant])
        position = solarposition.spa_python(time, *BERLIN, delta_t=67.0).iloc[0]
        zenith, sun_az = position["zenith"], position["azimuth"]
        dni_extra = irradiance.get_extra_radiation(time.day_of_year[0])
        powers = []
        for tilt, plane_az, modules in OWNER.values():
            poa = irradiance.get_total_irradiance(
                tilt, plane_az + 180, zenith, sun_az, dni, ghi, dhi,
                dni_extra=dni_extra, model="perez",
            )
            aoi = irradiance.aoi(tilt, plane_az + 180, zenith, sun_az)
            effective = poa["poa_direct"] * iam.martin_ruiz(aoi) + poa["poa_diffuse"] * DIFFUSE_IAM
            if wind is None:
                cell = temperature.ross(poa["poa_global"], temp_air, noct=NOCT)
            else:
                cell = temperature.faiman(poa["poa_global"], temp_air, wind)
            dc = pvsystem.pvwatts_dc(effective, cell, modules * MODULE_PMAX, GAMMA_PCT / 100)
            powers.append(max(0.0, dc * (1 - LOSS_PCT / 100)))
        rows.append([int(time[0].timestamp()), ghi, dni, dhi, temp_air,
                     "" if wind is None else wind, *powers])
    return rows


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

    for name, rows in (("perez.csv", perez), ("string.csv", string), ("sun.csv", sun()),
                       ("estimate.csv", estimate())):
        with open(HERE / name, "w", newline="") as f:
            csv.writer(f, lineterminator="\n").writerows(
                [[v if isinstance(v, (str, int)) else repr(float(v)) for v in row] for row in rows]
            )


main()
