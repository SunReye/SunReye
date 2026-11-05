/** One measurement line. A bench prints numbers; it asserts nothing. */
export function report(
  name: string,
  numbers: Record<string, number | string | boolean | null>,
): void {
  const fields = Object.entries(numbers).map(([key, value]) => `${key}=${value}`);
  console.log(`bench ${name}: ${fields.join(" ")}`);
}
