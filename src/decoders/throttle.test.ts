// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.6 (c14cux_getThrottlePosition)
import { InvalidReadingError } from '../errors.js';
import { decodeThrottlePosition } from './throttle.js';

describe('throttle position decoding', () => {
  describe('absolute (minimum 0)', () => {
    it.each([
      [0, 0],
      [511, 511 / 1023],
      [1023, 1],
    ])('decodes %i as %d', (raw, expected) => {
      expect(decodeThrottlePosition(raw, 0)).toBeCloseTo(expected, 10);
    });

    it('rejects readings above 1023', () => {
      expect(() => decodeThrottlePosition(1024, 0)).toThrow(
        InvalidReadingError,
      );
    });
  });

  describe('corrected', () => {
    it('rescales to (raw - min) / (1023 - min)', () => {
      expect(decodeThrottlePosition(0x140, 0x40)).toBeCloseTo(256 / 959, 10);
    });

    it('decodes raw equal to the minimum as 0', () => {
      expect(decodeThrottlePosition(0x40, 0x40)).toBe(0);
    });

    it('decodes 1023 as 1', () => {
      expect(decodeThrottlePosition(1023, 0x40)).toBe(1);
    });

    it('clamps to 0 when raw is below the stored minimum', () => {
      expect(decodeThrottlePosition(10, 0x40)).toBe(0);
    });

    it('does not divide by zero when the minimum is 1023', () => {
      expect(decodeThrottlePosition(1023, 1023)).toBe(0);
    });
  });
});
