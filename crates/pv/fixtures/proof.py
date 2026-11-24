"""Writes the proof against pvlib (ADR 17): a year of weather and four plants' energy.

Run with pvlib 0.16.1: `uv run --with pvlib==0.16.1 python proof.py`. Write-up:
`docs/pv-proof.md`; the crate's side: `src/tests/proof.rs`.

The weather is made up, not measured: Ineichen's clear sky at Berlin, dimmed by a fixed pattern
of clear, broken and overcast days, split into beam and diffuse by Erbs, each hour's sample
stamped at its middle. It is rounded and read back before any plant runs, so pvlib and the crate
read the same numbers.

Each plant's light, temperature and electrics are pvlib's (`generate.py`), at every hour: SPA's
geometric sun, Perez's parts, Martin and Ruiz on the beam, 0.95 on diffuse, Faiman, De Soto,
bypass diodes at -0.5 V, and a dense search for the peak. pvlib knows no scene, so shade comes
from long obstacles it can model in two dimensions, each substring taken as a strip:

- beam: a substring loses its beam, and the circumsolar part of diffuse light, when any of it is
  in the shadow, by `shading.projected_solar_zenith_angle` against a wall's top, and by
  `shading.shaded_fraction1d` in a field of rows;
- diffuse: a substring's isotropic and horizon-band light is scaled by its strip's average view
  of the sky over the open sky's, by the closed form beside a wall and by
  `bifacial.utils.vf_row_sky_2d_integ` in a field of rows. Ground light stays (ADR 17).
"""

import csv
import math

import numpy as np
import pandas as pd
from pvlib import atmosphere, bifacial, clearsky, iam, irradiance, shading, solarposition
from pvlib import temperature as celltemp

from generate import (
    BERLIN, DIFFUSE_IAM, FIXTURE, HERE, ROOMY, String, fit, input_output, substring,
)

# The crate's test module (`fixtures.rs`), in metres.
WIDTH, HEIGHT = 1.134, 1.722
ALBEDO = 0.25

YEAR = 2026
# Clearness of each day by its number in the year, taken in turn: clear, broken, overcast.
DAYS = [1.0, 0.95, 0.75, 0.4, 0.2, 0.85, 1.0, 0.6, 0.3, 0.9, 0.5, 1.0, 0.15]


def made_up_weather():
    times = pd.date_range(f"{YEAR}-01-01T00:30:00Z", f"{YEAR}-12-31T23:30:00Z", freq="1h")
    sun = solarposition.spa_python(times, *BERLIN, delta_t=67.0)
    zenith = sun["zenith"].to_numpy()
    airmass = atmosphere.get_absolute_airmass(
        atmosphere.get_relative_airmass(zenith, model="kastenyoung1989"))
    doy = times.day_of_year.to_numpy()
    clear = clearsky.ineichen(zenith, airmass, 3.0, altitude=0,
                              dni_extra=irradiance.get_extra_radiation(doy))
    hour = times.hour.to_numpy()
    day = DAYS_ARRAY[(doy * 5) % len(DAYS)]
    # Broken days pass clouds through the hours; clear and overcast ones stay even.
    broken = (day > 0.3) & (day < 0.99)
    k = np.where(broken, day * (0.8 + 0.2 * np.cos(1.7 * hour + doy)), day)
    ghi = np.nan_to_num(clear["ghi"]) * np.clip(k, 0.0, 1.0)
    split = irradiance.erbs(ghi, zenith, doy)
    season = np.cos(2 * math.pi * (doy - 200) / 365)
    temp_air = 9.0 + 10.0 * season + 5.0 * np.sin(2 * math.pi * (hour - 9) / 24)
    wind = 0.5 + ((doy * 3 + hour) % 7) * 0.6
    rows = []
    for t, g, b, d, temp, w in zip(times, ghi, np.nan_to_num(split["dni"]),
                                   np.nan_to_num(split["dhi"]), temp_air, wind):
        rows.append([int(t.timestamp()), round(g, 1), round(b, 1), round(d, 1), round(temp, 1),
                     round(w, 1)])
    return rows


DAYS_ARRAY = np.array(DAYS)


def write(name, rows):
    with open(HERE / name, "w", newline="") as f:
        csv.writer(f, lineterminator="\n").writerows(
            [[v if isinstance(v, (str, int)) else repr(float(v)) for v in row] for row in rows])


def read_weather():
    with open(HERE / "proof-weather.csv") as f:
        rows = list(csv.DictReader(f))
    return pd.DataFrame({k: [float(r[k]) for r in rows] for k in rows[0]})


class Sky:
    """One hour's weather and sun, with Perez's parts on any plane."""

    def __init__(self, row):
        self.unix = int(row.unix)
        self.ghi, self.dni, self.dhi = row.ghi, row.dni, row.dhi
        self.temp_air, self.wind = row.temperature, row.wind
        time = pd.DatetimeIndex([pd.Timestamp(self.unix, unit="s", tz="UTC")])
        position = solarposition.spa_python(time, *BERLIN, delta_t=67.0).iloc[0]
        self.zenith, self.azimuth = position["zenith"], position["azimuth"]
        self.doy = int(time.day_of_year[0])
        self.month = int(time.month[0])
        self.dni_extra = irradiance.get_extra_radiation(self.doy)

    def light(self, tilt, azimuth):
        """Beam after the glass, circumsolar, the rest of sky diffuse, ground diffuse, all as
        reaching the cells after the glass, and the cell temperature. Azimuth as ADR 17."""
        azimuth += 180
        poa = irradiance.get_total_irradiance(
            tilt, azimuth, self.zenith, self.azimuth, self.dni, self.ghi, self.dhi,
            dni_extra=self.dni_extra, model="perez", albedo=ALBEDO)
        parts = irradiance.perez(tilt, azimuth, self.dhi, self.dni, self.dni_extra, self.zenith,
                                 self.azimuth, atmosphere.get_relative_airmass(self.zenith),
                                 return_components=True)
        aoi = irradiance.aoi(tilt, azimuth, self.zenith, self.azimuth)
        beam = float(np.nan_to_num(poa["poa_direct"] * iam.martin_ruiz(aoi)))
        circumsolar = float(np.nan_to_num(parts["poa_circumsolar"])) * DIFFUSE_IAM
        sky = float(np.nan_to_num(parts["poa_isotropic"]) + np.nan_to_num(parts["poa_horizon"]))
        ground = float(np.nan_to_num(poa["poa_ground_diffuse"])) * DIFFUSE_IAM
        cell = float(celltemp.faiman(float(np.nan_to_num(poa["poa_global"])), self.temp_air,
                                     self.wind))
        return beam, circumsolar, sky * DIFFUSE_IAM, ground, cell


