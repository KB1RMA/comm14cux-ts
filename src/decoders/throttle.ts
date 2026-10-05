// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { InvalidReadingError } from '../errors.js';

const MAX_READING = 1023;

/**
 * Rejects a raw throttle reading above the 10-bit maximum.
 *
 * @param raw - The raw reading.
 * @throws {@link InvalidReadingError} if `raw` is above 1023.
 */
export function assertThrottleReading(raw: number): void {
  if (raw > MAX_READING) {
    throw new InvalidReadingError(`Throttle reading out of range: ${raw}`);
  }
}

/**
 * Decodes the throttle position.
 *
 * @param raw - The 10-bit reading, 0 to 1023.
 * @param minimum - 0 for an absolute reading, or the ECU's stored minimum for a
 * corrected reading.
 * @returns Position as a fraction from 0 (closed) to 1 (wide open).
 * @throws {@link InvalidReadingError} if `raw` is above 1023.
 */
export function decodeThrottlePosition(raw: number, minimum: number): number {
  assertThrottleReading(raw);

  // A glitch can put the reading below the stored minimum; report zero
  // (this also avoids dividing by zero when the minimum is 1023).
  return raw > minimum ? (raw - minimum) / (MAX_READING - minimum) : 0;
}
