/**
 * The two pieces of plain Modbus RTU the Solarman port has to produce for
 * itself: the CRC16, and the exception reply built on it.
 *
 * Everything else about RTU stays modbus-serial's business — this file exists
 * only because a Solarman logger answers a request it dislikes with a V5-level
 * reject (`05 00`, `06 00`) instead of forwarding a Modbus exception PDU, and a
 * reject carries no RTU frame for the parser to read. The port therefore has to
 * MAKE one; see {@link rtuException} and the reject handling in `v5-port.ts`.
 *
 * The CRC is written out here rather than imported from
 * `modbus-serial/utils/crc16.js`: that path is an internal of the library, is
 * not in its `exports` map and ships no types, so importing it buys an ambient
 * declaration and a dependency on a file a patch release may move. The property
 * that actually matters — that this CRC agrees byte for byte with the one
 * modbus-serial validates with, or every synthesized frame is discarded as
 * "CRC error" — is pinned by the end-to-end test that drives a real `ModbusRTU`
 * client, not by the two implementations looking alike.
 */

/** Modbus RTU CRC16 (reflected, polynomial 0xA001, seed 0xFFFF). */
export function crc16(buf: Uint8Array): number {
  let crc = 0xffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc;
}

/**
 * The five-byte RTU exception reply for one request: unit id, the request's
 * function code with 0x80 set, the exception code, and the CRC16 little-endian.
 *
 * Five bytes is not incidental — modbus-serial refuses anything shorter as a
 * length error before it ever looks at the function code, so an exception reply
 * is simultaneously the shortest legal RTU frame and the only shape that can
 * carry a `modbusCode` to the caller.
 *
 * `fn` is the function code AS SENT; it is raised to its exception form here,
 * and a code that already carries 0x80 is left alone rather than rolled over.
 */
export function rtuException(unitId: number, fn: number, code: number): Uint8Array {
  const body = Uint8Array.from([unitId & 0xff, (fn & 0xff) | 0x80, code & 0xff]);
  const crc = crc16(body);
  return Uint8Array.from([...body, crc & 0xff, (crc >> 8) & 0xff]);
}
