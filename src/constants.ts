// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

/** Baud rate of the 14CUX serial port. */
export const BAUD = 7812;

/** Baud rate used by ECUs running modified double-speed firmware. */
export const BAUD_DOUBLE_SPEED = 15625;

/** Number of engine speed ranges in the fuel maps. */
export const FUEL_MAP_COLUMNS = 16;

/** Number of engine load ranges in the fuel maps. */
export const FUEL_MAP_ROWS = 8;

/** Byte quantities that may be requested in a single read (`c14cux_readcount`). */
export const ReadCount = {
  Count0: 0x0010,
  Count1: 0x0050,
  Count2: 0x0064,
  Count3: 0x0190,
  Count4: 0x0200,
} as const;

/** Length codes sent to the ECU for the fixed read quantities. */
export const ReadCountValue = {
  Count1: 0x10,
  Count2: 0x11,
  Count3: 0x12,
  Count4: 0x13,
} as const;

/** Sizes in bytes of fixed-size structures within the ROM. */
export const DataSize = {
  ROM: 0x4000,
  FuelMap: 0x80,
} as const;

/** Important memory offsets in the ECU's address space (`c14cux_memory_offset`). */
export const MemoryOffset = {
  ROMAddress: 0xc000,
  RPMTable: 0xc800,
  Port1: 0x0002,
  LongTermLambdaFuelingTrimOdd: 0x0042,
  LongTermLambdaFuelingTrimEven: 0x0046,
  ShortTermLambdaFuelingTrimOdd: 0x0065,
  ShortTermLambdaFuelingTrimEven: 0x0067,
  FaultCodes: 0x0049,
  ThrottleMinimumPosition: 0x0051,
  MainVoltage: 0x0055,
  MassAirflowDirect: 0x0057,
  ThrottlePosition: 0x005f,
  CoolantTemp: 0x006a,
  IdleBypassPosition: 0x006d,
  EngineSpeedInstantaneous: 0x007a,
  EngineSpeedFiltered: 0x007c,
  InjectorPulseWidth: 0x0082,
  Bits008A: 0x008a,
  PurgeValveState: 0x0096,
  Bits00DD: 0x00dd,
  TransmissionGear: 0x2000,
  RoadSpeed: 0x2003,
  FuelTemp: 0x2006,
  RowScaler: 0x200a,
  RPMLimit: 0x200c,
  IdleMode: 0x2047,
  MassAirflowLinear: 0x204d,
  TargetIdleSpeed: 0x2051,
  RevBMainVoltageFactorA: 0xc79b,
  RevBMainVoltageFactorB: 0xc79c,
  RevBMainVoltageFactorC: 0xc79d,
  RevCMainVoltageFactorA: 0xc7c3,
  RevCMainVoltageFactorB: 0xc7c4,
  RevCMainVoltageFactorC: 0xc7c5,
  MAFRowScaler: 0xc1c7,
  Map0RowScalerInitValue: 0xc1c9,
  FuelMap0: 0xc000,
  NewFuelMap1: 0xc267,
  NewFuelMap2: 0xc379,
  NewFuelMap3: 0xc48b,
  NewFuelMap4: 0xc59d,
  NewFuelMap5: 0xc6af,
  OldFuelMap1: 0xc23f,
  OldFuelMap2: 0xc351,
  OldFuelMap3: 0xc463,
  OldFuelMap4: 0xc575,
  OldFuelMap5: 0xc687,
  TuneRevision: 0xffe9,
  ChecksumFixer: 0xffeb,
  TuneIdent: 0xffec,
  CurrentFuelMapId: 0x202c,
  FuelMapRowIndex: 0x005b,
  FuelMapColumnIndex: 0x005c,
  IdleAirControlStepCount: 0x0075,
  FuelPumpTimer: 0x00af,
} as const;

/** Offset from the start of a fuel map to its row scaler. */
export const FUEL_MAP_ROW_SCALER_OFFSET = 0x10a;

/** Fixed main-voltage coefficients for very old ECUs (1990 and earlier). */
export const RevAMainVoltageFactor = {
  A: 0x64,
  B: 0xbd,
  C: 0x6180,
} as const;

/** Transmission gear selections. */
export const Gear = {
  NoReading: 0,
  ParkOrNeutral: 1,
  DriveOrReverse: 2,
  ManualGearbox: 3,
} as const;
/**
 * Union of the {@link Gear} values.
 */
export type Gear = (typeof Gear)[keyof typeof Gear];

/** The two engine banks. */
export const Bank = { Odd: 0, Even: 1 } as const;
/**
 * Union of the {@link Bank} values.
 */
export type Bank = (typeof Bank)[keyof typeof Bank];

/** Types of lambda trim for fueling. */
export const LambdaTrimType = { ShortTerm: 0, LongTerm: 1 } as const;
/**
 * Union of the {@link LambdaTrimType} values.
 */
export type LambdaTrimType =
  (typeof LambdaTrimType)[keyof typeof LambdaTrimType];

/** Fueling feedback modes. */
export const FeedbackMode = { ClosedLoop: 0, OpenLoop: 1 } as const;
/**
 * Union of the {@link FeedbackMode} values.
 */
export type FeedbackMode = (typeof FeedbackMode)[keyof typeof FeedbackMode];

/** The two means of reading a value from the MAF. */
export const AirflowType = { Direct: 0, Linearized: 1 } as const;
/**
 * Union of the {@link AirflowType} values.
 */
export type AirflowType = (typeof AirflowType)[keyof typeof AirflowType];

/** The two methods of interpreting a throttle position. */
export const ThrottlePosType = { Absolute: 0, Corrected: 1 } as const;
/**
 * Union of the {@link ThrottlePosType} values.
 */
export type ThrottlePosType =
  (typeof ThrottlePosType)[keyof typeof ThrottlePosType];

/** Revisions of the ROM data layout (`c14cux_data_offset_rev`). */
export const DataOffsetRev = { Unset: 0, RevA: 1, RevB: 2, RevC: 3 } as const;
/**
 * Union of the {@link DataOffsetRev} values.
 */
export type DataOffsetRev = (typeof DataOffsetRev)[keyof typeof DataOffsetRev];

/** States of the carbon canister purge valve. */
export const PurgeValveState = { Closed: 0, Toggling: 1, Open: 2 } as const;
/**
 * Union of the {@link PurgeValveState} values.
 */
export type PurgeValveState =
  (typeof PurgeValveState)[keyof typeof PurgeValveState];

/** Default per-read silence timeout, matching libcomm14cux (100 ms). */
export const DEFAULT_READ_TIMEOUT_MS = 100;

/**
 * Default quiet time after a failed command (500 ms). The ECU drops a
 * half-received command after 256 passes of its main loop with nothing
 * received; this is a conservative estimate of how long that takes.
 */
export const DEFAULT_COMMAND_RESET_MS = 500;
