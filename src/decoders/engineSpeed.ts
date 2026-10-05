// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { InvalidReadingError } from '../errors.js';

/** Converts a crank pulse width to RPM (`7500000 / pulseWidth`, truncated). */
export function pulseWidthToRpm(pulseWidth: number): number {
  if (pulseWidth === 0) {
    // libcomm14cux divides by zero here (undefined behaviour in C).
    throw new InvalidReadingError('Pulse width of zero');
  }

  return Math.trunc(7500000 / pulseWidth);
}

/**
 * Engine speed from the filtered pulse width. 0xFFFF is the ECU's initial
 * value with ignition on and the engine stopped, and means 0 RPM.
 */
export function decodeEngineRpm(pulseWidth: number): number {
  return pulseWidth === 0xffff ? 0 : pulseWidthToRpm(pulseWidth);
}
