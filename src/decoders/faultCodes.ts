// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// [byte offset from 0x0049, bit (0 = LSB), name]. Spare bits are omitted.
// Names follow the field names of `c14cux_faultcodes`.
const FAULT_BITS = [
  [0, 0, 'romChecksumFailure'],
  [0, 1, 'lambdaSensorOdd'],
  [0, 2, 'lambdaSensorEven'],
  [0, 4, 'misfireOddBank'],
  [0, 5, 'misfireEvenBank'],
  [0, 6, 'airflowMeter'],
  [0, 7, 'tuneResistorOutOfRange'],
  [1, 0, 'injectorOddBank'],
  [1, 2, 'injectorEvenBank'],
  [1, 3, 'coolantTempSensor'],
  [1, 4, 'throttlePot'],
  [1, 5, 'throttlePotHiMafLo'],
  [1, 6, 'throttlePotLoMafHi'],
  [1, 7, 'purgeValveLeak'],
  [2, 1, 'mixtureTooLean'],
  [2, 3, 'intakeAirLeak'],
  [3, 0, 'lowFuelPressure'],
  [3, 4, 'idleValveStepperMotor'],
  [3, 6, 'roadSpeedSensor'],
  [3, 7, 'neutralSwitch'],
  [4, 4, 'lowFuelPressureOrAirLeak'],
  [4, 5, 'fuelTempSensor'],
  [5, 6, 'batteryDisconnected'],
  [5, 7, 'ramChecksumFailure'],
] as const;

/**
 * Name of a fault flag in {@link FaultCodes}, taken from the field names of
 * the C `c14cux_faultcodes` struct.
 */
export type FaultCodeName = (typeof FAULT_BITS)[number][2];

/** Fault code flags (`c14cux_faultcodes`); `true` means the fault is set. */
export type FaultCodes = Record<FaultCodeName, boolean>;

/** Number of bytes in the fault code block at 0x0049. */
export const FAULT_CODE_BLOCK_SIZE = 6;

/**
 * Decodes the fault code block into named flags. Spare bits are ignored.
 *
 * @param bytes - The six bytes read from 0x0049.
 * @returns A flag for each fault; `true` means the fault is set.
 */
export function decodeFaultCodes(bytes: Uint8Array): FaultCodes {
  const codes = {} as FaultCodes;

  for (const [byteIndex, bit, name] of FAULT_BITS) {
    codes[name] = (((bytes[byteIndex] ?? 0) >> bit) & 1) === 1;
  }

  return codes;
}
