/** What the drill-in needs of SvelteKit's router: pass `page` from `$app/state` and `goto` from `$app/navigation`. */
export interface Router {
  readonly page: {
    readonly url: { readonly pathname: string; readonly search: string };
    readonly state: App.PageState;
  };
  readonly goto: (
    url: string,
    options: Readonly<{ replace: boolean; state: App.PageState }>,
  ) => Promise<void>;
}

/** The hash route `url` with `?group=` set to `id`, or dropped for null. */
function href(url: Router["page"]["url"], id: string | null): string {
  const query = new URLSearchParams(url.search);

  if (id === null) query.delete("group");
  else query.set("group", id);

  const search = query.size > 0 ? `?${query.toString()}` : "";

  return `#${url.pathname}${search}`;
}

/** The drill-in's level as `?group=` on the screen's hash route (ADR 21), for `<DrillIn>`'s `open` and `onnavigate`. */
export function drillRoute({ page, goto }: Router) {
  return {
    get open(): string | null {
      return new URLSearchParams(page.url.search).get("group");
    },
    navigate(id: string | null): void {
      const drilled = page.state.drilled === true;
      const open = this.open;

      // Back to where the drill-in pushed the page; a deep link has no such entry, so it replaces.
      if (id === null && drilled) history.back();
      else if (id === null) void goto(href(page.url, null), { replace: true, state: {} });
      else
        void goto(href(page.url, id), {
          replace: open !== null,
          state: { drilled: open === null || drilled },
        });
    },
  };
}
