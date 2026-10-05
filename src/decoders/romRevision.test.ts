// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.8 (c14cux_determineDataOffsets)
import { DataOffsetRev } from '../constants.js';
import { classifyOldRevision, isRevC } from './romRevision.js';

describe('ROM data-offset revision detection', () => {
  it('detects Rev C when any byte exceeds 0x30', () => {
    const row = new Uint8Array(16).fill(0x10);

    row[15] = 0x31;

    expect(isRevC(row)).toBe(true);
  });

  it('does not treat 0x30 as exceeding 0x30', () => {
    expect(isRevC(new Uint8Array(16).fill(0x30))).toBe(false);
  });

  it('does not detect Rev C for an all-low row', () => {
    expect(isRevC(new Uint8Array(16))).toBe(false);
  });

  it('classifies old ROMs as Rev A when the voltage factor byte is 0xFF', () => {
    expect(classifyOldRevision(0xff)).toBe(DataOffsetRev.RevA);
  });

  it('classifies old ROMs as Rev B otherwise', () => {
    expect(classifyOldRevision(0x00)).toBe(DataOffsetRev.RevB);
    expect(classifyOldRevision(0xfe)).toBe(DataOffsetRev.RevB);
  });
});
