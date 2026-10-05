// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.14 (c14cux_getTuneRevision)
import { decodeTuneRevision } from './tuneRevision.js';

describe('tune revision decoding', () => {
  it('decodes BCD tune number, checksum fixer and big-endian ident', () => {
    expect(
      decodeTuneRevision(Uint8Array.of(0x36, 0x52, 0xa5, 0x12, 0x34)),
    ).toEqual({
      tuneNumber: 3652,
      checksumFixer: 0xa5,
      tuneIdent: 0x1234,
    });
  });

  it.each([
    [[0x00, 0x00], 0],
    [[0x00, 0x09], 9],
    [[0x99, 0x99], 9999],
  ])('decodes BCD %j as %i', ([b0, b1], number) => {
    expect(
      decodeTuneRevision(Uint8Array.of(b0 ?? 0, b1 ?? 0, 0, 0, 0)).tuneNumber,
    ).toBe(number);
  });
});
