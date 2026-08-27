// Draft-and-save customize session for the statistics page. The page creates
// one and puts it in context; the section shell and the tile grid read it to
// decide what to render and what to offer as a toggle.
//
// Two states in one object on purpose: while the session is inactive every
// query answers from the *saved* preferences (the curated layout every viewer
// sees), and while it is active they answer from the local draft — so turning
// a tile off previews instantly without touching the server, and cancelling
// throws the draft away.

import { getContext, setContext } from "svelte";
import {
  defaultStatisticsPrefs,
  statisticsPrefs,
  type StatisticsPrefs,
} from "$lib/statistics-prefs.svelte";

const KEY = Symbol("statistics-customize");

/** Add `id` when absent, drop it when present. */
const toggled = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

// fallow-ignore-next-line unused-export -- the type of what the context accessors below return; consumers get it by inference and never import the name
export class CustomizeSession {
  /** True while an admin is editing the layout. */
  active = $state(false);
  saving = $state(false);
  /** Working copy; only written back to the server on {@link save}. */
  draft = $state<StatisticsPrefs>(structuredClone(defaultStatisticsPrefs));

  #hiddenSections = $derived(new Set(this.draft.hiddenSections));
  #hiddenTiles = $derived(new Set(this.draft.hiddenTiles));
  #collapsedSections = $derived(new Set(this.draft.collapsedSections));

  /** Copy the saved preferences into the draft and enter customize mode. */
  start(): void {
    this.draft = $state.snapshot(statisticsPrefs.config);
    this.active = true;
  }

  /** Leave customize mode, discarding the draft. */
  cancel(): void {
    this.active = false;
  }

  /** Persist the draft; stays in customize mode when the write fails. */
  async save(): Promise<boolean> {
    this.saving = true;
    const ok = await statisticsPrefs.save($state.snapshot(this.draft));
    this.saving = false;
    if (ok) this.active = false;
    return ok;
  }

  /** Hidden per the draft while customizing, per the saved prefs otherwise. */
  sectionHidden(id: string): boolean {
    return this.active ? this.#hiddenSections.has(id) : statisticsPrefs.isSectionHidden(id);
  }

  /** Hidden per the draft while customizing, per the saved prefs otherwise. */
  tileHidden(id: string): boolean {
    return this.active ? this.#hiddenTiles.has(id) : statisticsPrefs.isTileHidden(id);
  }

  /** Starts collapsed per the draft while customizing, per saved prefs otherwise. */
  sectionCollapsed(id: string): boolean {
    return this.active ? this.#collapsedSections.has(id) : statisticsPrefs.isSectionCollapsed(id);
  }

  toggleSection(id: string): void {
    this.draft.hiddenSections = toggled(this.draft.hiddenSections, id);
  }

  toggleTile(id: string): void {
    this.draft.hiddenTiles = toggled(this.draft.hiddenTiles, id);
  }

  toggleCollapsed(id: string): void {
    this.draft.collapsedSections = toggled(this.draft.collapsedSections, id);
  }
}

/** Create the page's session and publish it to descendants. */
export const setCustomizeSession = (): CustomizeSession => setContext(KEY, new CustomizeSession());

/** The page's session. Only valid inside the statistics page subtree. */
export const getCustomizeSession = (): CustomizeSession => getContext<CustomizeSession>(KEY);
