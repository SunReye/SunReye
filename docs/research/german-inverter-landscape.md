# German inverter and storage landscape: device-profile fact sheet

Researched 2026-11-08. Purpose: decide the device-profile format and transports. Cites `[KEY]`; URLs in
"Sources". `mirror` = third-party copy of a vendor PDF (vendor-hosted copy not reachable). `UNVERIFIED` =
no primary source seen; do not build on it. Forum posts and community libraries were not accepted as sources.

## 1. Ranking

**MaStR cannot rank inverter or storage manufacturers.** The Gesamtdatenexport schema (2026-10-01) has no
manufacturer field for solar or storage units, only a free-text unit name, `Batterietechnologie`,
`AcDcKoppelung` and power values; manufacturer exists for wind only [M1]. Any brand share is an estimate.

**Home storage, share of installed capacity, Germany** (Battery Charts = P3 Group + ISEA RWTH Aachen, from MaStR).
Method: manufacturer names matched in free text, rest assigned by power/capacity signature, the unassigned
(6.8 % in 2024) distributed pro rata [M2][M3]. Published via pv magazine; the Battery Charts site shows no per-brand data [M7].

| # | 2025 [M3] | Share | 2024 [M2] | Share |
|---|---|---|---|---|
| 1 | BYD | ~16.5 % | BYD | 21.6 % |
| 2 | Sungrow | ~9.0 % | Huawei | 12.4 % |
| 3 | Huawei | ~7.8 % | Sungrow | 11.5 % |
| 4 | Anker | 6.9 % | sonnen | 4.7 % |
| 5 | FOX ESS | 5.4 % | E3/DC | 4.3 % |
| 6 | E3/DC | 4.3 % | LG | 3.4 % |
| 7 | sonnen | 3.3 % | Fenecon | 2.8 % |
| 8 | n/a in text | | Growatt | 2.3 % |
| | | | Varta 1.3 %, Senec 1.2 %, Tesla ~1 % | |

- 2025 values for rank 8+ are not in the article text (chart image only) [M3]. Top 5 held "knapp 55 %" in 2024, "knapp ueber 45 %" in 2025 [M3].
- Balcony storage 2025 (<=2 kW, <=5 kWh): 30.6 % of units, 11.4 % of capacity; Anker ~55 %, Growatt 12 %, Marstek 10.3 %, Ecoflow 5.6 % [M3].
- 2024 total: ~580,000 home storages, 5.1 GWh incl. ~5 % late-registration buffer; Asian brands 51.2 %, German 14.3 % (2023: >25 %) [M2].
- Totals, BSW (home storage = up to 20 kWh): 2,350,000 cumulative end 2025, 560,000 new in 2025, 19.8 GWh cumulative, 4.4 GWh new, avg 7.9 kWh, ~80 % of new home PV with storage [M4]. Jan-Sep 2026 new home-storage capacity 3.2 GWh, +20 % [M6].
- PV units: >5.7 million end 2025, ~0.9 million commissioned in 2025, of which ~435,000 plug-in (Steckersolar) [M5].
- **Inverter brand share (installed base or new): UNVERIFIED.** No MaStR field (above); EUPD InstallerMonitor and EndkundenMonitor brochures hold no per-brand numbers [M8]. Wood Mackenzie global shipment ranks were not accepted (not Germany, not primary).
- Not researched for protocols (high storage share or relevant): BYD (battery, no inverter), Anker, FOX ESS, Marstek, Ecoflow, Fenecon, LG, Tesla, Kaco, RCT Power. See section 5.

Brands researched below, in order of storage share where known: Sungrow, Huawei, E3/DC, sonnen, Growatt, Varta, Senec, plus
SMA, Fronius, Kostal, SolarEdge, Victron, GoodWe, Solax, Deye, Enphase (inverter/legacy base, share UNVERIFIED).

## 2. Per brand: local interfaces

Register numbers are as printed in the vendor doc unless noted. SunSpec numbering is 1-based (wire = number - 1).

### SMA
- Modbus TCP, port 502 (range 49152-65535 allowed), no password for reads, **off by default**: installer sets Device parameters > External communication > Modbus > TCP Server [S1 s3.6, s4]. Max 4 TCP connections [S8]. Modbus UDP 502 exists on old inverters, write-only, no replies [S1].
- Data Manager M, Sunny Boy Smart Energy, Tripower X: TCP only, on the System Manager device; grid-management registers need signal source "Modbus" [S2]. Sunny Home Manager 2.0: Modbus TCP 502, enabled in Sunny Portal "Grid management services via Ethernet" (default No), needs internet, up to 5 min to apply [S5].
- Speedwire energy-meter telegrams UDP 9522 (section 3) [S6]. Webconnect JSON, SEMP details: UNVERIFIED (no official doc found) [S9].
- SunSpec: base 40001. Models 1, 11, 12, 101-103, 120, 121, 122, 123, 160, 701-714 (profile 2.0); 124 and 126-132 dropped in profile 2.0; profile 1.0/1.1/2.0 chosen by country data set; unsupported models dropped dynamically [S4].
- Encoding: big-endian, 32-bit high word first [S1][S2]. NaN: S16 0x8000, S32 0x80000000, U16 0xFFFF, U32 0xFFFFFFFF, U64 all F, status/enum U32 0xFFFFFD (low 24 bit), STR32 zero, SunSpec acc32/64 = 0 [S1][S2][S4].
- Unit ids: SMA profile default 3 (3-123); 1 = device info, 2 = system, 10+ connected devices; SunSpec unit id = SMA id + 123, default 126; wrong id returns error 11 [S1][S2][S4][S8]. Home Manager: 3-247 assignable, 255 = NaN [S5].
- A block read over undefined registers returns NaN there; raises an exception only if no register in the block is defined [S1].

### Fronius (Symo, Primo, Gen24)
- Solar API v1: HTTP GET JSON `/solar_api/v1/Get*.cgi` (InverterRealtimeData, MeterRealtimeData, StorageRealtimeData, PowerFlowRealtimeData, ...); no authentication; read-only; Gen24 note "temporary solution, will be removed" [FA]. Port UNVERIFIED (80 implied).
- Modbus TCP: Datamanager 502 (80 not allowed); Gen24 502 or 1502. Datamanager ships with "rtu" output, so TCP is not factory default; Gen24 default UNVERIFIED. Enable: Communication > Modbus > TCP [FD][FG].
- SunSpec: 1, 101-103 or 111-113 (UI switch int+SF vs float; **switching shifts every later address**, discover by chain walk), 120, 121, 122, 123, 160, 124 (storage inverters), meters 201-203/211-213; Primo GEN24 208-240 also 701-713 [FD][FG].
- Unit ids: Datamanager inverter N = unit N (inverter 00 = 100), meters from 240; Gen24 TCP unit 0x01, meter default 200 [FD][FG].
- Scale factors change at runtime (auto-scale), even in float mode: re-read each poll [FG]. Sentinels = SunSpec set [FD].
- Pacing: Datamanager timeout >= 10 s, sequential; Gen24 timeout >= 1 s, <= 2 parallel queries [FD][FG].

