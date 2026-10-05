// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.11 (lambda trim and CO trim)
import { decodeCoTrimVoltage, decodeLambdaTrim } from './lambdaTrim.js';

describe('lambda trim decoding', () => {
  it.each([
    [0x0000, -256],
    [0x007f, -256],
    [0x0080, -255],
    [0x8000, 0],
    [0x8080, 1],
    [0xffff, 255],
  ])('decodes raw 0x%x as %i counts', (raw, counts) => {
    expect(decodeLambdaTrim(raw)).toBe(counts);
  });
});

describe('CO trim voltage decoding', () => {
  it.each([
    [0x0000, 0],
    [0x8000, 1.25],
    [0xffff, (5 * 511) / 1024],
  ])('decodes raw 0x%x as %d V', (raw, volts) => {
    expect(decodeCoTrimVoltage(raw)).toBeCloseTo(volts, 10);
  });
});
