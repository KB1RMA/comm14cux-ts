// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { PurgeValveState } from '../constants.js';

/**
 * Decodes the fuel pump relay line. The relay is closed when bit 6 of port 1 is clear.
 *
 * @param port1 - The port 1 byte read from 0x0002.
 * @returns `true` when the relay is closed (pump running).
 */
export const decodeFuelPumpRelay = (port1: number): boolean =>
  (port1 & 0x40) === 0;

/**
 * Decodes the malfunction indicator lamp. It is lit when bit 0 of port 1 is clear.
 *
 * @param port1 - The port 1 byte read from 0x0002.
 * @returns `true` when the MIL is lit.
 */
export const decodeMilOn = (port1: number): boolean => (port1 & 0x01) === 0;

/**
 * Decodes idle mode, which is active when bit 0 of 0x2047 is set.
 *
 * @param byte - The byte read from 0x2047.
 * @returns `true` when the ECU is driving an idle speed.
 */
export const decodeIdleMode = (byte: number): boolean => (byte & 0x01) === 0x01;

/**
 * Decodes the heated screen state. It is on when bit 2 of 0x00DD is clear.
 *
 * @param bits - The flag byte read from its address.
 * @returns `true` when the screen heater is on.
 */
export const decodeScreenHeater = (bits: number): boolean =>
  (bits & 0x04) === 0;

/**
 * Decodes the A/C compressor input. It is on when bit 3 of 0x008A is clear.
 *
 * @param bits - The flag byte read from its address.
 * @returns `true` when the compressor is on.
 */
export const decodeAcCompressor = (bits: number): boolean =>
  (bits & 0x08) === 0;

/**
 * Decodes the purge valve state from the ECU's 16-bit purge timer, using the
 * thresholds the ECU itself uses.
 *
 * @param timer - The value read from 0x0096.
 * @returns Closed below 4000, toggling below 29000, otherwise open.
 */
export function decodePurgeValveState(timer: number): PurgeValveState {
  if (timer < 4000) {
    return PurgeValveState.Closed;
  }

  return timer < 29000 ? PurgeValveState.Toggling : PurgeValveState.Open;
}