### SolarEdge
- Modbus TCP **disabled by default**; SetApp > Site Communication > Modbus TCP, default port 1502 (LCD path default 502); **one connection and session only** [SE1]. RTU 115200 8N1. No HTTP/MQTT local API in docs (UNVERIFIED).
- SunSpec: only 101/102/103 (+160 on Synergy) and meter blocks at base+121/+295/+469; no 111-113, 120-126 listed [SE1]. Control is vendor-specific (section 2 write table).
- Unit id 1 on Ethernet [SE1]. Standard registers big-endian int16+SF; control block (Appendix A) 32-bit values little-endian word order, big-endian map offered at 0x800 [SE1]. Unsupported = NOT_IMPLEMENTED value, unsupported accumulators 0 [SE1].

### Huawei SUN2000 (SDongleA / LAN)
- Modbus TCP via SDongleA-05; installer enables in SUN2000 app (>= 3.2.00.015) Settings > Communication configuration > Dongle parameter settings > Modbus-TCP; restricted (one trusted IP) or unrestricted mode, one connection at a time; doc cites installer password `00000a` [H2]. Port printed as **6607** in [H1 s6.2.2.4]; 502 UNVERIFIED. RTU 1-247 also exists. No local HTTP/MQTT documented.
- SunSpec: not mentioned (UNVERIFIED). Unit 0 = directly connected node, other addresses = downstream devices [H1]. Addresses used as printed (40200 = 0x9D08) [H1].
- Integer + "Gain" divisor (e.g. SOC 37760 U16 Gain 10, power registers I32 W) [H1]. 32-bit word order and sentinels: UNVERIFIED.

### Kostal Plenticore / PIKO IQ
- Modbus TCP default port **1502**, unit id **71** (changeable), enabled in web UI Settings > Modbus/SunSpec (TCP) > Activate; regs 0x02 enable, 0x04 unit id, 0x05 byte order [K1][K4]. Client limit UNVERIFIED. REST `/api/v1` (SCRAM login): no official doc found (UNVERIFIED).
- SunSpec models: 1 @40003, 103 @40071, 113 @40123, 120 @40185, 123 @40213, 160 @40239, 203 @40309, 802 @40416, end @40480 (203 needs G2 02.12 / G3 3.04.01) [K1].
- **Register 5 selects word/byte order**: 0 = "little-endian (CDAB)" (default), 1 = "big-endian (ABCD) SunSpec"; applies to floats [K1]. Inverter sentinels UNVERIFIED. Non-SunSpec setpoints carry SF registers (1025, 833) read first [K1].
- KSEM G1/G2: Modbus TCP slave 502 (TLS-only 802, client cert must be accepted), must be activated; SunSpec common + model 203 only, read-only; SF dynamic; 0x8000 / 0xFFFFFFFF sentinels; power 0.1 W; energy 64-bit 0.1 Wh [K2].

### Sungrow (SH hybrid, SG string)
- Modbus TCP port 502 via WiNet-S / WiNet-S2 / Logger1000 (not iHomeManager); RTU slave 1-247, 9600 8N1; no auth documented; default-on vs setting UNVERIFIED; WebSocket 8082 JSON UNVERIFIED [SG-H s1]. Docs are mirrors with a no-redistribution notice.
- SunSpec: not mentioned (UNVERIFIED).
- **Input (FC04) and holding (FC03/06/10) are separate spaces with overlapping numbers** (13000 is state as input, start/stop as holding). Wire = doc number - 1. 32-bit **low word first**. Sentinels U16 0xFFFF, U32 0xFFFFFFFF, S16 0x7FFF, S32 0x7FFFFFFF. Min request period 1000 ms. Battery modules at 200-203 [SG-H].

### GoodWe (ET/EH/BT/BH)
- RTU address default 0xF7, 9600 baud. WiFi module Modbus TCP is a setting: 47040 "WIFI Modbus TCP Enable", 47017 "ModbusTCP without internet", 45153 protocol type "0 goodwe / 1 sunspec" [GW1]. Port 502, unit id over TCP, default-on, UDP 8899 AA55: UNVERIFIED. SunSpec models UNVERIFIED.
- FC03 reads only; 32-bit high word first; "Multiple" column is a divisor; no sentinels; error codes 02-05 [GW1].

### Growatt
- Nothing verified: no vendor-authored protocol PDF reachable, no documented local LAN service (UNVERIFIED across the board). Datasheets list Modbus TCP only as a monitoring-module server protocol [GR].

### Solax
- Modbus RTU 19200 8N1; **inverter itself has no Modbus TCP, only via SolaX monitoring module**, port 502, unit "0x01 by default"; >= 1 s between requests [SX s2]. Dongle HTTP API and default-on: UNVERIFIED. SunSpec none.
- FC03 holding (config 0x0000-0x01FF, battery 0x0300-0x04FF), FC04 input; big-endian; Gain multiplier real->raw; 32-bit order only stated for VPP block (LSW 0x00A2, MSW 0x00A3), else UNVERIFIED; no sentinels. Export-limit gain differs X1 (1) vs X3 (0.1) [SX].

### Victron (GX device)
- Modbus TCP **off by default** (Settings > Services), port 502, no auth documented [V1][V5]. Local MQTT (dbus-flashmq, Venus >= 3.20) enabled in Settings > Services > MQTT, ports 1883/8883 by security setting, local auth UNVERIFIED [V4]. SunSpec none.
- **Unit id selects the device** (system 100; VE.Bus 246; ids dynamic since Venus 2.60, equal `/DeviceInstance`) [V3][V1]. Scale = raw / "Scalefactor" (can be negative). No global sentinel; a nonexistent register fails the whole request (exception 0x02) [V3]. 32-bit word order UNVERIFIED.
- MQTT topics `N/<portal>/<service>/<instance>/<path>` payload `{"value":..}`; `null` = invalid; `R/` requests; `R/<portal>/keepalive` every <= 30 s (timeout 60 s) or no republish [V4].

### Deye / Sunsynk
- Vendor doc [DY] (mirror, single-phase/generic): RTU 9600, 0x03 read and 0x10 write only; no TCP service in manual [DY2]. Solarman V5 on TCP 8899 (LAN stick): **not vendor-documented**; only reverse-engineered [PYS] (UNVERIFIED). Sunsynk: UNVERIFIED. SunSpec: none.
- 32-bit low word first; signed marked; time HHMM decimal; unsupported registers read 0; no sentinels [DY]. Modbus address register 001 [1,247] [DY].

