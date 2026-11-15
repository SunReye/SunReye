import type { Frozen } from "./define.ts";
import type {
  Identify,
  Profile,
  Quantity,
  Range,
  Setting,
  Variant,
  VariantIdentify,
} from "./generated.ts";

/** One device type of a family, written as a whole profile. */
export interface Member {
  /** 1 to 16 lowercase letters, digits or hyphens, such as `15k`. */
  readonly id: string;
  readonly profile: Frozen<Profile>;
  /** Ids of retired profiles of this device type; a device stored under one moves to the variant. */
  readonly replaces?: readonly string[];
}

/** Fields a variant never overrides; `id` and `version` are the family's. */
const FIXED = ["schema", "manufacturer", "requires", "pollGroups"] as const;

/** The fields a variant overrides, or the family owns. */
const OWN = new Set(["id", "version", "name", "identify", "inverter", "settings", "quantities"]);

function differs<T>(a: T, b: T): boolean {
  return !Bun.deepEquals(a, b, true);
}

function refuse(member: Member, problem: string): never {
  throw new Error(`variant ${member.id} ${problem}`);
}

/** Each identify field's register and type, without its values. */
function registers(fields: readonly Frozen<Identify>[]): readonly object[] {
  return fields.map(({ register, type }) => ({ register, type }));
}

/** A setting without its range. */
function unranged(list: readonly Frozen<Setting>[]): readonly object[] {
  return list.map((s) => ({ ...s, range: undefined }));
}

/** Values of the base's identify fields that differ; the fields themselves may not. */
function identify(base: Frozen<Profile>, member: Member): Frozen<VariantIdentify>[] {
  const fields = member.profile.identify ?? [];

  if (differs(registers(fields), registers(base.identify ?? []))) {
    refuse(member, "declares identify fields apart from the base");
  }

  return fields.flatMap(({ register, values }, i) =>
    values !== undefined && differs(values, base.identify?.[i]?.values)
      ? [{ register, values }]
      : [],
  );
}

/** Ranges of the base's settings that differ; nothing else of a setting may. */
function settings(base: Frozen<Profile>, member: Member): Record<string, Frozen<Range>> {
  const ours = member.profile.settings ?? [];
  const theirs = base.settings ?? [];

  if (differs(unranged(ours), unranged(theirs))) {
    refuse(member, "differs from the base in a setting other than its range");
  }

  return Object.fromEntries(
    ours.flatMap(({ key, range }, i) =>
      range !== undefined && differs(range, theirs[i]?.range) ? [[key, range]] : [],
    ),
  );
}

/** The quantities a variant drops and adds, checked against the order the loader merges them in. */
function quantities(base: Frozen<Profile>, member: Member): Pick<Frozen<Variant>, "drop" | "add"> {
  const ours = new Map(member.profile.quantities.map((q) => [q.key, q]));
  const theirs = new Map(base.quantities.map((q) => [q.key, q]));
  const drop = base.quantities.filter((q) => differs(q, ours.get(q.key))).map((q) => q.key);
  const add = member.profile.quantities.filter((q) => differs(q, theirs.get(q.key)));
  const replaced = (q: Frozen<Quantity>) => add.filter((a) => a.key === q.key);

  const merged = [
    ...base.quantities.flatMap((q) => (drop.includes(q.key) ? replaced(q) : [q])),
    ...add.filter((a) => !theirs.has(a.key)),
  ];

  if (differs(merged, member.profile.quantities)) {
    refuse(member, "orders its quantities apart from the base");
  }

  return { ...(drop.length > 0 && { drop }), ...(add.length > 0 && { add }) };
}

function inverter(base: Frozen<Profile>, member: Member): Pick<Frozen<Variant>, "inverter"> {
  const section = member.profile.inverter;

  if (!differs(section, base.inverter)) return {};

  if (section === undefined) refuse(member, "drops the base's inverter section");

  return { inverter: section };
}

function variant(base: Frozen<Profile>, member: Member): Frozen<Variant> {
  const { profile } = member;
  const fixed = FIXED.find((f) => differs(profile[f], base[f]));

  const field =
    fixed ?? Object.keys(profile).find((f) => !OWN.has(f) && !FIXED.some((x) => x === f));

  if (field !== undefined) refuse(member, `differs from the base in ${field}`);

  const values = identify(base, member);
  const ranges = settings(base, member);

  return {
    id: member.id,
    name: profile.name,
    ...(member.replaces !== undefined && { replaces: member.replaces }),
    ...(values.length > 0 && { identify: values }),
    ...inverter(base, member),
    ...(Object.keys(ranges).length > 0 && { settings: ranges }),
    ...quantities(base, member),
  };
}

/**
 * `base` with each of `members` as a variant (ADR 5): only what a member's whole profile changes
 * from the base. Throws where a member differs in anything a variant cannot override.
 */
export function defineFamily(base: Frozen<Profile>, members: readonly Member[]): Frozen<Profile> {
  return { ...base, variants: members.map((member) => variant(base, member)) };
}
