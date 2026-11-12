/** What the drill-in needs of SvelteKit's router: pass `page` from `$app/state` and `goto` from `$app/navigation`. */
export interface Router {
  readonly page: {
    /** Under the hash router, the document's URL: the route and its query sit in its hash. */
    readonly url: { readonly hash: string };
    readonly state: App.PageState;
  };
  readonly goto: (
    url: string,
    options: Readonly<{ replace: boolean; state: App.PageState }>,
  ) => Promise<void>;
}

/** The hash route of `url`: its path and query, apart from the document's own, such as an ingress prefix. */
function route(url: Router["page"]["url"]): URL {
  return new URL(url.hash.replace(/^#/u, "") || "/", "http://route.invalid");
}

/** The hash route of `url` with `?<key>=` set to `id`, or dropped for null. */
function href(url: Router["page"]["url"], key: string, id: string | null): string {
  const { pathname, searchParams: query } = route(url);

  if (id === null) query.delete(key);
  else query.set(key, id);

  const search = query.size > 0 ? `?${query.toString()}` : "";

  return `#${pathname}${search}`;
}

/**
 * The drill-in's level as `?group=` on the screen's hash route (ADR 21), for `<DrillIn>`'s `open`
 * and `onnavigate`; `key` names another level, such as the dashboard's detail sheet.
 */
export function drillRoute({ page, goto }: Router, key = "group") {
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
      else if (id === null) void goto(href(page.url, key, null), { replace: true, state: {} });
      else
        void goto(href(page.url, key, id), {
          replace: open !== null,
          state: { drilled: open === null || drilled },
        });
    },
  };
}
