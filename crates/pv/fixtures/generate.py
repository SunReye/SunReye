"""Writes the pv crate's golden fixtures from pvlib (ADR 17).

Run with pvlib 0.16.1: `uv run --with pvlib==0.16.1 python generate.py`.
Azimuths in the CSVs follow ADR 17 (0 = south, -90 = east, 90 = west);
pvlib's are 180 more.

Electrics are De Soto's single-diode model: `ivtools.sdm.fit_desoto` fits the datasheet,
`pvsystem.calcparams_desoto` moves it to each substring's irradiance and cell temperature, and
`pvsystem.v_from_i` gives each substring's voltage. Bypass diodes clamp a substring at -0.5 V,
as pvlib's partial-shading example. Maximum power points are found by dense grids refined with
scipy, independent of the crate's own search.
"""

import csv
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from pvlib import iam, irradiance, pvsystem, solarposition, temperature
from pvlib.ivtools import sdm
from scipy import constants, optimize

HERE = Path(__file__).parent
PLANES = [(0, 0), (30, 0), (35, -90), (45, 90), (30, 180), (90, 0), (90, -90), (20, 45)]
SUNS = [(20, 0), (45, -60), (60, 80), (75, 170), (87, -100)]
# DNI / DHI ratios that land in each of Perez's eight clearness bins.
RATIOS = [0, 0.15, 0.35, 0.7, 1.4, 3, 5, 8]
DIFFUSE_IAM = 0.95
MODULES, LOSS_PCT, NOCT = 16, 2.0, 45.0
BYPASS_DROP = 0.5  # volts, as pvlib's partial module shading example
OPTIMIZER = 0.99  # ADR 17: an optimized module delivers its own maximum power less 1 %
GRID = 4001


@dataclass
class Datasheet:
    vmp: float
    imp: float
    voc: float
    isc: float
    voltage_coefficient: float  # %/K of Voc
    current_coefficient: float  # %/K of Isc
    cells: int
    bypass_diodes: int


# The crate's test module, and a 54-cell half-cut module.
FIXTURE = Datasheet(34.0, 11.76, 41.0, 12.5, -0.27, 0.05, 60, 3)
HALF_CUT = Datasheet(31.44, 13.04, 37.25, 13.87, -0.28, 0.048, 54, 3)


def fit(ds):
    # fit_desoto's default seed (ideality 1.5) diverges for these modules; 1.2 converges.
    a_0 = 1.2 * constants.value("Boltzmann constant in eV/K") * 298.15 * ds.cells
    io_0 = ds.isc * math.exp(-ds.voc / a_0)
    params, _ = sdm.fit_desoto(
        ds.vmp, ds.imp, ds.voc, ds.isc,
        alpha_sc=ds.current_coefficient / 100 * ds.isc,
        beta_voc=ds.voltage_coefficient / 100 * ds.voc,
        cells_in_series=ds.cells,
        init_guess={"a_0": a_0, "Io_0": io_0,
                    "Rs_0": (a_0 * math.log1p((ds.isc - ds.imp) / io_0) - ds.vmp) / ds.imp},
    )
    return params


def substring(params, n, effective, cell):
    """The single-diode parameters of one of a module's n substrings, or None in the dark."""
    if effective <= 0:
        return None
    il, io, rs, rsh, a = pvsystem.calcparams_desoto(
        effective, cell, params["alpha_sc"], params["a_ref"], params["I_L_ref"],
        params["I_o_ref"], params["R_sh_ref"], params["R_s"],
    )
    return il, io, rs / n, rsh / n, a / n


def sub_voltage(sub, current):
    current = np.asarray(current, dtype=float)
    if sub is None:
        return np.where(current > 0, -BYPASS_DROP, 0.0)
    return np.maximum(pvsystem.v_from_i(current, *sub), -BYPASS_DROP)


def maximise(f, lo, hi, coarse=None):
    """The argument in [lo, hi] where the vectorised f peaks: a dense grid, then Brent.

    `coarse`, a cheap vectorised approximation of f, may place the grid."""
    x = np.linspace(lo, hi, GRID)
    y = (coarse or f)(x)
    best = int(np.nanargmax(y))
    a, b = x[max(best - 1, 0)], x[min(best + 1, GRID - 1)]
    found = optimize.minimize_scalar(lambda v: -float(f(np.array([v]))[0]), bounds=(a, b),
                                     method="bounded", options={"xatol": 1e-13})
    at_best = float(f(np.array([x[best]]))[0])
    return found.x if -found.fun > at_best else x[best]


