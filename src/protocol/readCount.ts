// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.
import { ReadCount, ReadCountValue } from '../constants.js';

/**
 * Number of bytes to request in the next single read, given the total being
 * read and how many have been read so far (`c14cux_getByteCountForNextRead`).
 */
export function nextReadCount(total: number, alreadyRead: number): number {
  const bytesLeft = total - alreadyRead;

  for (const count of [
    ReadCount.Count4,
    ReadCount.Count3,
    ReadCount.Count2,
    ReadCount.Count1,
    ReadCount.Count0,
  ]) {
    if (bytesLeft >= count) {
      return count;
    }
  }

  return bytesLeft;
}

/**
 * The 5-bit length code that the ECU expects for a read of `length` bytes.
 * Length 0 (used for writes) encodes as 0. Returns `undefined` for a length
 * the ECU cannot produce in a single read.
 */
export function lengthCode(length: number): number | undefined {
  if (length === 0) {
    return 0;
  }

  if (length >= 1 && length <= ReadCount.Count0) {
    return length - 1;
  }

  switch (length) {
    case ReadCount.Count1:
      return ReadCountValue.Count1;
    case ReadCount.Count2:
      return ReadCountValue.Count2;
    case ReadCount.Count3:
      return ReadCountValue.Count3;
    case ReadCount.Count4:
      return ReadCountValue.Count4;
    default:
      return undefined;
  }
}