### Enphase IQ Gateway
- HTTPS (self-signed) `Authorization: Bearer <JWT>`; token minted via Enlighten cloud once (owner 1 year, installer 12 h); endpoints `/ivp/meters`, `/ivp/meters/readings`, `/api/v1/production/inverters`, `/ivp/livedata/status`; data refreshes every 5 min [EN]. Small German base.

### E3/DC
- Modbus TCP **off by default** (Hauptmenue > Smart-Funktionen > Smart Home > Modbus); mode `E3DC` or `SUN_SPEC`, port 502, device id usually 1, own subnet only [E3]. Magic `0xE3DC` at 40001; probe 39999..40003 [E3].
- Simple mode: FC03; int32 **low word first**; battery power negative = discharge; 40082 packs autarky (/256) and self-consumption (mod 256); no sentinels [E3]. SunSpec mode: 1, 801-803, 103, 203, 123 [E3]. RSCP (TCP 5033): UNVERIFIED.

### sonnen
- Local REST API exists (release notes: v2 replaced v1 in 1.7.7; docs only on the device dashboard "Software-Integration") [SO]. Port, `Auth-Token` header, endpoints, Modbus, SunSpec: all UNVERIFIED.

### Senec / Varta
- Senec: no official local interface found; cloud API only (SENEC.Connect) [SE]. `lala.cgi`, Modbus UNVERIFIED.
- Varta: datasheets list "Modbus TCP (SunSpec)" on pulse neo and element backup [VA]; register map, port, unit id, enabling UNVERIFIED. The "Kurzanleitung SunSpec" covers Varta as SunSpec client to a PV inverter only [VA].

## 2b. Write semantics per brand

Only brands with a documented local write. Brands without one: Fronius Solar API (read-only), KSEM, Senec, Varta, Growatt, Enphase, sonnen
(all UNVERIFIED for writes), E3/DC (see below).

### Generic SunSpec [SS][SM]
- FC06 and FC16. Write to unimplemented or R register: ignored, no exception. Bad value: exception 3, stops; earlier registers in the request may already be written.
- Setting group: write settings first, **activation field last**; change while enabled applies only when the activation is written again.
- 123: `WMaxLimPct` (uint16, SF `WMaxLimPct_SF`), `WinTms`, `RvrtTms`, `RmpTms`, `WMaxLim_Ena` (0/1). 124: `StorCtl_Mod` bitfield (bit0 charge limit, bit1 discharge limit), `InWRte`, `OutWRte` (SF `InOutWRte_SF`), `ChaGriSet`. 704 (DER): `WMaxLimPctEna`, `WMaxLimPct`, `...Rvrt`, `...RvrtTms`, `...RvrtRem` (seconds left, read-only).
- SunSpec's own rule for what refreshes `RvrtTms`: UNVERIFIED; see Fronius for the vendor rule.

### SMA
- FC: 0x03/0x04 read, **0x06**, **0x10**, 0x17; any other FC, undefined register, write to RO: Modbus exception [S1][S2]. Silent ignore: not stated.
- Atomic: 32/64-bit values must be written as one block; dependent data accepted only if the whole block is valid [S1]. Mid-block error: S1 continues with the next register, S5 stops writing later ones (docs contradict).
- **Unlock (Grid Guard)**: write personal code (U32) to **43090** (unit 3; unit 1 on Home Manager); reads return the count of enabled devices; relock by writing 0; restart drops it; one client at a time, tied to source IP; HM keeps login 60 min, extended by each command; wrong code blocks 30 s, 30 s, 30 s, then 15 min [S1 s2.3][S5 s6.2]. SunSpec writes (profile 1.1/2.0) and ennexOS designated points need no code [S4][S2].
- Storage X / Sunny Island X (unit 3; System Manager energy management off): FC16 sequence 40210 = 1079 (external setpoint; 303 off, 1077 W, 1078 %), fallback parameters, 41195 = timeout s (1-1800, default 600), 44029 = 303 (ramps off), then 44449 + 44451 as one 4-register block, S32 FIX2, percent x 100 (1000 = 10 %), + discharge / - charge, **write-only, read NaN until first written**; resend ~1 s [S3]. 41193: 2506 keep, 2507 fallback. Read-back state 30955, SOC 30845 [S3].
- Home Manager 2.0: 40016 active power % (S16, WO, effective only with feed-in limit configured), 40015 reactive %, 40024 cos phi FIX4, 40025 excitation 1041/1042; battery inverters 40149 W S32, 40151 plant control 802/803 [S5]. **Setpoints expire after 60 min** to default; refresh by rewriting [S5].
- Limits: RW parameters live in flash, cyclic changes destroy it; control parameters (SunSpec 123 Conn/WMaxLimPct/OutPFSet/VArWMaxPct/VArMaxPct, 704 set points) exempt [S1 s2.2][S4]. Min 10 s per transfer, <= 5 values per inverter [S1]; ennexOS >= 1 s [S2]; HM 1 write/s [S5].

### Fronius
- FC03, **FC06**, FC16 (<= 123 registers). Writes to R/unsupported: silently ignored; invalid value: exception 3; writes to 123/124 with control disabled: exception (code not stated) [FD][FG].
- Preconditions: "Inverter control via Modbus" / "Allow Control" on; optional IP restriction; control priority vs IO/dynamic power reduction (Modbus may lose); switching Modbus data output off clears all active commands [FD p.75].
- Value + enable: one FC16 over `WMaxLimPct, WinTms, RvrtTms, RmpTms, WMaxLim_Ena` e.g. [8000, 0, 0, 0, 1]; value = percent x 10^-SF with SF read first; to change while active, rewrite `WMaxLim_Ena = 1` [FD p.69, 87]. `RmpTms` ignored without exception on Datamanager.
- **Expiry**: `RvrtTms` 0-28800 s; "timer restarted with every Modbus message received"; on expiry next-priority mode takes over; 0 = never [FD p.70][FG p.72]. Reads counting as refresh: UNVERIFIED.
- Read-back: `StActCtl` (Gen24 model 122, regs 36-37) bits FixedW/VAR/PF [FG p.83]. Applied-vs-written difference: UNVERIFIED.
- Storage (124): "all specifications are recommendations"; `StorCtl_Mod` 1/2/3; negative `InWRte`/`OutWRte` force the opposite direction; `MinRsvPct` = SOC reserve; `ChaGriSet` is AND-ed with the DNO Editor grid-charge setting [FD][FG]. Whether `InOutWRte_RvrtTms` is honoured: UNVERIFIED.
- Persistence: `F_Store_Data` (213) = 0xFFFF saves nameplate overrides. No flash-wear note [FD].

