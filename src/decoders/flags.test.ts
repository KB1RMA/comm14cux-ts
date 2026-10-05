// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.13 (port and flag bits)
import { PurgeValveState } from '../constants.js';
import {
  decodeAcCompressor,
  decodeFuelPumpRelay,
  decodeIdleMode,
  decodeMilOn,
  decodePurgeValveState,
  decodeScreenHeater,
} from './flags.js';

describe('flag decoding', () => {
  it('fuel pump relay is on when port 1 bit 6 is clear', () => {
    expect(decodeFuelPumpRelay(0x00)).toBe(true);
    expect(decodeFuelPumpRelay(0xbf)).toBe(true);
    expect(decodeFuelPumpRelay(0x40)).toBe(false);
  });

  it('MIL is on when port 1 bit 0 is clear', () => {
    expect(decodeMilOn(0xfe)).toBe(true);
    expect(decodeMilOn(0x01)).toBe(false);
  });

  it('idle mode is on when bit 0 is set', () => {
    expect(decodeIdleMode(0x01)).toBe(true);
    expect(decodeIdleMode(0xfe)).toBe(false);
  });

  it('screen heater is on when bit 2 is clear', () => {
    expect(decodeScreenHeater(0xfb)).toBe(true);
    expect(decodeScreenHeater(0x04)).toBe(false);
  });

  it('A/C compressor is on when bit 3 is clear', () => {
    expect(decodeAcCompressor(0xf7)).toBe(true);
    expect(decodeAcCompressor(0x08)).toBe(false);
  });

  it.each([
    [0, PurgeValveState.Closed],
    [3999, PurgeValveState.Closed],
    [4000, PurgeValveState.Toggling],
    [28999, PurgeValveState.Toggling],
    [29000, PurgeValveState.Open],
    [0xffff, PurgeValveState.Open],
  ])('purge timer %i is state %i', (timer, state) => {
    expect(decodePurgeValveState(timer)).toBe(state);
  });
});