@dataclass
class Module:
    subs: list  # substring parameters
    optimized: bool

    def voltage(self, current):
        return sum(sub_voltage(s, current) for s in self.subs)

    def top(self):
        return max((s[0] for s in self.subs if s is not None), default=0.0)

    def own_mpp(self):
        """Its own maximum power point, current and power."""
        top = self.top()
        if top <= 0:
            return 0.0, 0.0
        i = maximise(lambda c: c * self.voltage(c), 0.0, top)
        return i, i * float(self.voltage(np.array([i]))[0])


class String:
    def __init__(self, modules, loss):
        # The substrings of modules without optimizer, counted by their parameters.
        self.subs = {}
        for m in modules:
            if not m.optimized:
                for sub in m.subs:
                    self.subs[sub] = self.subs.get(sub, 0) + 1
        self.plain = bool(self.subs)
        own = [m.own_mpp() for m in modules if m.optimized]
        self.optimized = OPTIMIZER * sum(p for _, p in own)
        # The optimizers run at their own maximum power point's current at least.
        lit = [sub[0] for sub in self.subs if sub is not None]
        self.top = max(lit + [i for i, _ in own], default=0.0)
        self.keep = 1 - loss / 100

    def voltage(self, current):
        """At the current before the loss."""
        current = np.asarray(current, dtype=float)
        plain = sum((n * sub_voltage(sub, current) for sub, n in self.subs.items()),
                    np.zeros_like(current))
        if self.optimized <= 0:
            return plain
        with np.errstate(divide="ignore"):
            return plain + np.where(current > 0, self.optimized / current, np.inf)

    def current(self, voltage):
        """The current at a voltage, after the loss."""
        if self.top <= 0 or voltage >= self.voltage(np.array([0.0]))[0]:
            return 0.0
        if voltage <= self.voltage(np.array([self.top]))[0]:
            return self.top * self.keep
        found = optimize.brentq(lambda c: float(self.voltage(np.array([c]))[0]) - voltage,
                                0.0, self.top, xtol=1e-15, rtol=1e-15)
        return found * self.keep

    def coarse_current(self, voltage):
        """current(), interpolated."""
        i = np.linspace(0.0, self.top, 20001)
        v = self.voltage(i)
        return np.interp(voltage, v[::-1], i[::-1], left=self.top, right=0.0) * self.keep


def input_output(strings, limits):
    """The input's voltage, current, power and each string's share."""
    if not strings or all(s.top <= 0 for s in strings):
        return 0.0, 0.0, 0.0, [0.0] * len(strings)

    def current(v):
        return sum(s.current(v) for s in strings)

    if limits is None and len(strings) == 1:
        (string,) = strings
        if string.plain:
            i = maximise(lambda c: c * string.voltage(c), 1e-9, string.top)
        else:
            # Optimizers alone deliver the same power at any current: ties go to the highest.
            i = string.top
        v = float(string.voltage(np.array([i]))[0])
        p = v * i * string.keep
        return v, i * string.keep, p, [p]

    open_circuit = max(float(s.voltage(np.array([0.0]))[0]) for s in strings)
    if limits is None:
        lo, hi, cap = 0.0, open_circuit, math.inf
    else:
        cap, lo, hi, start = limits
        if open_circuit < max(lo, start):
            return 0.0, 0.0, 0.0, [0.0] * len(strings)
        hi = min(hi, open_circuit)
        if current(lo) > cap:
            lo = optimize.brentq(lambda v: current(v) - cap, lo, hi, xtol=1e-13)
    v = maximise(np.vectorize(lambda v: v * min(current(v), cap)), lo, hi,
                 lambda v: v * np.minimum(sum(s.coarse_current(v) for s in strings), cap))
    i = min(current(v), cap)
    total = current(v)
    shares = [v * i * s.current(v) / total if total > 0 else 0.0 for s in strings]
    return v, i, v * i, shares


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


def on_plane(tilt, plane_az, zenith, sun_az, doy, ghi, dni, dhi, temp_air, wind):
    """Effective irradiance with and without beam, and the cell temperature, on one plane.

    Azimuths in pvlib's convention."""
    poa = irradiance.get_total_irradiance(
        tilt, plane_az, zenith, sun_az, dni, ghi, dhi,
        dni_extra=irradiance.get_extra_radiation(doy), model="perez",
    )
    aoi = irradiance.aoi(tilt, plane_az, zenith, sun_az)
    diffuse = poa["poa_diffuse"] * DIFFUSE_IAM
    lit = poa["poa_direct"] * iam.martin_ruiz(aoi) + diffuse
    if wind is None:
        cell = temperature.ross(poa["poa_global"], temp_air, noct=NOCT)
    else:
        cell = temperature.faiman(poa["poa_global"], temp_air, wind)
    return float(lit), float(diffuse), float(cell)


