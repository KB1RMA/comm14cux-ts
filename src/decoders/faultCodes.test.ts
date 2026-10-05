// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.12 (c14cux_getFaultCodes)
import {
  FAULT_CODE_BLOCK_SIZE,
  decodeFaultCodes,
  type FaultCodeName,
} from './faultCodes.js';

const CASES: [number, number, FaultCodeName][] = [
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
];

describe('fault code decoding', () => {
  it('uses a six byte block', () => {
    expect(FAULT_CODE_BLOCK_SIZE).toBe(6);
  });

  it('reports no faults for all-zero memory', () => {
    expect(Object.values(decodeFaultCodes(new Uint8Array(6)))).not.toContain(
      true,
    );
  });

  it.each(CASES)('byte %i bit %i sets only %s', (byte, bit, name) => {
    const bytes = new Uint8Array(6);

    bytes[byte] = 1 << bit;

    const codes = decodeFaultCodes(bytes);

    expect(codes[name]).toBe(true);
    expect(Object.values(codes).filter(Boolean)).toHaveLength(1);
  });

  it('ignores spare bits', () => {
    // Spare masks: 0x08, 0x02, 0xF5, 0x2E, 0xCF, 0x3F
    const spare = Uint8Array.of(0x08, 0x02, 0xf5, 0x2e, 0xcf, 0x3f);

    expect(Object.values(decodeFaultCodes(spare))).not.toContain(true);
  });

  it('exposes exactly the 24 named faults', () => {
    expect(Object.keys(decodeFaultCodes(new Uint8Array(6)))).toHaveLength(24);
  });

  it('decodes several simultaneous faults', () => {
    const codes = decodeFaultCodes(Uint8Array.of(0x03, 0, 0, 0, 0, 0xc0));

    expect(codes.romChecksumFailure && codes.lambdaSensorOdd).toBe(true);
    expect(codes.batteryDisconnected && codes.ramChecksumFailure).toBe(true);
    expect(codes.airflowMeter).toBe(false);
  });
});
