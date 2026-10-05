// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { be16 } from './bytes.js';
import {
  AirflowType,
  Bank,
  DataOffsetRev,
  DataSize,
  DEFAULT_READ_TIMEOUT_MS,
  FUEL_MAP_COLUMNS,
  MemoryOffset,
  RevAMainVoltageFactor,
  ThrottlePosType,
  type Gear,
  type PurgeValveState,
} from './constants.js';
import {
  decodeAcCompressor,
  decodeFuelPumpRelay,
  decodeIdleMode,
  decodeMilOn,
  decodePurgeValveState,
  decodeScreenHeater,
} from './decoders/flags.js';
import { decodeEngineRpm, pulseWidthToRpm } from './decoders/engineSpeed.js';
import { decodeGear } from './decoders/gear.js';
import { decodeIdleBypassPosition } from './decoders/idleBypass.js';
import { decodeMafDirect, decodeMafLinear } from './decoders/airflow.js';
import { decodeMainVoltage } from './decoders/mainVoltage.js';
import { decodeRoadSpeedMph } from './decoders/roadSpeed.js';
import { decodeTemperatureF } from './decoders/temperature.js';
import {
  decodeThrottlePosition,
  assertThrottleReading,
} from './decoders/throttle.js';
import {
  decodeCoTrimVoltage,
  decodeLambdaTrim,
} from './decoders/lambdaTrim.js';
import {
  FAULT_CODE_BLOCK_SIZE,
  decodeFaultCodes,
  type FaultCodes,
} from './decoders/faultCodes.js';
import {
  decodeCurrentFuelMap,
  decodeFuelMapColumnIndex,
  decodeFuelMapRowIndex,
  assertFuelMapId,
  fuelMapLocation,
  type KnownDataOffsetRev,
  rpmTableEntryAddress,
  rpmTableSlot,
  type FuelMapIndex,
} from './decoders/fuelMap.js';
import { classifyOldRevision, isRevC } from './decoders/romRevision.js';
import {
  decodeTuneRevision,
  type TuneRevision,
} from './decoders/tuneRevision.js';
import { InvalidReadingError, NotConnectedError } from './errors.js';
import { Protocol } from './protocol/protocol.js';
import { CommandQueue } from './queue.js';
import type { Transport } from './transport/types.js';
import { LIBRARY_VERSION, type Version } from './version.js';

export interface EcuOptions {
  /** Silence timeout for each read, in milliseconds. Defaults to 100. */
  readTimeoutMs?: number;
}

export interface FuelMap {
  /** 128 bytes: 8 rows x 16 columns. */
  data: Uint8Array;
  adjustmentFactor: number;
  rowScaler: number;
}

/**
 * Connection to a 14CUX ECU. Mirrors the public API of libcomm14cux:
 * each `c14cux_*` function is a method here, with its out-parameters
 * returned as values and its `false` result thrown as an error.
 *
 * Every public operation is queued, so calls may be made concurrently.
 * `cancelRead()` is the exception: it acts immediately.
 */
export class Ecu {
  readonly #transport: Transport;
  readonly #protocol: Protocol;
  readonly #queue = new CommandQueue();
  #connected = false;
  #promRev: KnownDataOffsetRev | undefined = undefined;
  #voltageFactorA = 0;
  #voltageFactorB = 0;
  #voltageFactorC = 0;