### SolarEdge
- FC03, FC06, FC16; **two-register values must be written together with FC16** [SE1]. No unlock/relock documented.
- Prerequisites: `AdvancedPwrControlEn` 0xF142 (Int32) = 1; `ReactivePwrConfig` 0xF104 = 4; then **commit 0xF100 = 1** (read back 0 OK, 0x1-0x4 internal error, 0xF102+ bad register address; 5-10 s per [SE2], < 1.5 s per [SE1]); 0xF101 = 1 restores defaults [SE2][SE3]. Static 0xF1xx writes need the commit.
- Dynamic (no commit, not saved, lost at restart): 0xF001 limit %, 0xF002 cos phi; enhanced block enable 0xF300, initialize 0xF308-0xF320 first; 0xF310 command timeout s, fallback 0xF312/0xF316; **refresh at least every Timeout/2** [SE2][SE3].
- Export control (0xE000 bitfield, 0xE002 W) and StorEdge (0xE004 mode 0-4, 0xE00A default mode, **0xE00B remote timeout 0-86400 s**, 0xE00D command mode, 0xE00E charge W, 0xE010 discharge W); expiry reverts to 0xE00A; refresh rule beyond "renewed at each write" UNVERIFIED; read-back/persistence UNVERIFIED [SE2].
- Wear/rate: none documented; response < 0.5 s, dynamic active power < 1 s [SE1].

### Huawei
- FC03, **FC06**, FC10; 0x2B device id; 0x41 = upload only [H1 s6.3]. Exception 0x80 "No permission" exists; login for writes **UNVERIFIED** (not described).
- Storage RW registers [H1]: 47075/47077 max charge/discharge W (U32); 47081/47082 cutoff capacity (Gain 10); **47083 forced period min and 47084 forced power I32 W, "not stored"**; 47086 working mode (0 adaptive, 1 fixed, 2 max self-consumption, 3 TOU LG, 4 full feed-in, 5 TOU Luna); 47087 grid charge 0/1; 47088 grid-charge cutoff SOC; **47100 forcible charge/discharge 0 stop/1 charge/2 discharge**; 47101 target SOC; 47242/47244 grid-charge power (U32, Gain 1000); 47246-47249 forcible settings; 47299 excess PV in TOU.
- TOU tables: 47028/47200 (41 regs, up to 10 periods; start U16 min, end U16 min, power I32 W); 47255 (43 regs, up to 14 periods; start, end, U8 flag charge/discharge, U8 weekday mask bit0 Sunday) [H1]. Order of 47083/47084/47101 vs 47100, commit register, read-back clamping, timeouts, wear: UNVERIFIED.
- Grid scheduling: 40120/40125/40126 derating, 40122 PF, 40123 Q/S, 40200 start / 40201 shutdown (WO) [H1].

### Kostal Plenticore
- FC03, FC06, FC10; FC04/FC23 unlisted [K1]. Active/reactive setpoints 533 (U16 1..100 %), 583 (S16), 585 (S16 cos phi delta) **not stored, discarded at reset**; doc text says "only writeable" yet lists R/W [K1 s3.3, s3.2].
- External battery (floats, 2 regs, FC16): 1026 AC charge W, 1028 DC current %, 1030 AC power %, 1032 DC A, 1034 DC power W, 1036 DC %, 1038/1040 max charge/discharge, 1042/1044 min/max SOC; negative = charge; float order per register 5 [K1 s3.4]. Needs UI setting Service > Battery settings > Battery control = "External via protocol (Modbus TCP)" with installer login (path from a 2020 manual, G2/G3 unconfirmed) [K3].
- Read-back: 1080 mode (0 none, 1 digital I/O, 2 Modbus), 582 actual battery power, 1076/1078 battery-reported limits [K1].
- G3 SW >= 3.05: 1280/1282 max charge/discharge W; **must be rewritten cyclically**, else fallback 1284/1286 after 1288 s (30..10800) [K1 s3.5]. Older timeout in web UI, value UNVERIFIED [K3]. Wear: UNVERIFIED.

### Sungrow
- FC06 and FC10; broadcast address 0 accepted on string doc [SG-H][SG-S]. No unlock documented. Slave/master: only master inverter needs the command.
- EMS block (doc numbers; wire = -1): **13050 EMS mode** (0 self-consumption, 2 compulsory, 3 external EMS, 4 VPP); **13051 command** (0xAA charge, 0xBB discharge, 0xCC stop); **13052 power** (U16 W). Mode 2: set mode, then command, then power. Modes 3/4: **heartbeat 13080** (0-1000 s, default 20 s) must be refreshed (write 20 about every 10 s) else self-consumption returns [SG-H].
- Limits: 13087 feed-in limit enable (0xAA/0x55), 13074 W, 13088 ratio 0.1 % (wins over 13074), 13089/13090 active power limit, 31222 0.01 kW; stricter limit wins. 13058/13059 max/min SOC 0.1 %; 13000 start/stop 0xCF/0xCE; forced charge window 33208-33219 [SG-H].
- Read-back is the same register; difference UNVERIFIED. "RW registers do not support frequent periodic reading and setting" via WiNet/Logger; no number, no flash figure [SG-H s1.2].

### GoodWe
- FC06, FC10 only; no password/unlock register in the doc [GW1].
- **47511 EMSPowerMode + 47512 EMSPowerSet [0,10000]**: 0x00FF stop, 0x0001 auto, 0x0002 charge-PV, 0x0003 discharge-PV, 0x0004 import-AC, 0x0005 export-AC, 0x0006 conserve, 0x0007 off-grid, 0x0008 standby, 0x0009 buy, 0x000A sell. Single-FC16 vs ordered writes: UNVERIFIED. 42000/42001 block "only BTC and ETC" [GW1].
- 47000 app work mode (0 self-use, 1 off-grid, 2 backup, 3 economic); export limit 47509 enable + 47510 (S16); ECO: 47612 master switch, old 4 groups 47515-47530, new 8 groups 47547-47594 (6 regs each), 47533 clear.
- **WorkWeek (Table 8-34) mixes a mode flag in the high byte with a day bitmask in the low byte** (ECO 0xFF/0x00, peakshaving 0xFC/0x03, back-up 0xFB/0x04, ECO-new 0xF9/0x06, smart charge 0xFA/0x05, "not set" 0x55): read-modify-write hazard [GW1].
- Timeouts: 47117 "API Remote TimeOut Enable", 47118 "API time out" (1-60 min): semantics undocumented (UNVERIFIED); 47038 StopModeSaveEn saves after restart. Wear: not documented.

