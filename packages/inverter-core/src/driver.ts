import { applyComputed } from "./computed";
import { ModbusTransport } from "./modbus-transport";
import type {
  DeviceTransport,
  InverterConnection,
  InverterProfile,
  InverterSample,
  InverterSource,
} from "./types";

/**
 * An {@link InverterProfile} read and written through a {@link DeviceTransport}.
 *
 * Everything left above the seam is profile semantics that hold for any source:
 * wrapping decoded values in a timestamped {@link InverterSample} and running
 * the profile's derived metrics over them. How the values were obtained — which
 * registers, in which blocks, over which socket — is entirely the transport's
 * business.
 */
export class ModbusInverter implements InverterSource {
  readonly profile: InverterProfile;
  private readonly transport: DeviceTransport;
  /**
   * The id every sample is stamped with, and therefore the key every reading is
   * stored under. Defaults to the profile's id, which is what an install with
   * one device has always used — but two inverters of the same model on one
   * gateway share a profile and share nothing else, and stamping the profile id
   * would average two machines into one set of history rows without a word.
   */
  private readonly deviceId: string;

  constructor(
    profile: InverterProfile,
    conn: InverterConnection,
    transport: DeviceTransport = new ModbusTransport(profile, conn),
    opts: { deviceId?: string } = {},
  ) {
    this.profile = profile;
    this.transport = transport;
    this.deviceId = opts.deviceId ?? profile.id;
  }

  async read(): Promise<InverterSample> {
    const { values, readAt, degraded } = await this.transport.read();
    applyComputed(this.profile.metrics, values);
    return {
      time: new Date().toISOString(),
      inverterId: this.deviceId,
      metrics: values,
      // Spread rather than assign: a transport that knows nothing about
      // staleness leaves the sample exactly the shape it has always been,
      // instead of gaining two `undefined` keys that serialize as noise.
      ...(degraded === undefined ? {} : { degraded }),
      ...(readAt === undefined ? {} : { readAt }),
    };
  }

  /**
   * Write a `rw` metric in engineering units. Validation belongs to the
   * transport: whether a value is writable at all is a property of how it is
   * addressed (a single holding-register word here), not of the profile.
   */
  async write(key: string, value: number): Promise<void> {
    await this.transport.write(key, value);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
