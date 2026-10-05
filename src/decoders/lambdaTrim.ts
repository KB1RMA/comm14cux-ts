// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

/**
 * Decodes a lambda fueling trim. A larger number means more fuel.
 *
 * @param raw - The 16-bit value read from the trim location.
 * @returns Trim in counts, from -256 to 255.
 */
export function decodeLambdaTrim(raw: number): number {
  return Math.trunc(raw / 0x80) - 0x100;
}

/**
 * Decodes the MAF CO trim voltage from the even-bank long-term trim value.
 *
 * @param raw - The 16-bit value read from 0x0046.
 * @returns Voltage in volts.
 */
export function decodeCoTrimVoltage(raw: number): number {
  return (5.0 * (raw >> 7)) / 1024.0;
}
