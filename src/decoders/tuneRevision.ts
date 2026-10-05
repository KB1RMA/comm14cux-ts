// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

/**
 * Tune identification stored in the ROM.
 */
export interface TuneRevision {
  /**
   * Decimal tune number decoded from two BCD bytes.
   */
  tuneNumber: number;
  /**
   * Checksum fixer byte.
   */
  checksumFixer: number;
  /**
   * Ident word, which differentiates builds of the same tune number.
   */
  tuneIdent: number;
}

function bcd(byte: number): number {
  return (byte >> 4) * 10 + (byte & 0x0f);
}

/**
 * Decodes the five tune identification bytes.
 *
 * @param bytes - The bytes read from 0xFFE9.
 * @returns The tune number, checksum fixer and ident word.
 */
export function decodeTuneRevision(bytes: Uint8Array): TuneRevision {
  const [b0 = 0, b1 = 0, fixer = 0, identHigh = 0, identLow = 0] = bytes;

  return {
    tuneNumber: bcd(b0) * 100 + bcd(b1),
    checksumFixer: fixer,
    tuneIdent: (identHigh << 8) | identLow,
  };
}
