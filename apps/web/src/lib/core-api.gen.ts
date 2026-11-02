export interface paths {
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
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ActiveProfile: {
            id: string;
            /** @description Always false: the device is polled with the new profile at once. */
            restartRequired: boolean;
        };
        ActiveProfileRequest: {
            id: string;
        };
        /** @description The SPA areas this core serves; the SPA hides every area that reads false. */
        Capabilities: {
            automations: boolean;
            controls: boolean;
            history: boolean;
            profileSources: boolean;
            restart: boolean;
            statistics: boolean;
        };
        /** @description What a failed request answers: `{"error": "..."}` with the status that names the fault. */
        ErrorBody: {
            error: string;
        };
        /** @description The inverter connection as the onboarding form edits it. */
        InverterConfig: {
            /** @description Null until a connection is saved. */
            host: string | null;
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
        SetupStatus: {
            /** @description Always false: the core has no accounts yet, so there is no first account to create. */
            needsSetup: boolean;
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
         * @description How the connection is framed on the wire. Only `tcp` is polled so far.
         * @enum {string}
         */
        Transport: "tcp" | "rtu-over-tcp" | "solarman-v5";
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
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
        };
    };
}
