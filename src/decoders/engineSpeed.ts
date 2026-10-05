// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { InvalidReadingError } from '../errors.js';

/**
 * Converts a crank pulse width to engine speed (`7500000 / pulseWidth`,
 * truncated).
 *
 * @param pulseWidth - Pulse width in ECU timer ticks. Must not be 0.
 * @returns Engine speed in revolutions per minute.
 * @throws {@link InvalidReadingError} if `pulseWidth` is 0. libcomm14cux
 * divides by zero here, which is undefined behaviour in C.
 */
export function pulseWidthToRpm(pulseWidth: number): number {
  if (pulseWidth === 0) {
    // libcomm14cux divides by zero here (undefined behaviour in C).
    throw new InvalidReadingError('Pulse width of zero');
  }

  return Math.trunc(7500000 / pulseWidth);
}

/**
 * Decodes the engine speed from the filtered pulse width. 0xFFFF is the ECU's
 * initial value with the ignition on and the engine stopped, and means 0 RPM.
 *
 * @param pulseWidth - The filtered pulse width, 0 to 0xFFFF.
 * @returns Engine speed in revolutions per minute.
 * @throws {@link InvalidReadingError} if `pulseWidth` is 0.
 */
export function decodeEngineRpm(pulseWidth: number): number {
  return pulseWidth === 0xffff ? 0 : pulseWidthToRpm(pulseWidth);
}
