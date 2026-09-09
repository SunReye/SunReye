/**
 * What every device write is followed by: the cached plant facts are dropped
 * and the runtime re-reads its roster.
 *
 * The plant facts cache (`../settings/plant-facts.ts`) holds the device rows
 * the weather config composes its PV arrays from. Until this existed nothing
 * invalidated it on a device edit, so arrays added on the Devices page were
 * invisible to the forecast and the amortisation weighting until the process
 * restarted — the page said "PV arrays: still to configure" over a row that
 * plainly had them.
 */
export async function afterDeviceWrite(
  facts: { invalidate(): void },
  reload: () => Promise<void>,
): Promise<void> {
  facts.invalidate();
  await reload();
}
