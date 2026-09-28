/**
 * `GET /api/sources` — what a dashboard may read a series from, shared by the
 * server (`devices/plant-sources.ts`) and the web source store. Session-level:
 * nothing here an ordinary viewer may not see. Type-only.
 */

/** One selectable device, as the dashboard sees it. */
export interface SourceView {
  slug: string;
  name: string;
  /** The id a live `metrics` frame carries for this device — the profile id, today. */
  profileId: string;
  role: string;
  retired: boolean;
  /** Whether the plant series is read from this device. */
  member: boolean;
}

export interface SourcesResponse {
  plant: {
    /** The `plant` source's members, by slug — empty when nothing can be summed. */
    members: string[];
    /**
     * The resolved IANA zone the server buckets the plant's days, weeks and
     * months in. A viewer elsewhere must ask for windows on THESE midnights,
     * and the plant settings read that holds it is admin-only.
     */
    timeZone: string;
  };
  /** Physical devices in roster order; the virtual optimizer is not a source. */
  devices: SourceView[];
}
