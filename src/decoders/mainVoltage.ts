// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { InvalidReadingError } from '../errors.js';

/**
 * Reverses the quadratic the ECU applies to the battery-voltage ADC count,
 * then maps the count linearly to volts.
 */
export function decodeMainVoltage(
  stored: number,
  a: number,
  b: number,
  c: number,
): number {
  const discriminant = 4 * a * stored - a * c + 64 * b * b;

  if (discriminant < 0) {
    throw new InvalidReadingError(
      'Main voltage coefficients do not fit reading',
    );
  }

  const adcCount = Math.trunc((-16 * (Math.sqrt(discriminant) - 8 * b)) / a);

  return 0.07 * adcCount - 0.09;
}
