// The plant timezone the range's days are cut in (ADR 3); until it is read, the viewer's own.
import type { Core } from "../api/core.ts";
import type { Place } from "./range-data.svelte.ts";
import { calendar } from "./range.ts";

export class PlantZone {
  name = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);

  readonly #ahead: number = 0;

  /** The zone and the calendar in it now; a screen of forecasts reaches `ahead` days on. */
  readonly place: Place = $derived({
    zone: this.name,
    cal: calendar(this.name, new Date(), this.#ahead),
  });

  constructor(core: () => Readonly<Pick<Core, "timezone">>, ahead: number) {
    this.#ahead = ahead;

    $effect(() => {
      let live = true;

      const read = async () => {
        const zone = await core().timezone();

        if (live && "name" in zone) this.name = zone.name;
      };

      void read();

      return () => {
        live = false;
      };
    });
  }
}
