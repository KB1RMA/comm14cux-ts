// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Snapshots of ECU RAM for a few situations a diagnostic tool would see, with
// the readings each should produce. Raw values are chosen by hand; expected
// values are worked out from docs/test-specification.md §5 and written as
// literals or as the spec's formula, never by calling the library.
import { Gear, PurgeValveState } from 'comm14cux-ts';

/** Everything a live-data dashboard shows, as read by `readDashboard`. */
export interface Dashboard {
  coolantTempF: number;
  fuelTempF: number;
  engineRpm: number;
  rpmLimit: number;
  targetIdleRpm: number;
  roadSpeedMph: number;
  throttleAbsolute: number;
  throttleCorrected: number;
  gear: Gear;
  mafDirect: number;
  mafLinearised: number;
  idleBypassPosition: number;
  injectorPulseWidthUs: number;
  lambdaTrimShortOdd: number;
  lambdaTrimShortEven: number;
  lambdaTrimLongOdd: number;
  lambdaTrimLongEven: number;
  coTrimVoltage: number;
  fuelPumpRelayOn: boolean;
  milOn: boolean;
  idleMode: boolean;
  purgeValve: PurgeValveState;
  screenHeaterOn: boolean;
  acCompressorOn: boolean;
  currentFuelMap: number;
  fuelMapRow: { index: number; weighting: number };
  fuelMapColumn: { index: number; weighting: number };
}

/** RAM contents and the dashboard they should produce. */
export interface EngineState {
  /** Short name used in test titles. */
  name: string;
  /** Bytes to plant: `[address, bytes]`, multi-byte values big-endian. */
  memory: ReadonlyArray<readonly [number, readonly number[]]>;
  /** What the dashboard should show. */
  expected: Dashboard;
}

// Shared by every state: an RPM limit of 7500 (pulse width 1000).
const RPM_LIMIT: readonly [number, readonly number[]] = [0x200c, [0x03, 0xe8]];

/** Ignition on, engine not started, on a cold morning. */
export const keyOnEngineOff: EngineState = {
  name: 'key on, engine off',
  memory: [
    [0x0002, [0x40]], // port 1: pump relay off (bit 6 set), MIL on (bit 0 clear)
    [0x0042, [0x80, 0x00]], // long-term trim, odd
    [0x0046, [0x80, 0x00]], // long-term trim, even; also the CO trim input
    [0x0051, [0x00, 0x38]], // throttle minimum (stored as a word)
    [0x0057, [0x00, 0x10]], // MAF direct
    [0x005b, [0x00]], // fuel map row index
    [0x005c, [0x00]], // fuel map column index
    [0x005f, [0x00, 0x40]], // throttle
    [0x0065, [0x80, 0x00]], // short-term trim, odd
    [0x0067, [0x80, 0x00]], // short-term trim, even
    [0x006a, [0xa8]], // coolant ADC
    [0x006d, [0x5a]], // idle bypass motor
    [0x007c, [0xff, 0xff]], // engine speed: no pulses
    [0x0082, [0x00, 0x00]], // injector pulse width
    [0x008a, [0x08]], // A/C compressor off (bit 3 set)
    [0x0096, [0x00, 0x00]], // purge valve
    [0x00dd, [0x04]], // screen heater off (bit 2 set)
    [0x2000, [0x20]], // gear selector: park
    [0x2003, [0x00]], // road speed, km/h
    [0x2006, [0xa8]], // fuel temperature ADC
    RPM_LIMIT,
    [0x202c, [0x05]], // fuel map in use
    [0x2047, [0x00]], // idle mode off
    [0x204d, [0x00, 0x00]], // MAF linearised
    [0x2051, [0x03, 0x84]], // target idle: 900 rpm
  ],
  expected: {
    coolantTempF: 50,
    fuelTempF: 50,
    engineRpm: 0,
    rpmLimit: 7500,
    targetIdleRpm: 900,
    roadSpeedMph: 0,
    throttleAbsolute: 64 / 1023,
    throttleCorrected: (64 - 56) / (1023 - 56),
    gear: Gear.ParkOrNeutral,
    mafDirect: 16 / 1023,
    mafLinearised: 0,
    idleBypassPosition: 0.5,
    injectorPulseWidthUs: 0,
    lambdaTrimShortOdd: 0,
    lambdaTrimShortEven: 0,
    lambdaTrimLongOdd: 0,
    lambdaTrimLongEven: 0,
    coTrimVoltage: 1.25,
    fuelPumpRelayOn: false,
    milOn: true,
    idleMode: false,
    purgeValve: PurgeValveState.Closed,
    screenHeaterOn: false,
    acCompressorOn: false,
    currentFuelMap: 5,
    fuelMapRow: { index: 0, weighting: 0 },
    fuelMapColumn: { index: 0, weighting: 0 },
  },
};