def effective(light, lit, view):
    beam, circumsolar, sky, ground, _ = light
    return (beam + circumsolar if lit else 0.0) + view * sky + ground


class Module:
    def __init__(self, subs):
        self.subs = subs
        self.optimized = False


PARAMS = fit(FIXTURE)
N = FIXTURE.bypass_diodes


def module(light, lit=(True,) * N, views=(1.0,) * N):
    cell = light[4]
    return Module([substring(PARAMS, N, effective(light, l, v), cell)
                   for l, v in zip(lit, views)])


def open_roof(sky):
    light = sky.light(35, 0)
    return [String([module(light)] * 16, 0.0)], None


def east_west(sky):
    strings = [String([module(sky.light(20, azimuth))] * 10, 0.0) for azimuth in (-90, 90)]
    return strings, ROOMY


# A wall south of a roof: its top WALL_HEIGHT above the lower row's lower edge, WALL_DISTANCE
# south of it. Two rows of 8 modules in portrait at 35°, one above the other, in one string.
WALL_HEIGHT, WALL_DISTANCE, ROOF_TILT = 4.0, 8.0, 35.0


def wall_top(s):
    """The wall top's elevation, in radians, seen from `s` metres up the slope."""
    beta = math.radians(ROOF_TILT)
    return math.atan2(WALL_HEIGHT - s * math.sin(beta), WALL_DISTANCE + s * math.cos(beta))


def wall_view(lower, upper):
    """A strip's average share of the open sky's isotropic light beside the wall: at each point,
    (1 + cos(tilt + top)) / 2 over (1 + cos tilt) / 2, in two dimensions."""
    beta = math.radians(ROOF_TILT)
    s = np.linspace(lower, upper, 2001)
    tops = np.array([wall_top(x) for x in s])
    return float(np.mean((1 + np.cos(beta + tops)) / (1 + math.cos(beta))))


ROOF_VIEWS = [wall_view(r * HEIGHT, (r + 1) * HEIGHT) for r in range(2)]


def shaded_roof(sky):
    light = sky.light(ROOF_TILT, 0)
    # The sun's elevation seen across the wall, in the plane north to south.
    projected = shading.projected_solar_zenith_angle(sky.zenith, sky.azimuth, 0, 90)
    elevation = math.radians(90 - projected)
    modules = []
    for r in range(2):
        # Portrait: each substring runs up the whole module, so its lower edge decides.
        lit = elevation >= wall_top(r * HEIGHT)
        modules += [module(light, (lit,) * N, (ROOF_VIEWS[r],) * N)] * 8
    return [String(modules, 0.0)], None


# A field of rows 2.5 m apart at 25°, one module high in landscape: substrings lie one above the
# other up the slope, so the row in front shades the lowest first.
RACK_TILT, PITCH = 25.0, 2.5
GCR = WIDTH / PITCH
OPEN_SKY = (1 + math.cos(math.radians(RACK_TILT))) / 2
RACK_VIEWS = tuple(float(bifacial.utils.vf_row_sky_2d_integ(RACK_TILT, GCR, j / N, (j + 1) / N))
                   / OPEN_SKY for j in range(N))


def rack_field(sky):
    light = sky.light(RACK_TILT, 0)
    shaded = float(shading.shaded_fraction1d(
        sky.zenith, sky.azimuth, 90, RACK_TILT, collector_width=WIDTH, pitch=PITCH))
    lit = tuple(shaded <= j / N for j in range(N))
    return [String([module(light, lit, RACK_VIEWS)] * 16, 0.0)], None


PLANTS = {"open_roof": open_roof, "shaded_roof": shaded_roof, "east_west": east_west,
          "rack_field": rack_field}


def main():
    write("proof-weather.csv",
          [["unix", "ghi", "dni", "dhi", "temperature", "wind"], *made_up_weather()])
    weather = read_weather()
    energy = {}  # (plant, series) -> watt-hours by month, January first
    for row in weather.itertuples():
        if row.ghi <= 0 and row.dni <= 0 and row.dhi <= 0:
            continue
        sky = Sky(row)
        for name, plant in PLANTS.items():
            strings, limits = plant(sky)
            _, _, power, shares = input_output(strings, limits)
            for series, watts in [("input", power)] + [(f"string{s}", w)
                                                       for s, w in enumerate(shares)]:
                assert math.isfinite(watts), (name, series, sky.unix)
                # Held for the hour.
                energy.setdefault((name, series), [0.0] * 12)[sky.month - 1] += watts
    write("proof.csv", [["plant", "series", "total", *map(str, range(1, 13))]]
          + [[plant, series, sum(months), *months] for (plant, series), months in energy.items()])


if __name__ == "__main__":
    main()
