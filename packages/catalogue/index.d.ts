// The types of the module catalogue's sheets, as the core's `GET /api/v1/module-catalogue` serves them.

/** The maker's datasheet every value of a sheet was copied from. */
export interface Source {
  /** As printed on the datasheet. */
  readonly title: string;
  /** The revision or date printed on the datasheet. */
  readonly revision: string;
  readonly url: string;
  /** Why this edition was chosen, where it matters. */
  readonly note?: string;
}

/** A PV module model's datasheet values. */
export interface Datasheet {
  readonly name: string;
  /** Watts at standard test conditions. */
  readonly pmax: number;
  /** Volts and amperes at the maximum power point. */
  readonly vmp: number;
  readonly imp: number;
  /** Open-circuit volts and short-circuit amperes. */
  readonly voc: number;
  readonly isc: number;
  /** Of Pmax, Voc and Isc, in %/K. */
  readonly powerCoefficient: number;
  readonly voltageCoefficient: number;
  readonly currentCoefficient: number;
  /** Metres. */
  readonly width: number;
  readonly height: number;
  readonly bypassDiodes: number;
}

/** The power classes one maker's datasheet prints. */
export interface Sheet {
  readonly maker: string;
  readonly series: string;
  readonly source: Source;
  readonly modules: readonly Datasheet[];
}

export declare const modules: readonly Sheet[];
