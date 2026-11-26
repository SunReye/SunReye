/** What the drill-in needs of SvelteKit's router: pass `page` from `$app/state` and `goto` from `$app/navigation`. */
export interface Router {
  readonly page: {
    /** Under the hash router, the document's URL: the route and its query sit in its hash. */
    readonly url: { readonly hash: string };
    readonly state: App.PageState;
  };
  readonly goto: (
    url: string,
    options: Readonly<{ replace: boolean; state: App.PageState; reset?: boolean }>,
  ) => Promise<void>;
}

/** The hash route of `url`: its path and query, apart from the document's own, such as an ingress prefix. */
function route(url: Router["page"]["url"]): URL {
  return new URL(url.hash.replace(/^#/u, "") || "/", "http://route.invalid");
}

/** The hash route of `url` with `?<key>=` set to `id`, or dropped for null, and without `inner`. */
function href(
  url: Router["page"]["url"],
  [key, inner]: readonly [string, string | undefined],
  id: string | null,
): string {
  const { pathname, searchParams: query } = route(url);

  if (id === null) query.delete(key);
  else query.set(key, id);

  if (inner !== undefined) query.delete(inner);

  const search = query.size > 0 ? `?${query.toString()}` : "";

  return `#${pathname}${search}`;
}

/**
 * The drill-in's level as `?group=` on the screen's hash route (ADR 21), for `<DrillIn>`'s `open`
 * and `onnavigate`; `key` names another level, such as the dashboard's detail sheet. An `overlay`
 * (a sheet over the page) leaves the page's scroll alone: a drill-in level starts at its top.
 * `inner` names a level inside this one's, such as a device under Settings › Devices, which is a
 * route of its own under that key: it is left behind whenever this level changes.
 */
export function drillRoute(
  { page, goto }: Router,
  key = "group",
  options: Readonly<{ overlay?: boolean; inner?: string }> = {},
) {
  const keys = [key, options.inner] as const;
  const still = options.overlay === true ? { reset: false } : {};

  const group = (url: Router["page"]["url"]): string | null => route(url).searchParams.get(key);

  return {
    get open(): string | null {
      return group(page.url);
    },
    navigate: (id: string | null): void => {
      const drilled = page.state.drilled === true;
      const open = group(page.url);

      // Back to where the drill-in pushed the page; a deep link has no such entry, so it replaces.
      if (id === null && drilled) history.back();
      else if (id === null)
        void goto(href(page.url, keys, null), { replace: true, state: {}, ...still });
      else
        void goto(href(page.url, keys, id), {
          replace: open !== null,
          state: { drilled: open === null || drilled },
          ...still,
        });
    },
  };
}
