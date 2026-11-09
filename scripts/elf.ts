// What a release binary must be (ADR 2): static, stripped and built for its architecture. Reads
// the ELF64 headers directly, so the check runs on any host without binutils.

export type Arch = "amd64" | "arm64";

const machines: Readonly<Record<Arch, number>> = { amd64: 62, arm64: 183 };

const PT_DYNAMIC = 2;
const PT_INTERP = 3;
const SHT_SYMTAB = 2;
const DT_NEEDED = 1;

/** Little-endian reads at byte offsets. */
interface Reader {
  readonly u16: (at: number) => number;
  readonly u32: (at: number) => number;
  readonly u64: (at: number) => number;
}

function reader(bytes: Uint8Array): Reader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    u16: (at) => view.getUint16(at, true),
    u32: (at) => view.getUint32(at, true),
    u64: (at) => Number(view.getBigUint64(at, true)),
  };
}

/** The offset of each entry of the header table the ELF header describes at these fields. */
function entries(read: Reader, offset: number, size: number, count: number): number[] {
  const start = read.u64(offset);

  return Array.from({ length: read.u16(count) }, (_, i) => start + i * read.u16(size));
}

/** Whether the PT_DYNAMIC segment at `header` lists a DT_NEEDED entry. */
function needsLibrary(read: Reader, header: number): boolean {
  const start = read.u64(header + 8);
  const tags = read.u64(header + 32) / 16;

  return Array.from({ length: tags }, (_, i) => read.u64(start + i * 16)).includes(DT_NEEDED);
}

function isElf64(bytes: Uint8Array): boolean {
  const magic = [0x7f, 0x45, 0x4c, 0x46, 2, 1];

  return bytes.length >= 64 && magic.every((byte, i) => bytes[i] === byte);
}

/** What keeps `bytes` from being a release binary for `arch`; empty when nothing does. */
export function binaryProblems(bytes: Uint8Array, arch: Arch): string[] {
  if (!isElf64(bytes)) return ["not a 64-bit little-endian ELF"];

  const read = reader(bytes);
  const machine = read.u16(18);
  const segments = entries(read, 32, 54, 56);
  const sections = entries(read, 40, 58, 60);

  return [
    machine === machines[arch]
      ? ""
      : `built for machine ${machine}, not ${arch} (${machines[arch]})`,
    segments.some((at) => read.u32(at) === PT_INTERP) ? "not static: it names an interpreter" : "",
    segments.some((at) => read.u32(at) === PT_DYNAMIC && needsLibrary(read, at))
      ? "not static: it needs a shared library"
      : "",
    sections.some((at) => read.u32(at + 4) === SHT_SYMTAB)
      ? "not stripped: it has a symbol table"
      : "",
  ].filter((problem) => problem !== "");
}