def module(params, ds, light, optimized=False, shaded=0):
    lit, diffuse, cell = light
    n = ds.bypass_diodes
    subs = [substring(params, n, diffuse if k < shaded else lit, cell) for k in range(n)]
    return Module(subs, optimized)


def desoto():
    rows = [["vmp", "imp", "voc", "isc", "voltage_coefficient", "current_coefficient",
             "photocurrent", "saturation_current", "series_resistance", "shunt_resistance",
             "ideality"]]
    for ds in (FIXTURE, HALF_CUT):
        p = fit(ds)
        rows.append([ds.vmp, ds.imp, ds.voc, ds.isc, ds.voltage_coefficient,
                     ds.current_coefficient, p["I_L_ref"], p["I_o_ref"], p["R_s"],
                     p["R_sh_ref"], p["a_ref"]])
    return rows


SKY = ["zenith", "sun_azimuth", "day_of_year", "ghi", "dni", "dhi", "temperature", "wind"]


def string_fixture():
    params = fit(FIXTURE)
    rows = [["tilt", "plane_azimuth", *SKY, "power", "voltage", "current"]]
    for tilt, plane_az, zenith, sun_az, doy, ghi, dni, dhi, temp_air, wind in cases():
        light = on_plane(tilt, plane_az + 180, zenith, sun_az + 180, doy, ghi, dni, dhi,
                         temp_air, wind)
        string = String([module(params, FIXTURE, light) for _ in range(MODULES)], LOSS_PCT)
        v, i, p, _ = input_output([string], None)
        rows.append([tilt, plane_az, zenith, sun_az, doy, ghi, dni, dhi, temp_air,
                     "" if wind is None else wind, p, v, i])
    return rows


# One bright, warm sky; the sun in the south-east.
BRIGHT = (40.0, -50.0, 172, 850.0, 750.0, 150.0, 22.0, 2.0)
# Morning: the sun low in the east.
MORNING = (65.0, -95.0, 172, 400.0, 600.0, 120.0, 15.0, 1.0)
SOUTH, NORTH, EAST, WEST = "35:0", "35:180", "35:-90", "35:90"

# Each input: its strings, each a list of modules "tilt:azimuth:optimizer:shaded substrings";
# the limits are max current, min and max voltage, start voltage.
ROOMY = (30.0, 150.0, 850.0, 180.0)
INPUTS = [
    ("one module with one substring shaded", BRIGHT, [[f"{SOUTH}:-:1"] + [f"{SOUTH}:-:0"] * 15], None),
    ("one module fully shaded", BRIGHT, [[f"{SOUTH}:-:3"] + [f"{SOUTH}:-:0"] * 15], None),
    ("one module with two substrings shaded", BRIGHT,
     [[f"{SOUTH}:-:2"] + [f"{SOUTH}:-:0"] * 15], None),
    ("a quarter of the string shaded", BRIGHT,
     [[f"{SOUTH}:-:3"] * 4 + [f"{SOUTH}:-:0"] * 12], None),
    ("the shaded module optimized", BRIGHT, [[f"{SOUTH}:o:1"] + [f"{SOUTH}:-:0"] * 15], None),
    ("a bright module optimized beside a shaded one", BRIGHT,
     [[f"{SOUTH}:-:3", f"{SOUTH}:o:0"] + [f"{SOUTH}:-:0"] * 14], None),
    ("every module optimized and one shaded", BRIGHT,
     [[f"{SOUTH}:o:3"] + [f"{SOUTH}:o:0"] * 15], None),
    ("east and west faces", MORNING, [[f"{EAST}:-:0"] * 8 + [f"{WEST}:-:0"] * 8], None),
    ("east and west faces with the west optimized", MORNING,
     [[f"{EAST}:-:0"] * 8 + [f"{WEST}:o:0"] * 8], None),
    ("south and north in parallel", BRIGHT,
     [[f"{SOUTH}:-:0"] * 16, [f"{NORTH}:-:0"] * 16], ROOMY),
    ("south shaded beside north", BRIGHT,
     [[f"{SOUTH}:-:3"] * 4 + [f"{SOUTH}:-:0"] * 12, [f"{NORTH}:-:0"] * 16], ROOMY),
    ("current capped", BRIGHT,
     [[f"{SOUTH}:-:0"] * 16, [f"{NORTH}:-:0"] * 16], (12.0, 150.0, 850.0, 180.0)),
    ("maximum power below the window", BRIGHT,
     [[f"{SOUTH}:-:0"] * 16], (30.0, 560.0, 850.0, 180.0)),
    ("maximum power above the window", BRIGHT,
     [[f"{SOUTH}:-:0"] * 16], (30.0, 150.0, 450.0, 180.0)),
    ("open circuit below the start voltage", BRIGHT,
     [[f"{SOUTH}:-:0"] * 16], (30.0, 150.0, 850.0, 700.0)),
    ("open circuit below the window", BRIGHT,
     [[f"{SOUTH}:-:0"] * 16], (30.0, 700.0, 850.0, 180.0)),
]