### Solax
- FC06 and FC10 (1-123 regs). **Unlock: write password (U16 0000-9999) to 0x0000, then the target register, then read back**; lock state FC04 0x0054 (0 locked, 1 unlocked); no relock step, persistence unknown (UNVERIFIED) [SX s3.5].
- **Write address differs from read address**: work mode write 0x001F / read 0x008B; manual sub-mode 0x0020 / 0x008C; export limit 0x0042 / 0x00B6 (or % 0x0011 / 0x0025). Packed U8 fields written singly (0x0061, 0x0062) read back packed in 0x0093. Wait 500 ms then read; mismatch = failure [SX].
- **EEPROM: registers marked star are written to EEPROM, "prohibited from frequent operations", about 1,000,000 writes total, excess "may cause irreversible hardware damage"** [SX].
- VPP block FC10 0x00A0-0x00A8 (mode 0-9, exec mode, S32 power 0x00A2/3 + absorb / - output, ExecDuration 0x00A6, WaitTimeout 0x00A7); after duration device waits WaitTimeout for the next command, then exits [SX].

### Victron
- FC3, 4, **6**, 16; no FC5/23; no difference between 3 and 4 [V1].
- ESS (VE.Bus unit): regs 37/40/41 AC setpoint L1/L2/L3 int16 W (negative = discharge), 38 DisableCharge, 39 DisableFeedIn, 96/98/100 int32; settings-service 2700/2703 setpoint (persistent), 2701/2702 deprecated, 2705 DVCC max charge A, 2900 BatteryLife, 2901 min SOC (scale 10), **2902 ESS mode 3 = external control**, 4609 multi mode 3; **2716 int32 volatile setpoint** (not with DynamicEss) [V3][V2].
- **Regs 37/40/41 must be written once every 60 s or the Multi goes to passthru**; actual power read from unit 246 reg 12; Multi may ignore the setpoint at full/empty battery [V2].
- **Flash**: 2700/2703 persistent; use 2716 to avoid "wearing the flash on the GX-device"; no numeric limit [V2]. Atomic multi-register writes: UNVERIFIED. No unlock.
- MQTT write: `W/<portal>/vebus/257/Hub4/L1/AcPowerSetpoint` payload `{"value":-200}`; do not set retain [V4].

### Deye (owner's device)
- **FC10 write and FC03 read only in the vendor doc; 0x06 not part of the protocol** [DY]. "FC06 is ignored on settings": UNVERIFIED in vendor text (owner finding).
- Enable and value registers (single-phase doc): 043 power on/off 0/1; 248 TOU selling enable (bit0 enable, bits1-7 Mon-Sun, bit8 work mode 3); 250-255 time points HHMM; 256-261 power W [0..8000]; 262-267 voltage 0.01 V; 268-273 SOC %; **274-279 per-point charge-enable bitfield (bit0 grid, bit1 generator, bit2 GM, bit3 BU, bit4 CH)**; 230 grid-charge current A; 231/232 generator/grid charge enable; 217-219 battery shutdown/restart/low % [DY]. Bitfields are R/W 16-bit words: read-modify-write implied, no atomicity text.
- Remote lock reg 020 (off 0x0002 / on 0x0000): effect, auth, relock UNVERIFIED. Three-phase map (148-171, program SOC): UNVERIFIED, no vendor PDF reachable. Timeouts, read-back difference, wear: UNVERIFIED.

### E3/DC
- Simple mode FC03, FC05, FC06 (only on registers marked W). Writable: only wallbox control 40088..40095 (bits: 1 solar/mixed, 2 charge abort, 6 Schuko, 12 phases); "Zum Umschalten der Bits muss die Funktion 05H verwendet werden" [E3 s3.1.7].
- **"Energiespeichersysteme von E3/DC koennen ueber die Modbus-Schnittstelle nicht gesteuert werden"** [E3 s2.2]. 40085 is EMS status bits (read); 40086/40087 reserved. SunSpec mode lists model 123 (WMaxLimPct, RvrtTms, WMaxLim_Ena) though the doc says read-only: write behaviour UNVERIFIED. Battery control needs RSCP (UNVERIFIED, no public doc).

### Not documented for writes
sonnen (API v2 write, `/api/v2/setpoint/...`: UNVERIFIED; release note: write API unavailable under external energy management) [SO]; Senec, Varta, Growatt, Enphase: UNVERIFIED.

## 3. Meters and energy managers

| Device | Local read | Auth | Writes |
|---|---|---|---|
| Shelly 3EM (Gen1) | HTTP `GET /status` (`emeters[]` power, pf, voltage, current, total, total_returned, is_valid), `GET /emeter/{i}`; MQTT `shellies/shellyem3-<id>/emeter/<i>/{power,voltage,current,pf,total,total_returned}` (totals Wh, non-volatile) [SH1] | HTTP Basic, off until set [SH1] | relay `.../relay/0/command` on/off/toggle; `reset_totals`, `reset_data` [SH1] |
| Shelly Pro 3EM (Gen2+) | RPC `EM.GetStatus` (`a_/b_/c_` current, voltage, act_power, aprt_power, pf, freq; totals), `EMData.GetStatus`; profile `triphase` = `em:0`, `monophase` = `em1:0..2`; transports HTTP `POST /rpc`, `GET /rpc/<m>`, WebSocket `ws://<ip>/rpc`, MQTT `<id>/rpc`, UDP RPC (off) [SH2] | digest SHA-256, user `admin`, off until `Shelly.SetAuth` [SH2] | none (no relay); MQTT control lists no EM component [SH2] |
| Tibber Pulse / bridge | local webserver `data.json?node_id=1`, SML binary: **UNVERIFIED** (community only) | UNVERIFIED | none known |
| SML IR reader / Basiszaehler | SML (BSI TR-03109-1 Anlage IV b): frame `1b1b1b1b` + `01010101`, CRC16 (EN 62056-46), value = `SML_Value x 10^scaler` (Integer8); IR 9600 8N1, one telegram/s; OBIS `1.8.0/2.8.0` (+ `.1/.2` tariffs), power `16.7.0` signed [BSI][FNN] | PIN unlocks power and full resolution (locked: counters low resolution, no power) [FNN] | none (unidirectional) |
| SMA Energy Meter / Home Manager | UDP port 9522, big-endian, protocol 0x6069, 6-byte device address (SUSy-ID + serial), 4-byte ms ticker, then OBIS (B,C,D,E)+value; D=4 current (4 B), D=8 counter (8 B); 0.1 W, 1 Ws, 1 mA, 1 mV; C: 1/2 P+/-, 3/4 Q, 9/10 S, 13 pf, 21-32 L1, 41-52 L2, 61-72 L3 [S6]. Multicast 239.12.255.254 only confirmed for discovery [S7]; for meter telegrams UNVERIFIED | none | none. HM 2.0: Modbus TCP 502 grid-management setpoints only [S5] |
| Kostal Smart Energy Meter (KSEM) | Modbus TCP 502 (TLS 802), SunSpec common + 203, 0.1 W, 64-bit 0.1 Wh energy, dynamic SF [K2] | activation in UI; TLS client cert accept | none documented |
| Eastron SDM630 | Modbus RTU only (no TCP): FC04 input, float32 most-significant register first by default, 0-based addresses; V L1-3 0x00/02/04, P total 0x34, pf 0x3E, f 0x46, import kWh 0x48, export 0x4A; unit 1-247, 9600 default; max 80 registers/request [EA] | config password 40025 (default 0000), unlock times out after 1 min unless read | holding FC16 for config only; relock by timeout, writing 40015 or power cycle [EA] |