/** Warm engine idling in park, closed-loop trims working. */
export const warmIdle: EngineState = {
  name: 'warm idle',
  memory: [
    [0x0002, [0x01]], // pump relay on, MIL off
    [0x0042, [0x83, 0x00]], // 0x106 → +6
    [0x0046, [0x7d, 0x00]], // 0xFA → −6; CO trim 5 × 250 / 1024 V
    [0x0051, [0x00, 0x38]],
    [0x0057, [0x00, 0x50]],
    [0x005b, [0x13]], // row 1, weighting 3
    [0x005c, [0x2a]], // column 2, weighting 10
    [0x005f, [0x00, 0x38]], // throttle closed: at its minimum
    [0x0065, [0x8a, 0x00]], // 0x114 → +20
    [0x0067, [0x76, 0x00]], // 0xEC → −20
    [0x006a, [0x22]], // 190 °F
    [0x006d, [0x78]], // 120 of 180
    [0x007c, [0x27, 0x10]], // 10000 → 750 rpm
    [0x0082, [0x09, 0xc4]], // 2500 µs
    [0x008a, [0x00]], // A/C compressor on
    [0x0096, [0x13, 0x88]], // 5000: toggling
    [0x00dd, [0x04]],
    [0x2000, [0x20]],
    [0x2003, [0x00]],
    [0x2006, [0x89]], // 75 °F
    RPM_LIMIT,
    [0x202c, [0x05]],
    [0x2047, [0x01]], // idle mode on
    [0x204d, [0x0b, 0xb8]], // 3000
    [0x2051, [0x02, 0xee]], // 750 rpm
  ],
  expected: {
    coolantTempF: 190,
    fuelTempF: 75,
    engineRpm: 750,
    rpmLimit: 7500,
    targetIdleRpm: 750,
    roadSpeedMph: 0,
    throttleAbsolute: 56 / 1023,
    throttleCorrected: 0,
    gear: Gear.ParkOrNeutral,
    mafDirect: 80 / 1023,
    mafLinearised: 3000 / 17290,
    idleBypassPosition: 60 / 180,
    injectorPulseWidthUs: 2500,
    lambdaTrimShortOdd: 20,
    lambdaTrimShortEven: -20,
    lambdaTrimLongOdd: 6,
    lambdaTrimLongEven: -6,
    coTrimVoltage: (5 * 250) / 1024,
    fuelPumpRelayOn: true,
    milOn: false,
    idleMode: true,
    purgeValve: PurgeValveState.Toggling,
    screenHeaterOn: false,
    acCompressorOn: true,
    currentFuelMap: 5,
    fuelMapRow: { index: 1, weighting: 3 },
    fuelMapColumn: { index: 2, weighting: 10 },
  },
};

/** Driving at 100 km/h in drive with the screen heater on. */
export const cruising: EngineState = {
  name: 'cruising',
  memory: [
    [0x0002, [0x01]],
    [0x0042, [0x80, 0x00]],
    [0x0046, [0x80, 0x00]],
    [0x0051, [0x00, 0x38]],
    [0x0057, [0x02, 0x00]], // 512
    [0x005b, [0x58]], // row 5, weighting 8
    [0x005c, [0x9f]], // column 9, weighting 15
    [0x005f, [0x01, 0x20]], // 288
    [0x0065, [0x80, 0x00]],
    [0x0067, [0x80, 0x00]],
    [0x006a, [0x20]], // 194 °F
    [0x006d, [0xb4]], // 180: fully closed
    [0x007c, [0x0b, 0xb8]], // 3000 → 2500 rpm
    [0x0082, [0x0f, 0xa0]], // 4000 µs
    [0x008a, [0x08]],
    [0x0096, [0x75, 0x30]], // 30000: open
    [0x00dd, [0x00]], // screen heater on
    [0x2000, [0xc0]], // drive
    [0x2003, [0x64]], // 100 km/h
    [0x2006, [0x6f]], // 95 °F
    RPM_LIMIT,
    [0x202c, [0x05]],
    [0x2047, [0x00]],
    [0x204d, [0x27, 0x10]], // 10000
    [0x2051, [0x02, 0xee]],
  ],
  expected: {
    coolantTempF: 194,
    fuelTempF: 95,
    engineRpm: 2500,
    rpmLimit: 7500,
    targetIdleRpm: 750,
    roadSpeedMph: 62,
    throttleAbsolute: 288 / 1023,
    throttleCorrected: (288 - 56) / (1023 - 56),
    gear: Gear.DriveOrReverse,
    mafDirect: 512 / 1023,
    mafLinearised: 10000 / 17290,
    idleBypassPosition: 0,
    injectorPulseWidthUs: 4000,
    lambdaTrimShortOdd: 0,
    lambdaTrimShortEven: 0,
    lambdaTrimLongOdd: 0,
    lambdaTrimLongEven: 0,
    coTrimVoltage: 1.25,
    fuelPumpRelayOn: true,
    milOn: false,
    idleMode: false,
    purgeValve: PurgeValveState.Open,
    screenHeaterOn: true,
    acCompressorOn: false,
    currentFuelMap: 5,
    fuelMapRow: { index: 5, weighting: 8 },
    fuelMapColumn: { index: 9, weighting: 15 },
  },
};

/** Every engine state, for `describe.each`. */
export const allEngineStates: readonly EngineState[] = [
  keyOnEngineOff,
  warmIdle,
  cruising,
];
