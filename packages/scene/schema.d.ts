// Generated from crates/core/openapi.json by `bun run --cwd packages/scene types`. Do not edit.

export interface components {
    schemas: {
        /** @description One battery model's datasheet values. */
        readonly BatteryType: {
            /**
             * Format: double
             * @description Watts.
             */
            readonly chargePower: number;
            /** Format: double */
            readonly dischargePower: number;
            /** @description The country of manufacture, ISO 3166-1 alpha-2, only where the datasheet states one. */
            readonly madeIn?: string | null;
            readonly maker: string;
            /** @description The country of the maker's registered seat, ISO 3166-1 alpha-2. */
            readonly makerCountry?: string | null;
            readonly model: string;
            /**
             * Format: double
             * @description In %.
             */
            readonly roundTripEfficiency: number;
            /**
             * Format: double
             * @description Watt-hours.
             */
            readonly usableCapacity: number;
        };
        /**
         * @description A rectangular footprint with one roof. Its width runs along x and its depth along z from its
         *     corner, before it turns.
         */
        readonly Block: {
            /** Format: double */
            readonly depth: number;
            /**
             * Format: double
             * @description The walls' height under the roof.
             */
            readonly eave: number;
            readonly freeForm?: components["schemas"]["FreeForm"] | null;
            /** @description A carport: a post at each corner instead of walls. */
            readonly open?: boolean;
            /** @description How far the roof reaches past the walls; none when stored without it. */
            readonly overhang?: components["schemas"]["Overhang"];
            readonly roof: components["schemas"]["Roof"];
            /** @description `#rrggbb`; the generated finish's own colour without one. */
            readonly roofColour?: string | null;
            /**
             * Format: double
             * @description Degrees clockwise about the corner, seen from above.
             */
            readonly rotation: number;
            readonly wallColour?: string | null;
            /** Format: double */
            readonly width: number;
            /** Format: double */
            readonly x: number;
            /** Format: double */
            readonly z: number;
        };
        /**
         * @description A parking footprint: its width runs along x and its length along z from its corner, before
         *     it turns.
         */
        readonly CarPlace: {
            /** @description The default body's paint, `#rrggbb`; the browser's own grey without one. */
            readonly colour?: string | null;
            /**
             * Format: int32
             * @description The EVCC loadpoint device's id (ADR 10).
             */
            readonly device: number;
            /**
             * Format: double
             * @description An uploaded body is scaled to it.
             */
            readonly length: number;
            /** @description The uploaded GLB's id, its SHA-256 in hex; it replaces the default body. */
            readonly model?: string | null;
            /**
             * Format: double
             * @description Degrees clockwise about the corner, seen from above.
             */
            readonly rotation: number;
            /** Format: double */
            readonly width: number;
            /** Format: double */
            readonly x: number;
            /** Format: double */
            readonly z: number;
        };
        /**
         * @description An upright box standing on a block's roof face, placed in the face's outline like its module
         *     grid: metres across the slope and up it from the face's lowest corner on the left.
         */
        readonly Chimney: {
            /**
             * Format: double
             * @description Its centre on the face.
             */
            readonly across: number;
            /** @description The block's index in the scene. */
            readonly block: number;
            /** Format: double */
            readonly depth: number;
            /** @description The roof face's index in its block, as module grids name it. */
            readonly face: number;
            /**
             * Format: double
             * @description Its level top stands this high over the roof where its upper side meets it.
             */
            readonly height: number;
            /** Format: double */
            readonly up: number;
            /**
             * Format: double
             * @description Its level size: across the slope, and along the fall line seen from above.
             */
            readonly width: number;
        };
        /**
         * @description A tree's crown, by its leaves.
         * @enum {string}
         */
        readonly Crown: "broadleaf" | "conifer";
        /** @description A PV module model's datasheet values. */
        readonly Datasheet: {
            /** Format: int32 */
            readonly bypassDiodes: number;
            /** Format: double */
            readonly currentCoefficient: number;
            /** Format: double */
            readonly height: number;
            /** Format: double */
            readonly imp: number;
            /** Format: double */
            readonly isc: number;
            readonly name: string;
            /**
             * Format: double
             * @description Watts at standard test conditions.
             */
            readonly pmax: number;
            /**
             * Format: double
             * @description Of Pmax, Voc and Isc, in %/K.
             */
            readonly powerCoefficient: number;
            /**
             * Format: double
             * @description Volts and amperes at the maximum power point.
             */
            readonly vmp: number;
            /**
             * Format: double
             * @description Open-circuit volts and short-circuit amperes.
             */
            readonly voc: number;
            /** Format: double */
            readonly voltageCoefficient: number;
            /**
             * Format: double
             * @description Metres.
             */
            readonly width: number;
        };
        /** @description A marker linked to its device, placed on a block's wall. */
        readonly Equipment: {
            /**
             * Format: double
             * @description Metres from the wall's left end, seen from outside.
             */
            readonly along: number;
            /** @description The block's index in the scene. */
            readonly block: number;
            /**
             * Format: int32
             * @description The device's id.
             */
            readonly device: number;
            /** @description Behind the wall, in the building. */
            readonly inside: boolean;
            readonly kind: components["schemas"]["EquipmentKind"];
            readonly wall: components["schemas"]["Wall"];
        };
        /**
         * @description What a marker stands for; a hybrid inverter may carry one of each.
         * @enum {string}
         */
        readonly EquipmentKind: "inverter" | "battery";
        /** @description A polyline on the ground through `points`. */
        readonly Fence: {
            readonly finish: components["schemas"]["FenceFinish"];
            /** Format: double */
            readonly height: number;
            readonly points: readonly components["schemas"]["FencePoint"][];
        };
        /** @enum {string} */
        readonly FenceFinish: "wood" | "metal" | "wall";
        /** @description A point on the ground in the scene's frame. */
        readonly FencePoint: {
            /** Format: double */
            readonly x: number;
            /** Format: double */
            readonly z: number;
        };
        /** @description A footprint and the faces over it, in the scene's frame before the compass turns it. */
        readonly FreeForm: {
            /** @description Each face's corners as x, y and z, in metres, counter-clockwise seen from above. */
            readonly faces: readonly (readonly (readonly number[])[])[];
            /** @description Corners as x and z, in metres. */
            readonly footprint: readonly (readonly number[])[];
        };
        /** @description A module on a roof face. */
        readonly GridModule: {
            /**
             * Format: double
             * @description Its lower left corner across and up the face's outline, in metres, seen from the front.
             */
            readonly across: number;
            /** @description Long side across the slope. */
            readonly landscape: boolean;
            readonly optimized?: boolean;
            /**
             * Format: int32
             * @description Its place along its string's wiring, which runs through the string's modules from the
             *     lowest; a module without one follows them.
             */
            readonly order?: number | null;
            /**
             * Format: int32
             * @description The string it is painted into; unassigned, it produces nothing.
             */
            readonly string?: number | null;
            /** Format: double */
            readonly up: number;
        };
        /** @enum {string} */
        readonly GroundFinish: "lawn" | "paving" | "driveway" | "gravel" | "path";
        /**
         * @description A rectangle on the plot: its width runs along x and its depth along z from its corner,
         *     before it turns.
         */
        readonly GroundSurface: {
            /** Format: double */
            readonly depth: number;
            readonly finish: components["schemas"]["GroundFinish"];
            /**
             * Format: double
             * @description Degrees clockwise about the corner, seen from above.
             */
            readonly rotation: number;
            /** Format: double */
            readonly width: number;
            /** Format: double */
            readonly x: number;
            /** Format: double */
            readonly z: number;
        };
        /** @description One inverter model's datasheet values. */
        readonly InverterType: {
            /**
             * Format: double
             * @description Watts of AC output at its rating.
             */
            readonly acRating: number;
            /**
             * Format: double
             * @description The European weighted efficiency, in %.
             */
            readonly efficiency: number;
            /** @description The MPPT inputs, numbered from 1 in order, as `pv.mppt.*` indices. */
            readonly inputs: readonly components["schemas"]["MpptInput"][];
            /** @description The country of manufacture, ISO 3166-1 alpha-2, only where the datasheet states one. */
            readonly madeIn?: string | null;
            readonly maker: string;
            /** @description The country of the maker's registered seat, ISO 3166-1 alpha-2. */
            readonly makerCountry?: string | null;
            /**
             * Format: double
             * @description Volts.
             */
            readonly maxInputVoltage: number;
            readonly model: string;
        };
        /** @description One layout version. */
        readonly Layout: components["schemas"]["Types"] & {
            /** @description RFC 3339, UTC. */
            readonly appliesFrom: string;
            readonly scene?: components["schemas"]["Scene"] | null;
            readonly strings: readonly components["schemas"]["PvString"][];
            readonly warnings: readonly components["schemas"]["Warning"][];
        };
        /**
         * @description A layout change: every string, applying from an instant on. A member this core does not know
         *     is refused, not dropped (ADR 25).
         */
        readonly LayoutChange: {
            /** @description RFC 3339. */
            readonly appliesFrom: string;
            /** @description By battery device. */
            readonly batteryTypes?: {
                readonly [key: string]: components["schemas"]["BatteryType"];
            };
            /** @description By inverter device: read before its profile (ADR 27). */
            readonly inverterTypes?: {
                readonly [key: string]: components["schemas"]["InverterType"];
            };
            readonly scene?: components["schemas"]["Scene"] | null;
            readonly strings: readonly components["schemas"]["StringDraft"][];
        };
        /**
         * @description An opening's light at night (ADR 20 Night).
         * @enum {string}
         */
        readonly Light: "auto" | "on" | "off";
        /** @description The modules on one roof face, all of one module type. */
        readonly ModuleGrid: {
            /** @description The block's index in the scene. */
            readonly block: number;
            /** @description The roof face's index in its block, in the order the `pv` crate lists a block's roof faces. */
            readonly face: number;
            /** @description The orientation a new module takes: its long side across the slope. */
            readonly landscape: boolean;
            /**
             * Format: int32
             * @description The id of the module type, which sizes the modules.
             */
            readonly moduleType: number;
            readonly modules: readonly components["schemas"]["GridModule"][];
            /**
             * Format: double
             * @description Metres kept free along every edge of the face.
             */
            readonly setback: number;
        };
        readonly ModuleType: components["schemas"]["Datasheet"] & {
            /**
             * Format: int32
             * @description Stable; never reused.
             */
            readonly id: number;
        };
        /** @description One MPPT input's limits on a datasheet. */
        readonly MpptInput: {
            /**
             * Format: double
             * @description Amperes.
             */
            readonly maxCurrent: number;
            /** Format: double */
            readonly maxVoltage: number;
            /**
             * Format: double
             * @description The voltage window, in volts.
             */
            readonly minVoltage: number;
            /**
             * Format: double
             * @description Volts.
             */
            readonly startVoltage: number;
        };
        /** @description Opaque things that cast shade. Positions are a box's corner, else the foot's centre. */
        readonly Obstacle: {
            /** Format: double */
            readonly depth: number;
            /** Format: double */
            readonly height: number;
            /** @enum {string} */
            readonly kind: "box";
            /** Format: double */
            readonly rotation: number;
            /** Format: double */
            readonly width: number;
            /** Format: double */
            readonly x: number;
            /** Format: double */
            readonly z: number;
        } | {
            /** Format: double */
            readonly height: number;
            /** @enum {string} */
            readonly kind: "cylinder";
            /** Format: double */
            readonly radius: number;
            /** Format: double */
            readonly x: number;
            /** Format: double */
            readonly z: number;
        } | {
            readonly crown?: components["schemas"]["Crown"];
            /** Format: double */
            readonly height: number;
            /** @enum {string} */
            readonly kind: "tree";
            /** Format: double */
            readonly radius: number;
            /** Format: double */
            readonly x: number;
            /** Format: double */
            readonly z: number;
        } | {
            /** Format: double */
            readonly depth: number;
            /** Format: double */
            readonly height: number;
            /** @enum {string} */
            readonly kind: "hedge";
            /** Format: double */
            readonly length: number;
            /** Format: double */
            readonly rotation: number;
            /** Format: double */
            readonly x: number;
            /** Format: double */
            readonly z: number;
        };
        /** @description A window or a door in a block's wall. */
        readonly Opening: {
            /**
             * Format: double
             * @description Metres from the wall's left end to the opening's left edge, seen from outside.
             */
            readonly along: number;
            /** @description The block's index in the scene. */
            readonly block: number;
            /** Format: double */
            readonly height: number;
            readonly kind: components["schemas"]["OpeningKind"];
            /**
             * @description Whether it glows at night; the rule's choice is not stored, so a scene stored before the
             *     choice existed loads and saves as it was.
             */
            readonly light?: components["schemas"]["Light"];
            /**
             * Format: double
             * @description Metres from the ground to its lower edge; a door's is 0.
             */
            readonly sill?: number;
            readonly wall: components["schemas"]["Wall"];
            /** Format: double */
            readonly width: number;
        };
        /** @enum {string} */
        readonly OpeningKind: "window" | "frenchWindow" | "frontDoor" | "garageDoor";
        /**
         * @description Metres a roof reaches past the walls, measured level: at the eaves (Traufe) and at the gable
         *     ends or verges (Ortgang). A flat or hip roof has eaves all round.
         */
        readonly Overhang: {
            /** Format: double */
            readonly eave: number;
            /** Format: double */
            readonly verge: number;
        };
        /** @description Modules in series on one plane; strings on one MPPT input are in parallel. */
        readonly PvString: components["schemas"]["Wiring"] & {
            /**
             * Format: int32
             * @description Stable; never reused. The `pv.string.power` index.
             */
            readonly id: number;
        };
        /** @description Pitches in degrees from horizontal. */
        readonly Roof: {
            /** @enum {string} */
            readonly kind: "flat";
        } | {
            /** @enum {string} */
            readonly kind: "monoPitch";
            /** Format: double */
            readonly pitch: number;
        } | {
            /** @enum {string} */
            readonly kind: "gable";
            /** Format: double */
            readonly pitch: number;
        } | {
            /** @enum {string} */
            readonly kind: "hip";
            /** Format: double */
            readonly pitch: number;
        };
        /**
         * @description A window lying flush in a block's roof face, placed in the face's outline like a chimney:
         *     metres across the slope and up it from the face's lowest corner on the left.
         */
        readonly RoofWindow: {
            /**
             * Format: double
             * @description Its centre on the face.
             */
            readonly across: number;
            /** @description The block's index in the scene. */
            readonly block: number;
            /** @description The roof face's index in its block, as module grids name it. */
            readonly face: number;
            /** Format: double */
            readonly length: number;
            /** Format: double */
            readonly up: number;
            /**
             * Format: double
             * @description Its size: across the slope, and up it.
             */
            readonly width: number;
        };
        /** @description The geometry of a plant and where its modules sit. */
        readonly Scene: {
            readonly blocks: readonly components["schemas"]["Block"][];
            readonly carPlaces?: readonly components["schemas"]["CarPlace"][];
            /** @description Rectangular chimneys standing on roof faces. */
            readonly chimneys?: readonly components["schemas"]["Chimney"][];
            /** @description Markers for inverters and batteries. */
            readonly equipment?: readonly components["schemas"]["Equipment"][];
            /** @description Drawn only; they never shade. */
            readonly fences?: readonly components["schemas"]["Fence"][];
            /** @description At most one per roof face. */
            readonly grids?: readonly components["schemas"]["ModuleGrid"][];
            /**
             * Format: double
             * @description The compass bearing, in degrees clockwise from true north, of the scene's forward axis, −z.
             */
            readonly north: number;
            readonly obstacles: readonly components["schemas"]["Obstacle"][];
            /** @description Windows and doors on the blocks' walls. Drawn only; they never shade. */
            readonly openings?: readonly components["schemas"]["Opening"][];
            /** @description Windows lying flush in roof faces. Drawn only; they never shade. */
            readonly roofWindows?: readonly components["schemas"]["RoofWindow"][];
            /** @description Drawn in order, each over the last; without any the plot is lawn. They never shade. */
            readonly surfaces?: readonly components["schemas"]["GroundSurface"][];
        };
        readonly StringDraft: components["schemas"]["Wiring"] & {
            /**
             * Format: int32
             * @description A string kept from an earlier version; absent for a new string.
             */
            readonly id?: number | null;
        };
        /**
         * @description The inverter and battery types a version's devices carry, by device id, copied by value
         *     (ADR 27). Stored as this JSON, which refuses a member this build does not know (ADR 25).
         */
        readonly Types: {
            readonly batteryTypes?: {
                readonly [key: string]: components["schemas"]["BatteryType"];
            };
            readonly inverterTypes?: {
                readonly [key: string]: components["schemas"]["InverterType"];
            };
        };
        /**
         * @description A side of a block's footprint: the front along +z, the right along +x.
         * @enum {string}
         */
        readonly Wall: "front" | "right" | "back" | "left";
        /**
         * @description A string whose open-circuit voltage in the cold exceeds its inverter's maximum DC input
         *     voltage: saved all the same, since the plant may already exist (ADR 20).
         */
        readonly Warning: {
            /**
             * Format: double
             * @description Volts, from the inverter's profile.
             */
            readonly maxInputVoltage: number;
            /**
             * Format: double
             * @description Volts at −10 °C.
             */
            readonly openCircuitVoltage: number;
            /** Format: int32 */
            readonly string: number;
        };
        /**
         * @description Where a string sits and what it is made of. With a scene, its module counts and plane are
         *     derived: the plane is that of its first module.
         */
        readonly Wiring: {
            /**
             * Format: double
             * @description Degrees: 0 south, −90 east, 90 west.
             */
            readonly azimuth: number;
            /**
             * Format: int32
             * @description The inverter's device id.
             */
            readonly device: number;
            /**
             * Format: int32
             * @description The MPPT input, from 1, as the `pv.mppt.*` index.
             */
            readonly input: number;
            /**
             * Format: double
             * @description Wiring, soiling and mismatch, in %.
             */
            readonly loss: number;
            /**
             * Format: int32
             * @description A module type id.
             */
            readonly moduleType: number;
            /** Format: int32 */
            readonly modules: number;
            readonly name: string;
            /**
             * Format: int32
             * @description How many of its modules have an optimizer.
             */
            readonly optimized: number;
            /**
             * Format: double
             * @description Degrees from horizontal.
             */
            readonly tilt: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type BatteryType = components['schemas']['BatteryType'];
export type Block = components['schemas']['Block'];
export type CarPlace = components['schemas']['CarPlace'];
export type Chimney = components['schemas']['Chimney'];
export type Crown = components['schemas']['Crown'];
export type Datasheet = components['schemas']['Datasheet'];
export type Equipment = components['schemas']['Equipment'];
export type EquipmentKind = components['schemas']['EquipmentKind'];
export type Fence = components['schemas']['Fence'];
export type FenceFinish = components['schemas']['FenceFinish'];
export type FencePoint = components['schemas']['FencePoint'];
export type FreeForm = components['schemas']['FreeForm'];
export type GridModule = components['schemas']['GridModule'];
export type GroundFinish = components['schemas']['GroundFinish'];
export type GroundSurface = components['schemas']['GroundSurface'];
export type InverterType = components['schemas']['InverterType'];
export type Layout = components['schemas']['Layout'];
export type LayoutChange = components['schemas']['LayoutChange'];
export type Light = components['schemas']['Light'];
export type ModuleGrid = components['schemas']['ModuleGrid'];
export type ModuleType = components['schemas']['ModuleType'];
export type MpptInput = components['schemas']['MpptInput'];
export type Obstacle = components['schemas']['Obstacle'];
export type Opening = components['schemas']['Opening'];
export type OpeningKind = components['schemas']['OpeningKind'];
export type Overhang = components['schemas']['Overhang'];
export type PvString = components['schemas']['PvString'];
export type Roof = components['schemas']['Roof'];
export type RoofWindow = components['schemas']['RoofWindow'];
export type Scene = components['schemas']['Scene'];
export type StringDraft = components['schemas']['StringDraft'];
export type Types = components['schemas']['Types'];
export type Wall = components['schemas']['Wall'];
export type Warning = components['schemas']['Warning'];
export type Wiring = components['schemas']['Wiring'];
