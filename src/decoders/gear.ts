// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { Gear } from '../constants.js';

/**
 * Decodes the gear selection from the neutral switch ADC byte. The thresholds
 * are those hardcoded in the ECU firmware.
 *
 * @param adc - The byte read from 0x2000.
 * @returns Park/neutral below 0x4D, drive/reverse above 0xB3, otherwise manual gearbox.
 */
export function decodeGear(adc: number): Gear {
  if (adc < 0x4d) {
    return Gear.ParkOrNeutral;
  }

  if (adc > 0xb3) {
    return Gear.DriveOrReverse;
  }

  // Manual gearboxes have a resistor fitted to give a midpoint value.
  return Gear.ManualGearbox;
}
