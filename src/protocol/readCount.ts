// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.
import { ReadCount, ReadCountValue } from '../constants.js';

/**
 * A single read request: how many bytes, and the length code that asks the
 * ECU for them.
 */
export interface ReadChunk {
  /** Number of bytes the ECU will return. */
  count: number;
  /** 5-bit length code for the coarse-address command. */
  code: number;
}

const PRESETS: readonly ReadChunk[] = [
  { count: ReadCount.Count4, code: ReadCountValue.Count4 },
  { count: ReadCount.Count3, code: ReadCountValue.Count3 },
  { count: ReadCount.Count2, code: ReadCountValue.Count2 },
  { count: ReadCount.Count1, code: ReadCountValue.Count1 },
];

/**
 * Chooses the next single read (`c14cux_getByteCountForNextRead`). The ECU
 * can return 1 to 16, 80, 100, 400 or 512 bytes; 1 to 16 bytes use the code
 * `count - 1`.
 *
 * @param total - Total bytes being read over all requests.
 * @param alreadyRead - Bytes read so far; less than `total`.
 * @returns 512, 400, 100 or 80 bytes if that many remain, otherwise up to 16.
 */
export function nextRead(total: number, alreadyRead: number): ReadChunk {
  const bytesLeft = total - alreadyRead;
  const preset = PRESETS.find(({ count }) => bytesLeft >= count);

  if (preset) {
    return preset;
  }

  const count = Math.min(bytesLeft, ReadCount.Count0);

  return { count, code: count - 1 };
}