## 4. Implications: what a declarative profile format must express

Rule: a feature needs >= 2 vendors or the owner's own device (Deye). Brands in parentheses are verified above; "(U)" = unverified, not counted.

### Read side
- **Register space and FC per point (holding 03 vs input 04)**: Sungrow, Solax, Eastron, Victron (3 = 4). GoodWe is FC03 only.
- **Address base per profile** (doc number vs wire): -1 for SunSpec-numbered SMA, Fronius, Kostal, KSEM, Sungrow; as-printed Huawei; 0-based hex Eastron.
- **Types**: int16/uint16/int32/uint32/int64/acc64: all Modbus brands; float32: Kostal, Fronius 111-113, SolarEdge control, Eastron, GoodWe (36015), SunSpec 11x; string (SunSpec, E3/DC, Kostal); enum and bitfield (all).
- **Word order per profile, per-point override, and device-selectable**: low-word-first Sungrow, Deye, E3/DC; high-word-first SMA, GoodWe, KSEM, SunSpec, Eastron; SolarEdge control block LE words (standard block BE); **Kostal order set by register 5 at runtime**. Byte order inside a register is big-endian everywhere seen; Kostal register 5 also names a byte order.
- **Static scale** (divisor/multiplier): Huawei Gain, GoodWe Multiple, Solax Gain, Victron Scalefactor (negative), Sungrow, Deye, E3/DC factors. **Dynamic scale-factor register** (`value = raw x 10^SF`, SF is a point): SMA, Fronius, SolarEdge, Kostal (SunSpec + 833/1025), KSEM. Fronius and KSEM change SF at runtime, so SF is re-read with each poll.
- **SunSpec model discovery** (marker `SunS`, ID/L chain, end 0xFFFF, bases 40001/50001/1): SMA, Fronius, SolarEdge, Kostal, KSEM, E3/DC SunSpec mode, GoodWe (45153 selects). Models shift by firmware or UI toggle (Fronius int/float, SMA dropped models): never hardcode addresses.
- **Sentinels by type, per profile**: SunSpec set (SMA, Fronius, SolarEdge, KSEM); SMA extras (0xFFFFFD, STR32 = 0, acc = 0); Sungrow 0x7FFF/0x7FFFFFFF; per-register text only (Victron); none (GoodWe, Solax, Deye, E3/DC).
- **Packed and structured registers**: byte halves (E3/DC 40082, Solax U8 pairs, GoodWe H/L, Huawei TOU period struct); bit-sliced flags (Deye 248/274, GoodWe WorkWeek, Huawei weekday mask).
- **Time/value codecs**: HHMM decimal (Deye), minutes since 00:00 (Huawei), H/L byte (GoodWe); percent as 0.1 % (Sungrow, Huawei, Deye), x100 FIX2 (SMA), SF-scaled (Fronius), float % (Kostal).
- **Sign convention per point**: battery power charge-positive (Huawei 37001, Solax) vs discharge-positive or charge-negative (Kostal, E3/DC, Victron, Fronius window); grid: Huawei meter feed-in positive, Sungrow buy positive.
- **Several unit ids per endpoint**: SMA (3.., SunSpec = +123), Fronius (inverter N, meters 240+), Victron (one per device), Huawei (0 + downstream), Sungrow (battery 200+), Kostal (71), Eastron.
- **Read planning**: max registers per request (125), min interval (SMA 1-10 s, Sungrow 1 s, Solax 1 s, Fronius timeout 1/10 s), max parallel (Fronius 2), max connections (SolarEdge 1, Huawei 1, SMA 4). **Gap behaviour** differs: SMA gives NaN inside a block, Victron/KSEM fail the whole request (0x02), so profile needs block lists, not one big span.
- **Setup preconditions as data** (installer step needed before any read): SMA, SolarEdge, Fronius, Kostal, Huawei, E3/DC, Victron, GoodWe, Solax.
- **Transport kinds**: Modbus TCP (nearly all), Modbus RTU over serial (Eastron, Deye), Modbus UDP write-only (SMA, old), Solarman V5 envelope over TCP 8899 (Deye; vendor-undocumented, owner's device), **HTTP JSON** (Fronius no auth, Shelly Basic/digest, Enphase Bearer + self-signed TLS; sonnen, Tibber, Kostal REST, SMA Webconnect all UNVERIFIED), **MQTT subscribe** (Victron with keepalive publish, Shelly), **WebSocket RPC** (Shelly Gen2; Sungrow WiNet 8082 UNVERIFIED: one vendor, defer), **UDP multicast passive frame decode** (SMA Speedwire; GoodWe 8899 UNVERIFIED: one vendor, defer), serial SML (BSI/FNN readers; one family, defer unless owner has one).

### Write recipe step kinds
- **Write function per point: FC06 or FC16-only.** FC16 needed for 2-register values (SolarEdge, SMA S32/FIX2, Kostal floats) and for Deye settings (vendor doc defines only 0x10; "FC06 ignored" is owner-reported). FC06 accepted: Fronius, Huawei, Kostal, Sungrow, SMA, Victron, Solax, SolarEdge.
- **Atomic block write** (several registers, one FC16): Fronius (value, win, revert, ramp, enable), SMA (44449 + 44451), SolarEdge (2-reg values), Kostal (floats), Solax VPP block.
- **Ordered sequence with enable-last**: Fronius value then `Ena`, SunSpec generic; Sungrow 13050, 13051, 13052; Huawei mode then 47100; SMA 40210 then timeout, then power; SolarEdge enables then values then commit; Victron 2902 = 3 then setpoints; GoodWe 47511/47512.
- **Commit and verify register**: SolarEdge 0xF100 = 1 with status read-back (0 OK, error codes) after 5-10 s; Fronius re-write `Ena`; Solax write, wait 500 ms, read back.
- **Unlock/lock session step** with a secret, TTL, state register and relock: SMA Grid Guard 43090 (relock 0, HM 60 min extended by use), Solax 0x0000 password (state 0x0054), Eastron 40025 (1 min). Huawei UNVERIFIED.
- **Write-only registers**: SMA 44449/44451 (read NaN until written), Huawei 40200/40201, Kostal 533 ("only writeable"): no read-back from the same register.
- **Read-back from a different register or address**: Solax (write 0x001F, read 0x008B), Victron (write 37, actual power from unit 246 reg 12), Kostal (1080, 582), Fronius (`StActCtl`), SMA (30955). Same-register read-back: Sungrow, Huawei, Deye, GoodWe.
- **Read-modify-write bitfield**: Deye 248/274, GoodWe WorkWeek, Huawei weekday mask. Fronius `StorCtl_Mod` is written whole.
- **Expiry TTL and refresh**: Fronius `RvrtTms` (any message), SolarEdge F310/E00B (refresh <= Timeout/2), Sungrow 13080 heartbeat (20 s, write ~10 s), Victron 37/40/41 (60 s), Kostal 1280/1282 (cyclic, fallback after 1288 s), SMA Storage X 41195 (default 600 s) and HM (60 min), Solax VPP WaitTimeout. A recipe needs: ttl, refresh interval, what to write, fallback registers (Kostal 1284/1286, SolarEdge F312, SMA 41193).
- **Persistence class and rate guard per point**: volatile (Kostal 533, Huawei 47083/47084, Victron 2716, SolarEdge dynamic) vs flash/EEPROM (Solax ~1,000,000 writes, SMA flash, Victron 2700). Needs write-on-change, min interval, daily limit flag (SMA).
- **Precondition gate**: a device-side setting must be on or the write fails or is ignored: Fronius Allow Control and priority, Kostal "External via protocol", SMA grid-management signal source / HM 2.0 service, Sungrow EMS mode, Victron ESS mode 3, GoodWe 47040/47017. Readable where a register exists (Kostal 1080, Victron 2902); otherwise a doc-only check.
- **MQTT write** (topic, JSON payload, retain off): Victron `W/...` `{"value":x}`; Shelly relay `command` (Gen1). HTTP write: Shelly Gen2 `Switch.Set` only (one vendor, defer; sonnen UNVERIFIED).

### Contradictions to keep in the profile notes
- SMA mid-block error handling differs between [S1] and [S5]. Kostal 533/583/585 listed both "only writeable" and R/W [K1]. GoodWe doc text "47510 sets max export" vs table [GW1]. E3/DC doc says SunSpec read-only yet lists model 123 [E3].

## 5. Not verified

- Inverter brand share, installed or new (no primary source; MaStR has no manufacturer field). Brand ranking is storage share only, and from a secondary article (pv magazine) of a primary analysis (Battery Charts) whose own pages were not readable. 2025 ranks 8+ absent.
- Protocols not researched: BYD, Anker, FOX ESS, Marstek, Ecoflow, Fenecon, LG, Tesla, Kaco, RCT Power.
- Vendor-hosted PDFs not reachable for Huawei, Sungrow, GoodWe, Solax, Deye, E3/DC, Kostal, Fronius (Datamanager, Solar API), SolarEdge (power control note): mirrors used, revision may lag. Current SolarEdge Power Control Open Protocol and Fronius xlsx register maps not read.
- Huawei: port (6607 per doc vs 502), 32-bit word order, sentinels, write auth, commit order, SunSpec.
- Kostal: inverter sentinels, client limit, REST API, battery-control menu path on G2/G3, timeout value; Sungrow WiNet default-on, WebSocket 8082; GoodWe port, unit id, UDP 8899, SunSpec models; Solax dongle HTTP, 32-bit order, unlock persistence; Growatt everything.
- Deye: FC06-ignored claim, three-phase map 148-171 and program SOC, remote lock 020, Solarman V5 (vendor doc), Sunsynk.
- E3/DC RSCP; sonnen port, token, endpoints, setpoints, Modbus; Senec local interface; Varta register map; Tibber Pulse local API; Enphase writes; SMA Webconnect, SEMP, Speedwire multicast address for meter telegrams; SunSpec's own RvrtTms refresh rule; Victron 32-bit word order and local MQTT auth.

## Sources

- [M1] MaStR Gesamtdatenexport documentation (xsd: EinheitenSolar, EinheitenStromSpeicher) https://download.marktstammdatenregister.de/Stichtag/Dokumentation%20MaStR%20Gesamtdatenexport%2001-10-2026.zip (listing https://www.marktstammdatenregister.de/MaStR/Datendownload)
- [M2] pv magazine 2025-05-05, P3 + ISEA/Battery Charts https://www.pv-magazine.de/2025/05/05/51-gigawattstunden-heimspeicher-in-2024-asiatische-hersteller-mit-ueber-50-prozent-marktanteil/
- [M3] pv magazine 2026-06-26, same authors https://www.pv-magazine.de/2026/06/26/strukturwandel-im-heimspeichermarkt-2025-marktanteile-der-hersteller-zeigen-hohe-dynamik/
- [M4] BSW-Solar Faktenblatt Speicher, Jan 2026 https://www.solarwirtschaft.de/datawall/uploads/2025/10/BSW-Solar_Faktenblatt_Stromspeicher.pdf
- [M5] BSW-Solar Faktenblatt Photovoltaik, May 2026 https://www.solarwirtschaft.de/datawall/uploads/2025/10/BSW-Solar_Faktenblatt_Photovoltaik.pdf
- [M6] BSW-Solar 2026-10-22 https://www.solarwirtschaft.de/2026/10/22/batteriespeicher-zubau-in-deutschland-steigt-um-91-prozent/
- [M7] https://www.battery-charts.de/
- [M8] EUPD https://www.eupd-research.com/wp-content/uploads/EUPD_Research_PV_EES_InstallerMonitor_2024_2025.pdf and https://www.eupd-research.com/wp-content/uploads/EUPD_Research_EndkundenMonitor_11.pdf
- [SS] SunSpec Information Model Spec v1.8 (mirror, Wayback) https://web.archive.org/web/2023if_/https://sunspec.org/wp-content/uploads/2019/08/SunSpec-Information-Models-12041.pdf
- [SM] SunSpec model JSON https://raw.githubusercontent.com/sunspec/models/master/json/model_123.json (also _124, _704, _715)
- [FD] Fronius Datamanager Modbus TCP&RTU 42,0410,2049 (mirror) https://taphome.com/compatibility/devices/fronius-symo/manufacturer/fronius-datamanager-modbus.pdf
- [FG] Fronius GEN24 Modbus TCP&RTU 42,0410,2649 https://www.fronius.com/de-de/~/downloads/Solar%20Energy/Operating%20Instructions/42,0410,2649.pdf
- [FA] Fronius Solar API V1 42,0410,2012 (mirror) https://github.com/ThomasHoussin/com.thomashoussin.fronius/files/5685344/42.0410.2012.pdf
- [SE1] SolarEdge SunSpec Logging Tech Note v3.2 https://knowledge-center.solaredge.com/sites/kc/files/sunspec-implementation-technical-note.pdf
- [SE2] SolarEdge Power Control Open Protocol v1.3 (mirror) https://github.com/nmakel/solaredge_modbus/files/6872349/Power.Control.Open.Protocol.for.SolarEdge.Inverters.pdf
- [SE3] SolarEdge ramp/active power control v1.0 (mirror) https://communityarchive.victronenergy.com/storage/attachments/ramp-up-down-and-active-power-control-02-01-19.pdf
- [S1] SMA Modbus general https://files.sma.de/downloads/SMA-Modbus-general-TI-en-10.pdf
- [S2] SMA Modbus ennexOS https://files.sma.de/downloads/SMAModbus-ennexOS-TI-en-11.pdf
- [S3] SMA Modbus Storage X / Sunny Island X https://files.sma.de/downloads/SMAModbus-STPS-X-SI-X-TI-en-11.pdf
- [S4] SMA SunSpec Modbus https://files.sma.de/downloads/SunSpecModbus-TI-en-11.pdf
- [S5] SMA Home Manager 2.0 Modbus https://files.sma.de/downloads/HM-20-Modbus-NSD-TI-en-12.pdf
- [S6] SMA EMETER protocol https://developer.sma.de/fileadmin/content/www.developer.sma.de/docs/EMETER-Protokoll-TI-en-10.pdf
- [S7] SMA Speedwire discovery https://developer.sma.de/fileadmin/content/www.developer.sma.de/docs/SpeedwireDD-TI-en-10.pdf
- [S8] https://www.sma.de/en/products/product-features-interfaces/modbus-protocol-interface
- [S9] https://developer.sma.de/on-site-integration
- [K1] Kostal Modbus TCP & SunSpec interface rev 2.7 (mirror) https://taphome.com/compatibility/devices/plentycoreinverter/manufacturer/kostal-modbus-interface.pdf
- [K2] Kostal KSEM interface https://www.kostal-solar-electric.com/fileadmin/downloadcenter/kse/BA_KOSTAL_Interface_KSEM_EN.pdf
- [K3] Kostal PLENTICORE BI manual https://www.kostal-solar-electric.com/fileadmin/downloadcenter/kse/PLENTICORE-BI_BA_EN.pdf
- [K4] https://documents.kostal.com/Interconnection-and-setup-of-several-KOSTAL-inverters/202308/en-GB/368191371.html
- [H1] Huawei Solar Inverter Modbus Interface Definitions v05 (mirror) https://github.com/wlcrs/huawei_solar/files/10920652/Solar.Inverter.Modbus.Interface.Definitions.v05.pdf
- [H2] Huawei SDongleA-05 Modbus TCP guide (mirror) https://github.com/wlcrs/huawei_solar/files/9150658/sdonglea-05-modbus-tcp-guide.pdf
- [SG-H] Sungrow Residential Hybrid Inverter protocol V1.1.11 (mirror) https://forum.iobroker.net/assets/uploads/files/1771841809177-ti_20251119_communication-protocol-of-residential-hybrid-inverter_v1.1.11_en.pdf
- [SG-S] Sungrow string inverter protocol V1.1.2 (mirror) https://forum.iobroker.net/assets/uploads/files/1622363969370-modbus-rs485-rtu-protocol.pdf
- [GW1] GoodWe ET30 Modbus map 20221231 (mirror) https://github.com/marcelblijleven/goodwe/files/13464476/ARM.745.ESG2.ET30.MODBUS.Protocol.Map.20221231.-.v1.pdf
- [GR] Growatt ShineLan-X datasheet https://midsummer.ie/pdfs/shinelan-x-datasheet-en-202108.pdf (no protocol PDF found)
- [SX] SolaX Modbus protocol V001.02 (mirror) https://community.symcon.de/uploads/short-url/ecxNpsZsby8yDD7kHPxv4Gz6ENS.pdf
- [DY] Deye Modbus V118 (mirror) https://github.com/Hypfer/deye-microinverter-cloud-free-assets/raw/master/Deye_Modbus.-.-.V118.pdf
- [DY2] Deye SUN-5-12K-SG04LP3 manual https://www.deyeinverter.com/deyeinverter/2024/02/03/instructions_sun-5-12k-sg04lp3-eu_240203_en.pdf
- [PYS] Solarman V5 (reverse engineered, not primary) https://pysolarmanv5.readthedocs.io/en/latest/solarmanv5_protocol.html
- [V1] Victron Modbus-TCP FAQ https://www.victronenergy.com/live/ccgx:modbustcp_faq
- [V2] Victron ESS mode 2 and 3 https://www.victronenergy.com/live/ess:ess_mode_2_and_3
- [V3] Victron register list https://github.com/victronenergy/dbus_modbustcp/raw/master/CCGX-Modbus-TCP-register-list.xlsx
- [V4] dbus-flashmq https://github.com/victronenergy/dbus-flashmq
- [V5] Victron whitepaper https://www.victronenergy.com/upload/documents/Whitepaper-Data-communication-with-Victron-Energy-products_EN.pdf
- [EN] Enphase token tech brief https://enphase.com/download/iq-gateway-access-using-local-apis-or-local-ui-token-based-authentication-tech-brief
- [E3] E3/DC Modbus/TCP V2.00 (mirror) https://github.com/ioBroker/ioBroker.modbus/files/8694860/ModBus_E3DC_Speichersysteme_V2.00_2022-03-07.pdf
- [SO] sonnen release notes https://www.sonnen.de/rln-sb
- [SE] Senec https://senec.com/de/unternehmen/datenschutz and https://senec.com/de/unternehmen/download
- [VA] Varta https://www.varta-ag.com/fileadmin/varta/consumer/downloads/energy-storage/varta-pulse-neo/Datenblatt_pulse_neo_DACH_DE.pdf and https://www.varta-ag.com/fileadmin/varta/consumer/downloads/energy-storage/varta-element/211015_Kurzanleitung_SunSpec_S5.pdf
- [SH1] https://shelly-api-docs.shelly.cloud/gen1/
- [SH2] https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen2/ShellyPro3EM , .../ComponentsAndServices/EM , .../General/RPCChannels , .../General/Authentication , .../ComponentsAndServices/Mqtt
- [BSI] BSI TR-03109-1 Anlage IV Teil b https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Publikationen/TechnischeRichtlinien/TR03109/TR-03109-1_Anlage_Feinspezifikation_Drahtgebundene_LMN-Schnittstelle_Teilb.pdf?__blob=publicationFile&v=1
- [FNN] VDE FNN INFO-DSS https://vde.com/resource/blob/950874/e5e6719bc5aa56d206dc0aa187984d71/info-datenschnittstelle-am-fnn-basiszaehler---die-standardisierte-inhouse-datenschnittstelle-fuer-den-letztverbraucher--2015--data.pdf and Lastenheft Basiszaehler https://vde.com/resource/blob/2345790/e6c822aa22d51592aba388f6a5ceaed2/fnn-hinweis--lastenheft-basiszaehler---funktionale-merkmale---2018--data.pdf
- [EA] Eastron SDM630 Modbus V1.8 https://www.eastroneurope.com/images/uploads/products/protocol/SDM630_MODBUS_Protocol.pdf
