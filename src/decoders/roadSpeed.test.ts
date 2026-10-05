// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.2 (c14cux_getRoadSpeed)
import { decodeRoadSpeedMph } from './roadSpeed.js';

describe('road speed decoding', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 1],
    [100, 62],
    [160, 99],
    [255, 158],
  ])('converts %i km/h to %i mph (truncated)', (kph, mph) => {
    expect(decodeRoadSpeedMph(kph)).toBe(mph);
  });
});
