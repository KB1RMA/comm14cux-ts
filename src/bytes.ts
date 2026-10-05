// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

/** Reads an unsigned big-endian 16-bit value (the ECU's byte order). */
export function be16(bytes: Uint8Array, offset = 0): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}
