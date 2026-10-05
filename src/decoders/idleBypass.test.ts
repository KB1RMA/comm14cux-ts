// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.4 (c14cux_getIdleBypassMotorPosition)
import { decodeIdleBypassPosition } from './idleBypass.js';

describe('idle bypass motor position decoding', () => {
  it.each([
    [0, 1],
    [90, 0.5],
    [180, 0],
    [181, 0],
    [255, 0],
  ])('decodes %i as %d', (raw, expected) => {
    expect(decodeIdleBypassPosition(raw)).toBeCloseTo(expected, 10);
  });
});
