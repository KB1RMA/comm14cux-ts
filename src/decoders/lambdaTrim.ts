// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

/** Lambda fueling trim in counts (-256..255) from the raw 16-bit value. */
export function decodeLambdaTrim(raw: number): number {
  return Math.trunc(raw / 0x80) - 0x100;
}

/** MAF CO trim voltage from the raw 16-bit long-term trim (even bank). */
export function decodeCoTrimVoltage(raw: number): number {
  return (5.0 * (raw >> 7)) / 1024.0;
}
