// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors
import { be16 } from './bytes.js';

describe('be16', () => {
  it('reads a big-endian word', () => {
    expect(be16(Uint8Array.of(0x12, 0x34))).toBe(0x1234);
  });

  it('honours the offset', () => {
    expect(be16(Uint8Array.of(0, 0xff, 0x01), 1)).toBe(0xff01);
  });

  it('treats missing bytes as zero', () => {
    expect(be16(Uint8Array.of(0x12))).toBe(0x1200);
  });
});
