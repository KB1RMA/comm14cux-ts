// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { InvalidReadingError } from '../errors.js';

const MAX_READING = 1023;

/** Rejects a raw throttle ADC reading above the 10-bit maximum. */
export function assertThrottleReading(raw: number): void {
  if (raw > MAX_READING) {
    throw new InvalidReadingError(`Throttle reading out of range: ${raw}`);
  }
}

/**
 * Throttle position as a fraction (0..1). `minimum` is 0 for an absolute
 * reading, or the ECU's stored minimum for a corrected reading.
 */
export function decodeThrottlePosition(raw: number, minimum: number): number {
  assertThrottleReading(raw);

  // A glitch can put the reading below the stored minimum; report zero
  // (this also avoids dividing by zero when the minimum is 1023).
  return raw > minimum ? (raw - minimum) / (MAX_READING - minimum) : 0;
}
