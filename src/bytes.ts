// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

/**
 * Reads an unsigned big-endian 16-bit value, the ECU's byte order.
 *
 * @param bytes - Buffer to read from.
 * @param offset - Index of the high byte. Defaults to 0.
 * @returns The value, 0 to 65535. A missing byte is treated as 0.
 */
export function be16(bytes: Uint8Array, offset = 0): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}
