// A calendar day as the builder holds it: `YYYY-MM-DD` in the browser's calendar.

export interface DayParts {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  readonly day: number;
}

export function written({ year, month, day }: DayParts): string {
  return [
    String(year).padStart(4, "0"),
    ...[month, day].map((part) => String(part).padStart(2, "0")),
  ].join("-");
}

/** The parts of a written day, or nothing when the text is not one. */
export function parts(text: string): DayParts | undefined {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);

  if (found === null) return undefined;

  const [year = 0, month = 0, day = 0] = found.slice(1).map(Number);

  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month)
    ? { year, month, day }
    : undefined;
}

/** The days `month` (1–12) has in `year`. */
export function daysIn(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Today's parts in the browser's calendar. */
export function now(): DayParts {
  const date = new Date();

  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** Today in the browser's calendar. */
export function today(): string {
  return written(now());
}
