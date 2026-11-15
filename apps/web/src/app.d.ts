declare namespace App {
  interface PageState {
    /** Set on a drill-in level the app pushed, so going back can pop it (ADR 21). */
    readonly drilled?: boolean;
  }
}
