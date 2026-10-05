// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.3 (c14cux_getMAFReading)
import { InvalidReadingError } from '../errors.js';
import { decodeMafDirect, decodeMafLinear } from './airflow.js';

describe('mass airflow decoding', () => {
  describe('direct', () => {
    it.each([
      [0, 0],
      [511, 511 / 1023],
      [1023, 1],
    ])('decodes %i as %d', (raw, expected) => {
      expect(decodeMafDirect(raw)).toBeCloseTo(expected, 10);
    });

    it('rejects readings above 1023', () => {
      expect(() => decodeMafDirect(1024)).toThrow(InvalidReadingError);
    });
  });

  describe('linearized', () => {
    it.each([
      [0, 0],
      [8645, 0.5],
      [17290, 1],
    ])('decodes %i as %d', (raw, expected) => {
      expect(decodeMafLinear(raw)).toBeCloseTo(expected, 10);
    });

    it('rejects readings above 17290', () => {
      expect(() => decodeMafLinear(17291)).toThrow(InvalidReadingError);
    });
  });
});
