export interface paths {
    "/api/admin/api-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listApiKeys"];
        put?: never;
        post: operations["createApiKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/api-keys/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["revokeApiKey"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listUsers"];
        put?: never;
        post: operations["createUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["removeUser"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/users/{id}/role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["setUserRole"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["currentSession"];
        put?: never;
        post?: never;
        delete: operations["logout"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/sign-up": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Only while no account exists: the first one is the admin, every later one is created by an admin. */
        post: operations["signUp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["capabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A connection on its own, before any device is on it. */
        post: operations["addConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connections/probe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Whether something accepts a connection at the endpoint: no unit id, no register read. A failure is a
         *     result (`ok: false`), not an error of the request.
         */
        post: operations["probeConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connections/scan-units": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** The first unit id that answers a one-register read with the profile's map. Only reads. */
        post: operations["scanUnits"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connections/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Refused while any device, retired included, is on it. */
        delete: operations["removeConnection"];
        options?: never;
        head?: never;
        /** Every device on the connection follows it. */
        patch: operations["patchConnection"];
        trace?: never;
    };
    "/api/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every device, retired ones included, with every connection. */
        get: operations["listDevices"];
        put?: never;
        post: operations["addDevice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/devices/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Only a device that never stored a reading: one with history is refused with `field: "history"`, so
         *     the page offers retiring it instead.
         */
        delete: operations["removeDevice"];
        options?: never;
        head?: never;
        patch: operations["patchDevice"];
        trace?: never;
    };
    "/api/forecast": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The uncurtailed PV potential; null while the forecast is off or unconfigured, or no irradiance was had. */
        get: operations["rawForecast"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/forecast/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["forecastProviders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/forecast/usable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** What the feed-in cap and the battery leave of it; null as for the raw forecast. */
        get: operations["usableForecast"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/history/recent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The last readings of every metric, bucketed, to seed the live sparklines. */
        get: operations["recentHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/history/rollup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Minute, hour or day buckets of one metric, UTC, oldest first; the newest hour and day are open. */
        get: operations["rollupHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/kiosk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Public, so the login page can offer the kiosk view. */
        get: operations["kioskStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The active profile as the dashboard builds itself from it. */
        get: operations["profileManifest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/profile-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["profileStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/profiles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listProfiles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/active-profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["chooseProfile"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/inverter": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["readInverter"];
        /** Saving polls the device as soon as a profile is chosen too. */
        put: operations["saveInverter"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/inverter/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A device that cannot be reached is a result (`ok: false`), not an error of the request. */
        post: operations["testInverter"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/kiosk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["setKiosk"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/profile-sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listProfileSources"];
        put?: never;
        /**
         * Fetches the source and replaces what an earlier fetch of it stored, polling devices by the new
         *     definitions. An invalid profile is skipped and reported; the rest load.
         */
        post: operations["addProfileSource"];
        /**
         * Removes a stored source and the profiles only it supplied. The source that supplies the active
         *     profile stays.
         */
        delete: operations["removeProfileSource"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/profiles/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Validates the uploaded profile file and stores it, replacing an earlier import of its id; devices are
         *     polled by the new definition. The rejection names the field, never the value.
         */
        post: operations["importProfile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/profiles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Removes an imported profile, or one a source supplied. A compiled-in profile and the active one stay;
         *     devices poll only the active one, so polling is untouched.
         */
        delete: operations["removeProfile"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/time-zone": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The saved zone, or the host's while none is saved. */
        get: operations["readTimeZone"];
        put: operations["saveTimeZone"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/weather": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["readWeather"];
        /** A patch of the plant-level fields; arrays, panel physics and the battery are edited on the inverter. */
        put: operations["saveWeather"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/setup-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["setupStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The plant and every device a series may be read from. */
        get: operations["listSources"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/entities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listEntities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description The signed-in account as the SPA reads it. */
        Account: {
            admin: boolean;
            email: string;
            /** Format: int64 */
            id: number;
            name: string;
        };
        ActiveProfile: {
            id: string;
            /** @description Always false: the device is polled with the new profile at once. */
            restartRequired: boolean;
        };
        ActiveProfileRequest: {
            id: string;
        };
        AddedSource: components["schemas"]["Source"] & {
            profileIds: string[];
            /** @description Files the index listed that did not load, with why. */
            skipped: components["schemas"]["Skipped"][];
        };
        /** @description A key as listed: never the key itself. */
        ApiKeyView: {
            createdAt: string;
            /** Format: int64 */
            id: number;
            name: string;
            /** @description The key's first characters. */
            start: string;
            userEmail: string;
            /** Format: int64 */
            userId: number;
            userName: string;
        };
        /** @description The battery the forecast's clipping sim models. */
        Battery: {
            /**
             * Format: double
             * @description W; unbounded when null.
             */
            maxChargeW?: number | null;
            /**
             * Format: double
             * @description Reserve floor, %.
             */
            minSoc?: number;
            /** Format: double */
            usableKwh: number;
        };
        /** @description The SPA areas this core serves; the SPA hides every area that reads false. */
        Capabilities: {
            automations: boolean;
            controls: boolean;
            history: boolean;
            /** @description Coded integrations and the MQTT connections they run over. */
            integrations: boolean;
            profileSources: boolean;
            /** @description An inverter's PV arrays and battery pack, kept per device. */
            pvAndBattery: boolean;
            restart: boolean;
            statistics: boolean;
        };
        /** @description The active profile and the entities it reads. */
        Catalog: {
            entities: components["schemas"]["Entity"][];
            id: string;
            manufacturer: string;
            name: string;
        };
        /** @description An existing connection by id, or one to create with the device. */
        ConnectionChoice: {
            /** Format: int64 */
            id: number;
        } | {
            create: components["schemas"]["NewConnectionRequest"];
        };
        /** @enum {string} */
        ConnectionKind: "modbus";
        ConnectionPatch: {
            /** @description Accepted when it is the connection's own kind. */
            kind?: string | null;
            name?: string | null;
            params?: components["schemas"]["ModbusParams"] | null;
        };
        ConnectionView: {
            /** Format: int64 */
            id: number;
            kind: components["schemas"]["ConnectionKind"];
            name: string;
            params: components["schemas"]["ModbusParams"];
        };
        Correction: {
            /** @description Apply the learned correction; it learns either way. */
            enabled: boolean;
        };
        /** @description The only answer that holds the key. */
        CreatedApiKey: components["schemas"]["ApiKeyView"] & {
            key: string;
        };
        /** @description One slot of the Solcast-shaped curve Home Assistant PV blueprints read. */
        DetailedPoint: {
            period_start: string;
            /** Format: double */
            watts: number;
        };
        /** @enum {string} */
        DeviceKind: "modbus";
        DevicePatch: {
            /** @description Replaces the inverter's arrays. */
            arrays?: components["schemas"]["PvArray"][] | null;
            battery?: components["schemas"]["Battery"] | null;
            /** Format: int64 */
            connectionId?: number | null;
            name?: string | null;
            profileId?: string | null;
            /** @description True retires the device: kept with its history, no longer polled. False restores it. */
            retired?: boolean | null;
            role?: string | null;
            /**
             * Format: double
             * @description `null` falls back to the plant's; absent leaves it.
             */
            systemLoss?: number | null;
            /**
             * Format: double
             * @description `null` falls back to the plant's; absent leaves it.
             */
            tempCoefficient?: number | null;
            /** Format: int64 */
            unitId?: number | null;
        };
        DeviceRoster: {
            connections: components["schemas"]["ConnectionView"][];
            devices: components["schemas"]["DeviceView"][];
        };
        /**
         * @description Why a device is, or is not, polled.
         * @enum {string}
         */
        DeviceState: "polling" | "idle" | "retired";
        DeviceView: {
            arrays: components["schemas"]["PvArray"][];
            battery?: components["schemas"]["Battery"] | null;
            connection?: components["schemas"]["ConnectionView"] | null;
            /** Format: int64 */
            connectionId: number;
            /** Format: int64 */
            id: number;
            integration?: string | null;
            kind: components["schemas"]["DeviceKind"];
            name: string;
            params: Record<string, never>;
            profileId: string;
            profileKnown: boolean;
            profileName?: string | null;
            /** @description UTC ISO 8601 while retired. */
            retiredAt?: string | null;
            role: string;
            /** @description The device id as a decimal string. */
            slug: string;
            state: components["schemas"]["DeviceState"];
            /**
             * Format: double
             * @description %; the plant's when null.
             */
            systemLoss?: number | null;
            /**
             * Format: double
             * @description %/°C; the plant's when null.
             */
            tempCoefficient?: number | null;
            /** Format: int32 */
            unitId: number;
        };
        /** @description Whether something accepted a connection at an endpoint, as 3.x answers it. */
        EndpointProbe: {
            error?: string;
            /** @description Over Solarman V5: the serial the stick named itself with. */
            logger?: components["schemas"]["Logger"];
            /** Format: int64 */
            ms: number;
            ok: boolean;
        };
        Entity: {
            group: string | null;
            key: string;
            label: string | null;
            unit: string | null;
        };
        /** @description What a failed request answers: `{"error": "..."}` with the status that names the fault. */
        ErrorBody: {
            error: string;
            /** @description The request field the refusal concerns, when the client acts on it. */
            field?: string | null;
        };
        /**
         * @description An optional subsystem the roles of a profile show.
         * @enum {string}
         */
        Feature: "solar_sell" | "grid_charge" | "time_of_use";
        /** @description What the sign of a signed metric means. */
        Flow: {
            negative: string;
            positive: string;
        };
        /** @description One view as 3.x exports it, with the age of its irradiance. */
        ForecastExport: components["schemas"]["ForecastView"] & {
            /** @description The Solcast-shaped curve Home Assistant PV blueprints read. */
            detailedForecast: components["schemas"]["DetailedPoint"][];
            /** @description When the irradiance was fetched, UTC ISO 8601. */
            fetchedAt: string;
            provider: string;
            /** @description The last fetch failed: this is built from the irradiance before it. */
            stale: boolean;
            /** Format: int64 */
            stepMinutes: number;
            /** Format: int32 */
            utcOffsetSeconds: number;
        };
        ForecastPatch: {
            correction?: components["schemas"]["Correction"] | null;
            enabled?: boolean | null;
            /** Format: double */
            houseLoadW?: number | null;
            /** Format: double */
            maxOutputW?: number | null;
            provider?: string | null;
            smartMeterSince?: string | null;
        };
        /** @description One power projection over the series and its sums. */
        ForecastView: {
            next15: components["schemas"]["Next15"];
            /**
             * Format: double
             * @description From `now` to plant-local midnight, the running slot prorated.
             */
            remainingTodayKwh: number;
            series: components["schemas"]["Point"][];
            /** Format: double */
            todayKwh: number;
            /** Format: double */
            tomorrowKwh: number;
        };
        /** @description The unit id that answered, and how long its read took. */
        FoundUnit: {
            /** Format: int64 */
            ms: number;
            /** Format: int32 */
            unitId: number;
        };
        ImportedProfile: {
            id: string;
        };
        InverterCapabilities: {
            backupLoad: boolean;
            battery: boolean;
            /** @description Keys of the metrics the profile marks writable. */
            controls: string[];
            features: components["schemas"]["Feature"][];
            generator: boolean;
            grid: boolean;
            /**
             * Format: int32
             * @description 1 or 3, from distinct grid phase voltage indices.
             */
            phases: number;
            /**
             * Format: int32
             * @description Distinct PV string indices.
             */
            pvStrings: number;
        };
        /** @description The inverter connection as the onboarding form edits it. */
        InverterConfig: {
            /** @description Null until a connection is saved. */
            host: string | null;
            /**
             * Format: int64
             * @description The stick's serial, for `solarman-v5`; without one it is learned from the stick on connect.
             */
            loggerSerial?: number | null;
            /** Format: int64 */
            pollIntervalMs: number;
            /** Format: int64 */
            port: number;
            /** @description Always false: the core has no fake device. */
            simulate: boolean;
            /**
             * Format: int64
             * @description Bounds the connect and every read of one poll.
             */
            timeoutMs: number;
            transport: components["schemas"]["Transport"];
            /** Format: int64 */
            unitId: number;
        };
        InverterManifest: {
            capabilities: components["schemas"]["InverterCapabilities"];
            id: string;
            manufacturer: string;
            metrics: components["schemas"]["ManifestMetric"][];
            name: string;
        };
        Kiosk: {
            enabled: boolean;
        };
        /** @description A stored source with the ids of the profiles it supplied. */
        Listed: components["schemas"]["Source"] & {
            profileIds: string[];
        };
        /** @description The stick that answered an endpoint probe. */
        Logger: {
            /** Format: int32 */
            serial: number;
        };
        LoginRequest: {
            email: string;
            password: string;
            /** @description Keep the session for a year instead of until the browser closes. */
            rememberMe?: boolean;
        };
        ManifestMetric: {
            enumLabels?: {
                [key: string]: string;
            } | null;
            flow?: components["schemas"]["Flow"] | null;
            group: string;
            /** Format: int32 */
            index?: number | null;
            key: string;
            kind: components["schemas"]["MetricKind"];
            label: string;
            range?: components["schemas"]["Range"] | null;
            role?: string | null;
            storage: components["schemas"]["Storage"];
            /** @description MQTT topic suffix. */
            topic: string;
            unit: string | null;
            writable: boolean;
        };
        /**
         * @description How a widget treats the metric.
         * @enum {string}
         */
        MetricKind: "measurement" | "cumulative" | "status" | "setting";
        /**
         * @description A Modbus endpoint. `timeoutMs` and `pollIntervalMs` are the core's, for every connection, and
         *     `/api/settings/inverter` sets them: an edit stating other values is refused, an add ignores them.
         */
        ModbusParams: {
            host: string;
            /**
             * Format: int64
             * @description The stick's serial, `solarman-v5` only.
             */
            loggerSerial?: number | null;
            /** Format: int64 */
            pollIntervalMs?: number;
            /** Format: int64 */
            port?: number;
            /** Format: int64 */
            timeoutMs?: number;
            transport?: components["schemas"]["Transport"];
        };
        NewApiKeyRequest: {
            name: string;
            /** Format: int64 */
            userId: number;
        };
        /** @description A connection as a writer states it. */
        NewConnectionRequest: {
            /** @description `modbus`; the core reaches no other kind. */
            kind: string;
            name: string;
            params: components["schemas"]["ModbusParams"];
        };
        NewDeviceRequest: {
            connection: components["schemas"]["ConnectionChoice"];
            name: string;
            profileId: string;
            role: string;
            /** Format: int64 */
            unitId: number;
            /** @description `profile` or absent; the core authors no other tier. */
            via?: string | null;
        };
        /** @description An account an admin creates; the admin hands the password to its person. */
        NewUserRequest: {
            admin: boolean;
            email: string;
            name: string;
            password: string;
        };
        /** @description The 15 minutes after `now`; `avg_power_w × 0.25 h` equals `energy_kwh`. */
        Next15: {
            /** Format: double */
            avgPowerW: number;
            /** Format: double */
            energyKwh: number;
            /** Format: double */
            maxPowerW: number;
        };
        PlantSource: {
            /** @description The `plant` source's history members by slug; empty when nothing can be summed. */
            members: string[];
            timeZone: string;
        };
        PlantTimeZone: {
            /** @description IANA name, e.g. `Europe/Berlin`. */
            timeZone: string;
        };
        Point: {
            /**
             * Format: double
             * @description Peak within the slot, W.
             */
            peakWatts: number;
            /** @description Slot start, plant-local. */
            time: string;
            /**
             * Format: double
             * @description Average over the slot, W.
             */
            watts: number;
        };
        /** @description An endpoint to test, as the connection dialog holds it. */
        ProbeRequest: {
            /** @description `modbus`; the core reaches no other kind. */
            kind: string;
            params: components["schemas"]["ModbusParams"];
        };
        ProfileEntry: {
            active: boolean;
            /** @description Compiled into the binary. */
            builtin: boolean;
            id: string;
            /** @description Downloaded from a profile source. The compiled-in profiles are not. */
            installed: boolean;
            manufacturer: string;
            name: string;
        };
        ProfileStatus: {
            activeProfileId: string | null;
            needsProfile: boolean;
        };
        Provider: {
            capabilities: components["schemas"]["Capabilities"];
            id: string;
            label: string;
        };
        /** @description One PV array: panels sharing an orientation. */
        PvArray: {
            /**
             * Format: double
             * @description Degrees: 0 south, -90 east, 90 west.
             */
            azimuth: number;
            /** Format: double */
            kwp: number;
            /**
             * Format: int32
             * @description `index` of the inverter's `pv.string.*` metrics this array is wired into.
             */
            mppt?: number | null;
            /**
             * Format: double
             * @description %; the inverter's, else the plant's, when absent.
             */
            systemLoss?: number | null;
            /**
             * Format: double
             * @description %/°C; the inverter's, else the plant's, when absent.
             */
            tempCoefficient?: number | null;
            /**
             * Format: double
             * @description Degrees from horizontal.
             */
            tilt: number;
        };
        Range: {
            /** Format: double */
            max: number;
            /** Format: double */
            min: number;
        };
        /** @description Every point is at `t0 + o[i] * step * 1000` milliseconds, so no timestamp repeats. */
        Recent: {
            metrics: {
                [key: string]: components["schemas"]["Series"];
            };
            /** Format: int32 */
            step: number;
            /** Format: int64 */
            t0: number;
        };
        Removed: {
            /** Format: int64 */
            id: number;
            ok: boolean;
        };
        RevokeRequest: {
            /** Format: int64 */
            id: number;
        };
        RoleRequest: {
            admin: boolean;
        };
        RollupPoint: {
            /** Format: double */
            avg: number;
            /** Format: double */
            max: number;
            /** Format: double */
            min: number;
            /** @description UTC start of the bucket. */
            time: string;
        };
        ScanRequest: {
            /** @description The ids to ask, in order, at most 16; by default 1, 0, 2, 3, 4, 5. */
            candidates?: number[] | null;
            /** @description `modbus`; the core reaches no other kind. */
            kind: string;
            params: components["schemas"]["ModbusParams"];
            /** @description Whose register map the scan reads with. */
            profileId: string;
        };
        /** @description One metric's points: `o[i]` steps after `t0`, holding `v[i]`. */
        Series: {
            o: number[];
            v: number[];
        };
        SetupStatus: {
            /** @description No account exists yet: the first sign-up creates the admin. */
            needsSetup: boolean;
        };
        SignUpRequest: {
            email: string;
            name: string;
            password: string;
        };
        /** @description A file the index listed that did not load. */
        Skipped: {
            path: string;
            reason: string;
        };
        /** @description One decoded value of a test read. */
        SnapshotMetric: {
            group: string;
            key: string;
            label: string;
            unit: string | null;
            /** Format: double */
            value: number;
        };
        SolarForecastConfig: {
            /** @description Every in-service inverter's, in roster order. */
            arrays: components["schemas"]["PvArray"][];
            battery: components["schemas"]["Battery"] | null;
            correction: components["schemas"]["Correction"];
            enabled: boolean;
            /**
             * Format: double
             * @description W; inferred from history when null.
             */
            houseLoadW: number | null;
            /**
             * Format: double
             * @description Feed-in cap, W.
             */
            maxOutputW: number | null;
            provider: string;
            /** @description `YYYY-MM-DD` the smart meter gateway was installed. */
            smartMeterSince: string | null;
            /**
             * Format: double
             * @description Plant fallback, %.
             */
            systemLoss: number;
            /**
             * Format: double
             * @description Plant fallback, %/°C.
             */
            tempCoefficient: number;
        };
        /**
         * @description Where a source's profile files live. No credentials: a URL with userinfo, a query or a fragment is
         *     refused, so nothing secret is stored or logged.
         */
        Source: {
            /** @description `https://` base the index and every profile path resolve against. */
            baseUrl: string;
            /** @description Path of the index under the base, e.g. `index.json`. */
            indexPath: string;
        };
        SourceView: {
            /** @description Whether the plant series is read from this device. */
            member: boolean;
            name: string;
            profileId: string;
            retired: boolean;
            role: string;
            slug: string;
        };
        SourcesResponse: {
            /** @description Every device in roster order, retired ones included. */
            devices: components["schemas"]["SourceView"][];
            plant: components["schemas"]["PlantSource"];
        };
        /**
         * @description Where a metric's values are kept.
         * @enum {string}
         */
        Storage: "series" | "config" | "none";
        /** @description A connection to test, with the profile to read it with. Without one the active profile is used. */
        TestRequest: components["schemas"]["InverterConfig"] & {
            profileId?: string | null;
        };
        /** @description The outcome of a test read: an error, or the captured snapshot. */
        TestResult: {
            /** Format: int64 */
            durationMs?: number;
            error?: string;
            metricCount?: number;
            metrics?: components["schemas"]["SnapshotMetric"][];
            ok: boolean;
        };
        /**
         * @description How the connection is framed on the wire.
         * @enum {string}
         */
        Transport: "tcp" | "rtu-over-tcp" | "solarman-v5";
        UnitScan: {
            found: components["schemas"]["FoundUnit"] | null;
            /** @description Every id asked, in order, so a miss names what was ruled out. */
            scanned: number[];
        };
        /** @description The composed record. */
        WeatherConfig: {
            enabled: boolean;
            forecast: components["schemas"]["SolarForecastConfig"];
            label: string;
            /** Format: double */
            latitude: number | null;
            /** Format: double */
            longitude: number | null;
        };
        /** @description A `PUT /api/settings/weather` body: absent keeps the stored value, `null` clears a nullable one. */
        WeatherPatch: {
            enabled?: boolean | null;
            forecast?: components["schemas"]["ForecastPatch"] | null;
            label?: string | null;
            /** Format: double */
            latitude?: number | null;
            /** Format: double */
            longitude?: number | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listApiKeys: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiKeyView"][];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createApiKey: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewApiKeyRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedApiKey"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    revokeApiKey: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RevokeRequest"];
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listUsers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Account"][];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewUserRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Account"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    removeUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    setUserRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Account"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Account"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    currentSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Account"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    signUp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SignUpRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Account"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    capabilities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Capabilities"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    addConnection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewConnectionRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionView"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    probeConnection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProbeRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EndpointProbe"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    scanUnits: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScanRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnitScan"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    removeConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Removed"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    patchConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConnectionPatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionView"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listDevices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeviceRoster"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    addDevice: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewDeviceRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeviceView"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    removeDevice: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Removed"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    patchDevice: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DevicePatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeviceView"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    rawForecast: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForecastExport"] | null;
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    forecastProviders: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Provider"][];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    usableForecast: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForecastExport"] | null;
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    recentHistory: {
        parameters: {
            query?: {
                /** @description How far back the window reaches. Default 300. */
                seconds?: number;
                /** @description Width of one bucket. Default 1. */
                stepSeconds?: number;
                /** @description `plant`, or a device's decimal id. Without it, the first device in service. */
                source?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Recent"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    rollupHistory: {
        parameters: {
            query: {
                metric: string;
                /** @description `plant`, or a device's decimal id. Without it, the first device in service. */
                source?: string;
                /** @description As `source`, which wins when both are set. */
                inverterId?: string;
                /** @description Bucket width. Default `hour`. */
                bucket?: "minute" | "hour" | "day";
                /** @description How far back from now. Default 168. Ignored when `from` and `to` are both set. */
                hours?: number;
                /** @description Start of the window, RFC 3339, inclusive. */
                from?: string;
                /** @description End of the window, RFC 3339, exclusive. */
                to?: string;
                /** @description Most buckets, oldest first. Default 5000; without a session at most 12000. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RollupPoint"][];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description A per-device metric read for a plant of several members */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    kioskStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Kiosk"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    profileManifest: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InverterManifest"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    profileStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileStatus"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listProfiles: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileEntry"][];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    chooseProfile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ActiveProfileRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActiveProfile"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    readInverter: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InverterConfig"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    saveInverter: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InverterConfig"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InverterConfig"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    testInverter: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TestRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TestResult"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    setKiosk: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Kiosk"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Kiosk"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listProfileSources: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Listed"][];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    addProfileSource: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Source"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AddedSource"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    removeProfileSource: {
        parameters: {
            query: {
                /** @description The base URL as the source was added. */
                baseUrl: string;
                /** @description The index path as the source was added. */
                indexPath: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    importProfile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The profile JSON file, as text */
        requestBody: {
            content: {
                "text/plain": string;
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportedProfile"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    removeProfile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    readTimeZone: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlantTimeZone"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    saveTimeZone: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlantTimeZone"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlantTimeZone"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    readWeather: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WeatherConfig"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    saveWeather: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WeatherPatch"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WeatherConfig"];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    setupStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetupStatus"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listSources: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SourcesResponse"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listEntities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Catalog"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
}