def input_fixture():
    params = fit(FIXTURE)
    rows = [["case", *SKY, "strings", "limits", "power", "voltage", "current", "shares"]]
    for name, sky, strings, limits in INPUTS:
        zenith, sun_az, doy, ghi, dni, dhi, temp_air, wind = sky
        modelled = []
        for modules in strings:
            built = []
            for token in modules:
                tilt, plane_az, optimizer, shaded = token.split(":")
                light = on_plane(float(tilt), float(plane_az) + 180, zenith, sun_az + 180, doy,
                                 ghi, dni, dhi, temp_air, wind)
                built.append(module(params, FIXTURE, light, optimizer == "o", int(shaded)))
            modelled.append(String(built, LOSS_PCT))
        v, i, p, shares = input_output(modelled, limits)
        rows.append([name, *sky, "|".join(" ".join(m) for m in strings),
                     "" if limits is None else " ".join(map(str, limits)), p, v, i,
                     " ".join(repr(float(s)) for s in shares)])
    return rows


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
OWNER = [[(35, 0, 16), (35, 180, 16)], [(35, 0, 14)]]
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
    params = fit(FIXTURE)
    rows = [["unix", "ghi", "dni", "dhi", "temperature", "wind", "input1", "south", "north",
             "input2"]]
    for instant, ghi, dni, dhi, temp_air, wind in DAY:
        time = pd.DatetimeIndex([instant])
        position = solarposition.spa_python(time, *BERLIN, delta_t=67.0).iloc[0]
        zenith, sun_az = position["zenith"], position["azimuth"]
        values = []
        for strings in OWNER:
            modelled = []
            for tilt, plane_az, count in strings:
                light = on_plane(tilt, plane_az + 180, zenith, sun_az, time.day_of_year[0],
                                 ghi, dni, dhi, temp_air, wind)
                modelled.append(String([module(params, FIXTURE, light)] * count, LOSS_PCT))
            _, _, power, shares = input_output(modelled, None)
            values.append([power, *shares])
        (input1, south, north), (input2, _) = values
        rows.append([int(time[0].timestamp()), ghi, dni, dhi, temp_air,
                     "" if wind is None else wind, input1, south, north, input2])
    return rows


def perez():
    rows = [["tilt", "plane_azimuth", "zenith", "sun_azimuth", "day_of_year", "ghi", "dni", "dhi",
             "beam", "sky_diffuse", "ground_diffuse"]]
    for tilt, plane_az, zenith, sun_az, doy, ghi, dni, dhi, _, _ in cases():
        poa = irradiance.get_total_irradiance(
            tilt, plane_az + 180, zenith, sun_az + 180, dni, ghi, dhi,
            dni_extra=irradiance.get_extra_radiation(doy), model="perez",
        )
        rows.append([tilt, plane_az, zenith, sun_az, doy, ghi, dni, dhi, poa["poa_direct"],
                     poa["poa_sky_diffuse"], poa["poa_ground_diffuse"]])
    return rows


def main():
    for name, rows in (("perez.csv", perez()), ("string.csv", string_fixture()),
                       ("sun.csv", sun()), ("estimate.csv", estimate()),
                       ("desoto.csv", desoto()), ("input.csv", input_fixture())):
        with open(HERE / name, "w", newline="") as f:
            csv.writer(f, lineterminator="\n").writerows(
                [[v if isinstance(v, (str, int)) else repr(float(v)) for v in row] for row in rows]
            )


main()
