// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §2.1 (c14cux_getByteCountForNextRead)
import { lengthCode, nextReadCount } from './readCount.js';

describe('nextReadCount(total, alreadyRead)', () => {
  it.each([
    [1000, 0, 512],
    [512, 0, 512],
    [511, 0, 400],
    [400, 0, 400],
    [399, 0, 100],
    [100, 0, 100],
    [99, 0, 80],
    [80, 0, 80],
    [79, 0, 16],
    [16, 0, 16],
    [15, 0, 15],
    [1, 0, 1],
    [10, 10, 0],
    [0, 0, 0],
  ])('total %i, read %i -> %i', (total, read, expected) => {
    expect(nextReadCount(total, read)).toBe(expected);
  });

  it('splits a 16 KiB ROM dump into 32 reads of 512', () => {
    const chunks: number[] = [];

    for (let read = 0; read < 0x4000;) {
      const n = nextReadCount(0x4000, read);

      chunks.push(n);
      read += n;
    }

    expect(chunks).toHaveLength(32);
    expect(new Set(chunks)).toEqual(new Set([512]));
  });

  it('splits 79 bytes into 16+16+16+16+15', () => {
    const chunks: number[] = [];

    for (let read = 0; read < 79;) {
      const n = nextReadCount(79, read);

      chunks.push(n);
      read += n;
    }

    expect(chunks).toEqual([16, 16, 16, 16, 15]);
  });
});

describe('lengthCode', () => {
  it.each(Array.from({ length: 16 }, (_, i) => i + 1))(
    'encodes %i as length - 1',
    (n) => {
      expect(lengthCode(n)).toBe(n - 1);
    },
  );

  it.each([
    [80, 0x10],
    [100, 0x11],
    [400, 0x12],
    [512, 0x13],
  ])('encodes %i as 0x%x', (n, code) => {
    expect(lengthCode(n)).toBe(code);
  });

  it('encodes 0 (the write form) as 0', () => {
    expect(lengthCode(0)).toBe(0);
  });

  it.each([17, 79, 81, 99, 101, 399, 401, 511, 513, -1])('rejects %i', (n) => {
    expect(lengthCode(n)).toBeUndefined();
  });
});
