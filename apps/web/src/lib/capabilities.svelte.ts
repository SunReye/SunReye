import { type Capabilities, type CapabilityName, hasCapability } from "./capabilities";
import { core } from "./core-api";

/** What the connected core serves; read by every component that offers an area. */
class CoreCapabilities {
  #reported = $state<Capabilities | null>(null);

  has(name: CapabilityName): boolean {
    return hasCapability(this.#reported, name);
  }

  /** Reads the capabilities once at startup. An engine that cannot answer keeps everything shown. */
  async load(): Promise<void> {
    try {
      const { data } = await core.GET("/api/capabilities");
      this.#reported = data ?? null;
    } catch {
      this.#reported = null;
    }
  }
}

export const coreCapabilities = new CoreCapabilities();
