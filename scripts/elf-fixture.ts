// ELF images for tests: the headers a release binary check reads, nothing else.

const machines = { amd64: 62, arm64: 183 } as const;

export interface Build {
  readonly arch: keyof typeof machines;
  /** A PT_INTERP segment, as a dynamically linked executable has. */
  readonly interpreter?: boolean;
  /** DT_NEEDED entries in a PT_DYNAMIC segment; a static-pie carries the segment without them. */
  readonly needed?: number;
  /** A SHT_SYMTAB section, which stripping removes. */
  readonly symbols?: boolean;
}

/** A minimal ELF64 little-endian image with the given program headers and sections. */
export function elf(build: Build): Uint8Array {
  const dynamic = Array.from({ length: build.needed ?? 0 }, () => 1n).concat([0n]);
  const segments = [...(build.interpreter === true ? [3] : []), 2];
  const sections = [0, build.symbols === true ? 2 : 3];
  const phoff = 64;
  const shoff = phoff + segments.length * 56;
  const data = shoff + sections.length * 64;
  const bytes = new Uint8Array(data + dynamic.length * 16);
  const view = new DataView(bytes.buffer);

  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  view.setUint16(18, machines[build.arch], true);
  view.setBigUint64(32, BigInt(phoff), true);
  view.setBigUint64(40, BigInt(shoff), true);
  view.setUint16(54, 56, true);
  view.setUint16(56, segments.length, true);
  view.setUint16(58, 64, true);
  view.setUint16(60, sections.length, true);

  for (const [i, type] of segments.entries()) {
    const at = phoff + i * 56;

    view.setUint32(at, type, true);
    view.setBigUint64(at + 8, BigInt(data), true);
    view.setBigUint64(at + 32, BigInt(type === 2 ? dynamic.length * 16 : 0), true);
  }

  for (const [i, type] of sections.entries()) view.setUint32(shoff + i * 64 + 4, type, true);

  for (const [i, tag] of dynamic.entries()) view.setBigInt64(data + i * 16, tag, true);

  return bytes;
}
