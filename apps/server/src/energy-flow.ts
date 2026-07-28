/**
 * The one place the plant's energy-flow physics lives: what happens to PV in a
 * single time slice, in the self-consumption priority order — PV serves the
 * house load first, the surplus charges the battery (bounded by the charge
 * ceiling and the room left in the pack), the grid takes what fits under the
 * feed-in ceiling, and whatever remains has nowhere to go and is curtailed.
 * Where PV falls short, the battery serves the house down to its floor.
 *
 * Both energy models run through this function — the solar forecast's clipping
 * sim ({@link ../solar-forecast}) and the peak-shaving plan projection
 * ({@link ../peak-shaving-plan}) — so their physics cannot drift; they differ
 * only in the limits they pass (the forecast uses the pack's own bounds, the
 * plan adds the automation's decided ceilings on top).
 */

export const HOUR_MS = 3_600_000;

/** The bounds one slice runs under; use `Infinity` for a non-binding limit. */
export interface FlowLimits {
  /** Battery charge ceiling, W — the pack's own rate or the decided target. */
  chargeCeilingW: number;
  /** Energy still fitting in the pack, kWh. */
  headroomKwh: number;
  /** Energy still above the discharge floor, kWh. */
  aboveFloorKwh: number;
  /** Feed-in ceiling, W — the plant cap, and/or the decided sell limit. */
  exportCeilingW: number;
}

/** Where one slice's power went. All non-negative; the split sums back to PV. */
export interface SlotFlows {
  chargeW: number;
  /** Battery power covering a PV deficit — exclusive with `chargeW`. */
  dischargeW: number;
  exportW: number;
  curtailedW: number;
}

/**
 * One slice of the flow. `hours` converts the energy bounds into power for
 * this slice; a zero/negative width admits no battery movement (nothing can
 * fit into or drain from a pack in no time).
 */
export function flowStep(pvW: number, loadW: number, hours: number, l: FlowLimits): SlotFlows {
  const pv = Math.max(0, pvW);
  const load = Math.max(0, loadW);
  const surplusW = Math.max(0, pv - load);
  const fitsW = hours > 0 ? (Math.max(0, l.headroomKwh) * 1000) / hours : 0;
  const chargeW = Math.max(0, Math.min(l.chargeCeilingW, surplusW, fitsW));
  const sellableW = surplusW - chargeW;
  const exportW = Math.max(0, Math.min(sellableW, l.exportCeilingW));
  const deficitW = Math.max(0, load - pv);
  const drainableW = hours > 0 ? (Math.max(0, l.aboveFloorKwh) * 1000) / hours : 0;
  return {
    chargeW,
    dischargeW: Math.min(deficitW, drainableW),
    exportW,
    curtailedW: sellableW - exportW,
  };
}
