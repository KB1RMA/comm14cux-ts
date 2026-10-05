// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Stored fault-code blocks (0x0049 to 0x004E) and the faults each one means,
// from the bit table in docs/test-specification.md §5.12.
import type { FaultCodeName } from 'comm14cux-ts';

/** A fault block and the faults that should read as set. */
export interface FaultFixture {
  /** Short name used in test titles. */
  name: string;
  /** The six bytes at 0x0049. */
  bytes: readonly [number, number, number, number, number, number];
  /** The faults that are set; every other fault should read as clear. */
  set: readonly FaultCodeName[];
}

/** No stored faults. */
export const noFaults: FaultFixture = {
  name: 'no faults',
  bytes: [0, 0, 0, 0, 0, 0],
  set: [],
};

/** After the battery has been disconnected: the ECU flags it on its own. */
export const batteryDisconnected: FaultFixture = {
  name: 'battery disconnected',
  bytes: [0, 0, 0, 0, 0, 0x40],
  set: ['batteryDisconnected'],
};

/** A car with a failing odd-bank lambda sensor and a misfire on that bank. */
export const oddBankTrouble: FaultFixture = {
  name: 'odd bank trouble',
  bytes: [0x12, 0, 0, 0, 0, 0],
  set: ['lambdaSensorOdd', 'misfireOddBank'],
};

/** Several faults across every byte of the block, including the spare bits. */
export const workshopFull: FaultFixture = {
  name: 'one fault in every byte, spare bits set',
  // Spare bits (0x49 bit 3, 0x4A bit 1, 0x4B bits 0/2/4–7, 0x4C bits 1–3/5,
  // 0x4D bits 0–3/6–7, 0x4E bits 0–5) are set too and must be ignored.
  bytes: [
    0x08 | 0x80,
    0x02 | 0x08,
    0xf5 | 0x08,
    0x2e | 0x40,
    0xcf | 0x20,
    0x3f | 0x80,
  ],
  set: [
    'tuneResistorOutOfRange',
    'coolantTempSensor',
    'intakeAirLeak',
    'roadSpeedSensor',
    'fuelTempSensor',
    'ramChecksumFailure',
  ],
};

/** Every fault fixture, for `describe.each`. */
export const allFaultFixtures: readonly FaultFixture[] = [
  noFaults,
  batteryDisconnected,
  oddBankTrouble,
  workshopFull,
];
