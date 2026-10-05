// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.5 (c14cux_getEngineRPM, c14cux_getRPMLimit)
import { InvalidReadingError } from '../errors.js';
import { decodeEngineRpm, pulseWidthToRpm } from './engineSpeed.js';

describe('engine speed decoding', () => {
  it.each([
    [7500, 1000],
    [1, 7500000],
    [3000, 2500],
    [7501, 999],
    [0xfffe, 114],
  ])('converts pulse width %i to %i RPM (truncated)', (pw, rpm) => {
    expect(pulseWidthToRpm(pw)).toBe(rpm);
  });

  it('rejects a pulse width of 0 (deliberate divergence: C divides by zero)', () => {
    expect(() => pulseWidthToRpm(0)).toThrow(InvalidReadingError);
    expect(() => decodeEngineRpm(0)).toThrow(InvalidReadingError);
  });

  it('treats 0xFFFF as 0 RPM for the engine speed only', () => {
    expect(decodeEngineRpm(0xffff)).toBe(0);
    expect(pulseWidthToRpm(0xffff)).toBe(114);
  });

  it('decodes other engine speed pulse widths with the common formula', () => {
    expect(decodeEngineRpm(7500)).toBe(1000);
  });
});
