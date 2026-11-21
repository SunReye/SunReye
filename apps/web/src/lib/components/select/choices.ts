// A select field's options, run into the groups its list draws.

export interface Choice<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
  /** The heading of the group it stands in; none for the options before the first heading. */
  readonly group?: string;
}

export interface Section<Value extends string = string> {
  readonly heading?: string;
  readonly choices: readonly Choice<Value>[];
}

/** A section while it is gathered. */
interface Run<Value extends string> {
  heading?: string;
  choices: Choice<Value>[];
}

/** Each run of options under one heading, in order. */
export function sections<Value extends string>(
  options: readonly Choice<Value>[],
): Section<Value>[] {
  const runs: Run<Value>[] = [];

  for (const option of options) {
    const last = runs.at(-1);

    if (last !== undefined && last.heading === option.group) {
      last.choices.push(option);
      continue;
    }

    const run: Run<Value> = { choices: [option] };

    if (option.group !== undefined) run.heading = option.group;

    runs.push(run);
  }

  return runs;
}
