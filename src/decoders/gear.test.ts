// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.7 (c14cux_getGearSelection)
import { Gear } from '../constants.js';
import { decodeGear } from './gear.js';

describe('gear selection decoding', () => {
  it.each([
    [0x00, Gear.ParkOrNeutral],
    [0x4c, Gear.ParkOrNeutral],
    [0x4d, Gear.ManualGearbox],
    [0x80, Gear.ManualGearbox],
    [0xb3, Gear.ManualGearbox],
    [0xb4, Gear.DriveOrReverse],
    [0xff, Gear.DriveOrReverse],
  ])('decodes 0x%x as gear %i', (adc, gear) => {
    expect(decodeGear(adc)).toBe(gear);
  });
});