  constructor(transport: Transport, options: EcuOptions = {}) {
    this.#transport = transport;
    this.#protocol = new Protocol(
      transport,
      options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
    );
  }

  /** `c14cux_getLibraryVersion` */
  static getLibraryVersion(): Version {
    return { ...LIBRARY_VERSION };
  }

  // ---- connection ---------------------------------------------------------

  /** `c14cux_isConnected` */
  isConnected(): boolean {
    return this.#connected;
  }

  /** `c14cux_connect`. The baud rate is a property of the transport. */
  connect(): Promise<void> {
    return this.#queue.run(async () => {
      if (!this.#connected) {
        await this.#transport.open();
        this.#connected = true;
      }
    });
  }

  /** `c14cux_disconnect` */
  disconnect(): Promise<void> {
    return this.#queue.run(async () => {
      if (this.#connected) {
        await this.#transport.close();
        this.#connected = false;
        this.#protocol.resetCache();
        // A different ECU may be connected next time.
        this.#promRev = undefined;
        this.#voltageFactorA = 0;
        this.#voltageFactorB = 0;
        this.#voltageFactorC = 0;
      }
    });
  }

  /** `c14cux_cancelRead`: stops a multi-chunk read after the current chunk. */
  cancelRead(): void {
    this.#protocol.cancelRead();
  }

  // ---- raw access ---------------------------------------------------------

  /** `c14cux_readMem` */
  readMem(addr: number, length: number): Promise<Uint8Array> {
    return this.#run(() => this.#protocol.readMem(addr, length));
  }

  /** `c14cux_writeMem` */
  writeMem(addr: number, value: number): Promise<void> {
    return this.#run(() => this.#protocol.writeMem(addr, value));
  }

  /** `c14cux_dumpROM`: the 16 KiB firmware image. */
  dumpROM(): Promise<Uint8Array> {
    return this.readMem(MemoryOffset.ROMAddress, DataSize.ROM);
  }

  // ---- simple readings ----------------------------------------------------

  /** `c14cux_getRoadSpeed`: miles per hour. */
  getRoadSpeed(): Promise<number> {
    return this.#run(async () =>
      decodeRoadSpeedMph(await this.#byte(MemoryOffset.RoadSpeed)),
    );
  }

  /** `c14cux_getCoolantTemp`: degrees Fahrenheit. */
  getCoolantTemp(): Promise<number> {
    return this.#run(async () =>
      decodeTemperatureF(await this.#byte(MemoryOffset.CoolantTemp)),
    );
  }

  /** `c14cux_getFuelTemp`: degrees Fahrenheit. */
  getFuelTemp(): Promise<number> {
    return this.#run(async () =>
      decodeTemperatureF(await this.#byte(MemoryOffset.FuelTemp)),
    );
  }

  /** `c14cux_getMAFReading`: fraction (0..1) of the highest measurement. */
  getMAFReading(type: AirflowType): Promise<number> {
    return this.#run(async () =>
      type === AirflowType.Direct
        ? decodeMafDirect(await this.#word(MemoryOffset.MassAirflowDirect))
        : decodeMafLinear(await this.#word(MemoryOffset.MassAirflowLinear)),
    );
  }

  /** `c14cux_getEngineRPM` */
  getEngineRPM(): Promise<number> {
    return this.#run(async () =>
      decodeEngineRpm(await this.#word(MemoryOffset.EngineSpeedFiltered)),
    );
  }

  /** `c14cux_getRPMLimit` */
  getRPMLimit(): Promise<number> {
    return this.#run(async () =>
      pulseWidthToRpm(await this.#word(MemoryOffset.RPMLimit)),
    );
  }

  /** `c14cux_getTargetIdle`: RPM. */
  getTargetIdle(): Promise<number> {
    return this.#run(() => this.#word(MemoryOffset.TargetIdleSpeed));
  }

  /** `c14cux_getThrottlePosition`: fraction (0..1) of wide-open. */
  getThrottlePosition(type: ThrottlePosType): Promise<number> {
    return this.#run(async () => {
      const raw = await this.#word(MemoryOffset.ThrottlePosition);

      assertThrottleReading(raw);

      const minimum =
        type === ThrottlePosType.Corrected
          ? await this.#word(MemoryOffset.ThrottleMinimumPosition)
          : 0;

      return decodeThrottlePosition(raw, minimum);
    });
  }

  /** `c14cux_getGearSelection` */
  getGearSelection(): Promise<Gear> {
    return this.#run(async () =>
      decodeGear(await this.#byte(MemoryOffset.TransmissionGear)),
    );
  }

  /** `c14cux_getIdleBypassMotorPosition`: fraction (0..1) of wide-open. */
  getIdleBypassMotorPosition(): Promise<number> {
    return this.#run(async () =>
      decodeIdleBypassPosition(
        await this.#byte(MemoryOffset.IdleBypassPosition),
      ),
    );
  }

  /** `c14cux_getInjectorPulseWidth`: microseconds. */
  getInjectorPulseWidth(): Promise<number> {
    return this.#run(() => this.#word(MemoryOffset.InjectorPulseWidth));
  }

  // ---- fuel trims ---------------------------------------------------------

  /** `c14cux_getLambdaTrimShort`: counts from -256 to 255. */
  getLambdaTrimShort(bank: Bank): Promise<number> {
    return this.#run(async () =>
      decodeLambdaTrim(
        await this.#word(
          bank === Bank.Odd
            ? MemoryOffset.ShortTermLambdaFuelingTrimOdd
            : MemoryOffset.ShortTermLambdaFuelingTrimEven,
        ),
      ),
    );
  }

  /** `c14cux_getLambdaTrimLong`: counts from -256 to 255. */
  getLambdaTrimLong(bank: Bank): Promise<number> {
    return this.#run(async () =>
      decodeLambdaTrim(
        await this.#word(
          bank === Bank.Odd
            ? MemoryOffset.LongTermLambdaFuelingTrimOdd
            : MemoryOffset.LongTermLambdaFuelingTrimEven,
        ),
      ),
    );
  }

  /** `c14cux_getCOTrimVoltage` */
  getCOTrimVoltage(): Promise<number> {
    return this.#run(async () =>
      decodeCoTrimVoltage(
        await this.#word(MemoryOffset.LongTermLambdaFuelingTrimEven),
      ),
    );
  }

  // ---- main voltage -------------------------------------------------------

  /** `c14cux_getMainVoltage`: volts. */
  getMainVoltage(): Promise<number> {
    return this.#run(async () => {
      if (
        this.#voltageFactorA === 0 ||
        this.#voltageFactorB === 0 ||
        this.#voltageFactorC === 0
      ) {
        await this.#readVoltageCoefficients();
      }

      return decodeMainVoltage(
        await this.#word(MemoryOffset.MainVoltage),
        this.#voltageFactorA,
        this.#voltageFactorB,
        this.#voltageFactorC,
      );
    });
  }

  // ---- fuel maps ----------------------------------------------------------

  /** `c14cux_getFuelMap` for map ids 0..5. */
  getFuelMap(fuelMapId: number): Promise<FuelMap> {
    try {
      assertFuelMapId(fuelMapId);
    } catch (error) {
      return Promise.reject(error as Error);
    }

    return this.#run(async () => {
      const location = fuelMapLocation(
        fuelMapId,
        await this.#determineDataOffsets(),
      );

      const data = await this.#protocol.readMem(
        location.offset,
        DataSize.FuelMap,
      );
      const adjustmentFactor = await this.#word(
        location.offset + DataSize.FuelMap,
      );
      const rowScaler = await this.#byte(location.scalerOffset);

      return { data, adjustmentFactor, rowScaler };
    });
  }

  /** `c14cux_getCurrentFuelMap` */
  getCurrentFuelMap(): Promise<number> {
    return this.#run(async () =>
      decodeCurrentFuelMap(await this.#byte(MemoryOffset.CurrentFuelMapId)),
    );
  }

  /** `c14cux_getFuelMapRowIndex` */
  getFuelMapRowIndex(): Promise<FuelMapIndex> {
    return this.#run(async () =>
      decodeFuelMapRowIndex(await this.#byte(MemoryOffset.FuelMapRowIndex)),
    );
  }

  /** `c14cux_getFuelMapColumnIndex` */
  getFuelMapColumnIndex(): Promise<FuelMapIndex> {
    return this.#run(async () =>
      decodeFuelMapColumnIndex(
        await this.#byte(MemoryOffset.FuelMapColumnIndex),
      ),
    );
  }

  /** `c14cux_getRpmTable`: the RPM threshold of each fuel map column. */
  getRpmTable(): Promise<number[]> {
    return this.#run(async () => {
      const table: number[] = new Array<number>(FUEL_MAP_COLUMNS).fill(0);

      for (let column = 0; column < FUEL_MAP_COLUMNS; column++) {
        table[rpmTableSlot(column)] = pulseWidthToRpm(
          await this.#word(rpmTableEntryAddress(column)),
        );
      }

      return table;
    });
  }

  // ---- faults and state ---------------------------------------------------

  /** `c14cux_getFaultCodes` */
  getFaultCodes(): Promise<FaultCodes> {
    return this.#run(async () =>
      decodeFaultCodes(
        await this.#protocol.readMem(
          MemoryOffset.FaultCodes,
          FAULT_CODE_BLOCK_SIZE,
        ),
      ),
    );
  }

  /** `c14cux_clearFaultCodes` */
  clearFaultCodes(): Promise<void> {
    return this.#run(async () => {
      for (let i = 0; i < FAULT_CODE_BLOCK_SIZE; i++) {
        await this.#protocol.writeMem(MemoryOffset.FaultCodes + i, 0x00);
      }
    });
  }

  /** `c14cux_getFuelPumpRelayState`: true when the relay is closed. */
  getFuelPumpRelayState(): Promise<boolean> {
    return this.#run(async () =>
      decodeFuelPumpRelay(await this.#byte(MemoryOffset.Port1)),
    );
  }

  /** `c14cux_isMILOn` */
  isMILOn(): Promise<boolean> {
    return this.#run(async () =>
      decodeMilOn(await this.#byte(MemoryOffset.Port1)),
    );
  }

  /** `c14cux_getIdleMode` */
  getIdleMode(): Promise<boolean> {
    return this.#run(async () =>
      decodeIdleMode(await this.#byte(MemoryOffset.IdleMode)),
    );
  }

  /** `c14cux_getPurgeValveState` */
  getPurgeValveState(): Promise<PurgeValveState> {
    return this.#run(async () =>
      decodePurgeValveState(await this.#word(MemoryOffset.PurgeValveState)),
    );
  }

  /** `c14cux_getScreenHeaterState` */
  getScreenHeaterState(): Promise<boolean> {
    return this.#run(async () =>
      decodeScreenHeater(await this.#byte(MemoryOffset.Bits00DD)),
    );
  }

  /** `c14cux_getACCompressorState` */
  getACCompressorState(): Promise<boolean> {
    return this.#run(async () =>
      decodeAcCompressor(await this.#byte(MemoryOffset.Bits008A)),
    );
  }

  /** `c14cux_getTuneRevision` */
  getTuneRevision(): Promise<TuneRevision> {
    return this.#run(async () =>
      decodeTuneRevision(
        await this.#protocol.readMem(MemoryOffset.TuneRevision, 5),
      ),
    );
  }

  // ---- actuators ----------------------------------------------------------

  /**
   * `c14cux_runFuelPump`: closes the fuel pump relay for one timeout period
   * (about two seconds).
   */
  runFuelPump(): Promise<void> {
    return this.#run(async () => {
      const port1 = await this.#byte(MemoryOffset.Port1);

      await this.#protocol.writeMem(MemoryOffset.FuelPumpTimer, 0xff);
      await this.#protocol.writeMem(MemoryOffset.Port1, port1 & 0xbf);
    });
  }

  /**
   * `c14cux_driveIdleAirControlMotor`: direction 0 opens the valve and any
   * other value closes it.
   */
  driveIdleAirControlMotor(direction: number, steps: number): Promise<void> {
    return this.#run(async () => {
      const bits = await this.#byte(MemoryOffset.Bits008A);

      await this.#protocol.writeMem(
        MemoryOffset.Bits008A,
        direction === 0 ? bits & 0xfe : bits | 0x01,
      );
      await this.#protocol.writeMem(
        MemoryOffset.IdleAirControlStepCount,
        steps,
      );
    });
  }

  // ---- internals ----------------------------------------------------------

  #run<T>(task: () => Promise<T>): Promise<T> {
    return this.#queue.run(() => {
      if (!this.#connected) {
        return Promise.reject(new NotConnectedError('Not connected to ECU'));
      }

      return task();
    });
  }

  async #byte(addr: number): Promise<number> {
    return (await this.#protocol.readMem(addr, 1))[0] ?? 0;
  }

  async #word(addr: number): Promise<number> {
    return be16(await this.#protocol.readMem(addr, 2));
  }

  /** `c14cux_determineDataOffsets` */
  async #determineDataOffsets(): Promise<KnownDataOffsetRev> {
    if (this.#promRev !== undefined) {
      return this.#promRev;
    }

    const firstRow = await this.#protocol.readMem(
      MemoryOffset.OldFuelMap1,
      FUEL_MAP_COLUMNS,
    );

    // Very old units (about 1990 and earlier) hardcode some main-voltage
    // factors, so check for that as well.
    this.#promRev = isRevC(firstRow)
      ? DataOffsetRev.RevC
      : classifyOldRevision(
          await this.#byte(MemoryOffset.RevBMainVoltageFactorA),
        );

    return this.#promRev;
  }

  async #readVoltageCoefficients(): Promise<void> {
    const rev = await this.#determineDataOffsets();

    let a: number;
    let b: number;
    let c: number;

    if (rev === DataOffsetRev.RevA) {
      ({ A: a, B: b, C: c } = RevAMainVoltageFactor);
    } else {
      const revC = rev === DataOffsetRev.RevC;

      a = await this.#byte(
        revC
          ? MemoryOffset.RevCMainVoltageFactorA
          : MemoryOffset.RevBMainVoltageFactorA,
      );
      b = await this.#byte(
        revC
          ? MemoryOffset.RevCMainVoltageFactorB
          : MemoryOffset.RevBMainVoltageFactorB,
      );
      c = await this.#word(
        revC
          ? MemoryOffset.RevCMainVoltageFactorC
          : MemoryOffset.RevBMainVoltageFactorC,
      );
    }

    if (a === 0 || b === 0 || c === 0) {
      throw new InvalidReadingError('ECU reports zero main-voltage factors');
    }

    this.#voltageFactorA = a;
    this.#voltageFactorB = b;
    this.#voltageFactorC = c;
  }
}
