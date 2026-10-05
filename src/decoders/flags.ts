// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { PurgeValveState } from '../constants.js';

/** Fuel pump relay is closed when port 1 bit 6 is clear. */
export const decodeFuelPumpRelay = (port1: number): boolean =>
  (port1 & 0x40) === 0;

/** The MIL is lit when port 1 bit 0 is clear. */
export const decodeMilOn = (port1: number): boolean => (port1 & 0x01) === 0;

/** Idle mode is active when bit 0 of 0x2047 is set. */
export const decodeIdleMode = (byte: number): boolean => (byte & 0x01) === 0x01;

/** Screen heater is on when bit 2 of 0x00DD is clear. */
export const decodeScreenHeater = (bits: number): boolean =>
  (bits & 0x04) === 0;

/** A/C compressor is on when bit 3 of 0x008A is clear. */
export const decodeAcCompressor = (bits: number): boolean =>
  (bits & 0x08) === 0;

/** Purge valve state from the ECU's 16-bit purge timer (thresholds are the ECU's). */
export function decodePurgeValveState(timer: number): PurgeValveState {
  if (timer < 4000) {
    return PurgeValveState.Closed;
  }

  return timer < 29000 ? PurgeValveState.Toggling : PurgeValveState.Open;
}
