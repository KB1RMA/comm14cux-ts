// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.
import { ReadCount, ReadCountValue } from '../constants.js';

/**
 * Chooses how many bytes to request in the next single read
 * (`c14cux_getByteCountForNextRead`).
 *
 * @param total - Total bytes being read over all requests.
 * @param alreadyRead - Bytes read so far.
 * @returns 512, 400, 100, 80 or 16 if that many bytes remain, otherwise the
 * exact remainder.
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
 * Gives the 5-bit length code that the ECU expects for a read of `length`
 * bytes.
 *
 * @param length - Number of bytes to read, or 0 for the write form of a command.
 * @returns The code, or `undefined` if the ECU cannot produce that many bytes
 * in a single read (valid lengths are 1 to 16, 80, 100, 400 and 512).
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
