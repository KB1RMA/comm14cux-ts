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

/**
 * Options for {@link Ecu}.
 */
export interface EcuOptions {
  /**
   * Silence timeout for each read, in milliseconds. Defaults to 100, as in
   * libcomm14cux.
   */
  readTimeoutMs?: number;
}

/**
 * A fuel map read from the ECU.
 */
export interface FuelMap {
  /**
   * The map: 128 bytes, 8 rows by 16 columns.
   */
  data: Uint8Array;
  /**
   * The adjustment factor stored after the map data.
   */
  adjustmentFactor: number;
  /**
   * The value used to scale map values by row position.
   */
  rowScaler: number;
}

/**
 * Connection to a 14CUX ECU. Mirrors the public API of libcomm14cux: each
 * `c14cux_*` function is a method here, with its out-parameters returned as
 * values and its `false` result thrown as an error.
 *
 * Every public operation is queued, so calls may be made concurrently.
 * {@link Ecu.cancelRead} is the exception: it acts immediately.
 *
 * Unless a method says otherwise, it rejects with:
 * - {@link NotConnectedError} if {@link Ecu.connect} has not been called;
 * - {@link TimeoutError} if the ECU stops responding;
 * - {@link ProtocolError} if the ECU echoes a command byte incorrectly.
 *
 * All of these extend {@link Comm14cuxError}.
 *
 * @example
 * ```ts
 * const ecu = new Ecu(new WebSerialTransport(port));
 *
 * await ecu.connect();
 * console.log(await ecu.getEngineRPM());
 * await ecu.disconnect();
 * ```
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

  /**
   * Creates a connection object. Nothing is sent until {@link Ecu.connect}.
   *
   * @param transport - The byte-level link to the ECU, for example a
   * {@link WebSerialTransport} or a {@link SimulatedTransport}.
   * @param options - Optional settings.
   */
  constructor(transport: Transport, options: EcuOptions = {}) {
    this.#transport = transport;
    this.#protocol = new Protocol(
      transport,
      options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
    );
  }

  /**
   * Returns the version of this library (`c14cux_getLibraryVersion`).
   *
   * @returns The major, minor and patch version numbers.
   */
  static getLibraryVersion(): Version {
    return { ...LIBRARY_VERSION };
  }

  // ---- connection ---------------------------------------------------------

  /**
   * Reports whether the transport is open (`c14cux_isConnected`).
   *
   * @returns `true` after a successful {@link Ecu.connect} and before {@link Ecu.disconnect}.
   */
  isConnected(): boolean {
    return this.#connected;
  }

  /**
   * Opens the transport (`c14cux_connect`). Does nothing if already connected.
   *
   * Unlike the C function this takes no device path or baud rate; those
   * belong to the {@link Transport}.
   *
   * @returns A promise that resolves when the operation is complete.
   * @throws Whatever the transport's `open()` rejects with, for example if the serial port is busy.
   */
  connect(): Promise<void> {
    return this.#queue.run(async () => {
      if (!this.#connected) {
        await this.#transport.open();
        this.#connected = true;
      }
    });
  }

  /**
   * Closes the transport (`c14cux_disconnect`) and forgets cached ROM details. Does nothing if not connected.
   *
   * Waits for any operation in progress to finish first.
   *
   * @returns A promise that resolves when the operation is complete.
   * @throws Whatever the transport's `close()` rejects with.
   */
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

  /**
   * Stops a multi-chunk read after the chunk currently in flight (`c14cux_cancelRead`).
   *
   * Unlike every other method this acts immediately instead of waiting in the
   * queue. The cancelled read rejects with {@link ReadCancelledError}.
   */
  cancelRead(): void {
    this.#protocol.cancelRead();
  }

  // ---- raw access ---------------------------------------------------------

  /**
   * Reads a block of ECU memory (`c14cux_readMem`).
   *
   * Reads longer than the ECU can return in one command are split into
   * chunks automatically.
   *
   * @param addr - First address to read, 0 to 0xFFFF.
   * @param length - Number of bytes to read. `addr + length` must not exceed 0x10000.
   * @returns The bytes read, `length` long.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link RangeError} if the address or length is out of range.
   * @throws {@link ReadCancelledError} if {@link Ecu.cancelRead} was called during the read.
   */
  readMem(addr: number, length: number): Promise<Uint8Array> {
    return this.#run(() => this.#protocol.readMem(addr, length));
  }

  /**
   * Writes one byte to ECU memory (`c14cux_writeMem`).
   *
   * Writing to ECU memory can affect a running engine; use with care.
   *
   * @param addr - Address to write, 0 to 0xFFFF.
   * @param value - Byte to write, 0 to 255.
   * @returns A promise that resolves when the operation is complete.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link RangeError} if the address or value is out of range.
   */
  writeMem(addr: number, value: number): Promise<void> {
    return this.#run(() => this.#protocol.writeMem(addr, value));
  }

  /**
   * Reads the entire 16 KiB firmware image from 0xC000 (`c14cux_dumpROM`).
   *
   * This takes several seconds; use {@link Ecu.cancelRead} to stop it.
   *
   * @returns The 0x4000 bytes of ROM.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link ReadCancelledError} if {@link Ecu.cancelRead} was called during the read.
   */
  dumpROM(): Promise<Uint8Array> {
    return this.readMem(MemoryOffset.ROMAddress, DataSize.ROM);
  }

  // ---- simple readings ----------------------------------------------------

  /**
   * Reads the vehicle road speed (`c14cux_getRoadSpeed`).
   *
   * @returns Road speed in whole miles per hour (the ECU reports km/h; the value is converted and truncated).
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getRoadSpeed(): Promise<number> {
    return this.#run(async () =>
      decodeRoadSpeedMph(await this.#byte(MemoryOffset.RoadSpeed)),
    );
  }

  /**
   * Reads the engine coolant temperature (`c14cux_getCoolantTemp`).
   *
   * @returns Temperature in degrees Fahrenheit.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getCoolantTemp(): Promise<number> {
    return this.#run(async () =>
      decodeTemperatureF(await this.#byte(MemoryOffset.CoolantTemp)),
    );
  }

  /**
   * Reads the fuel temperature (`c14cux_getFuelTemp`).
   *
   * @returns Temperature in degrees Fahrenheit.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getFuelTemp(): Promise<number> {
    return this.#run(async () =>
      decodeTemperatureF(await this.#byte(MemoryOffset.FuelTemp)),
    );
  }

  /**
   * Reads the mass airflow meter (`c14cux_getMAFReading`).
   *
   * @param type - {@link AirflowType.Direct} changes linearly with sensor voltage but logarithmically with airflow; {@link AirflowType.Linearized} changes linearly with airflow.
   * @returns Airflow as a fraction from 0 to 1 of the highest possible measurement.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link InvalidReadingError} if the ECU returns a value outside the range its firmware can produce.
   */
  getMAFReading(type: AirflowType): Promise<number> {
    return this.#run(async () =>
      type === AirflowType.Direct
        ? decodeMafDirect(await this.#word(MemoryOffset.MassAirflowDirect))
        : decodeMafLinear(await this.#word(MemoryOffset.MassAirflowLinear)),
    );
  }

  /**
   * Reads the engine speed (`c14cux_getEngineRPM`).
   *
   * @returns Engine speed in revolutions per minute; 0 when the ignition is on but the engine is not running.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link InvalidReadingError} if the ECU returns a value outside the range its firmware can produce. (a zero pulse width)
   */
  getEngineRPM(): Promise<number> {
    return this.#run(async () =>
      decodeEngineRpm(await this.#word(MemoryOffset.EngineSpeedFiltered)),
    );
  }

  /**
   * Reads the rev limit (`c14cux_getRPMLimit`).
   *
   * @returns The RPM limit in revolutions per minute.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link InvalidReadingError} if the ECU returns a value outside the range its firmware can produce. (a zero pulse width)
   */
  getRPMLimit(): Promise<number> {
    return this.#run(async () =>
      pulseWidthToRpm(await this.#word(MemoryOffset.RPMLimit)),
    );
  }

  /**
   * Reads the current target idle speed (`c14cux_getTargetIdle`).
   *
   * @returns Target idle speed in revolutions per minute.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getTargetIdle(): Promise<number> {
    return this.#run(() => this.#word(MemoryOffset.TargetIdleSpeed));
  }

  /**
   * Reads the throttle position (`c14cux_getThrottlePosition`).
   *
   * @param type - {@link ThrottlePosType.Absolute} is a simple fraction of the maximum ADC reading; {@link ThrottlePosType.Corrected} is adjusted so the lowest value the ECU has seen reads as 0.
   * @returns Throttle position as a fraction from 0 (closed) to 1 (wide open).
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link InvalidReadingError} if the ECU returns a value outside the range its firmware can produce.
   */
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

  /**
   * Reads the transmission gear selection (`c14cux_getGearSelection`).
   *
   * @returns Park/neutral, drive/reverse, or manual gearbox (which does not report a gear).
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getGearSelection(): Promise<Gear> {
    return this.#run(async () =>
      decodeGear(await this.#byte(MemoryOffset.TransmissionGear)),
    );
  }

  /**
   * Reads the idle bypass (idle air control) motor position (`c14cux_getIdleBypassMotorPosition`).
   *
   * @returns Position as a fraction from 0 (closed) to 1 (widest opening).
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getIdleBypassMotorPosition(): Promise<number> {
    return this.#run(async () =>
      decodeIdleBypassPosition(
        await this.#byte(MemoryOffset.IdleBypassPosition),
      ),
    );
  }

  /**
   * Reads the injector pulse width (`c14cux_getInjectorPulseWidth`).
   *
   * The ECU uses one location for both banks, and which bank it describes at
   * the moment of the read is nondeterministic. It is most useful in open-loop
   * mode, where both banks match.
   *
   * @returns Pulse width in microseconds.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getInjectorPulseWidth(): Promise<number> {
    return this.#run(() => this.#word(MemoryOffset.InjectorPulseWidth));
  }

  // ---- fuel trims ---------------------------------------------------------

  /**
   * Reads the short-term lambda fueling trim (`c14cux_getLambdaTrimShort`). A larger number means more fuel.
   *
   * @param bank - Which engine bank to read.
   * @returns Trim in counts, from -256 to 255.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
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

  /**
   * Reads the long-term lambda fueling trim (`c14cux_getLambdaTrimLong`). A larger number means more fuel.
   *
   * @param bank - Which engine bank to read.
   * @returns Trim in counts, from -256 to 255.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
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

  /**
   * Reads the MAF CO trim voltage (`c14cux_getCOTrimVoltage`).
   *
   * @returns Voltage in volts.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getCOTrimVoltage(): Promise<number> {
    return this.#run(async () =>
      decodeCoTrimVoltage(
        await this.#word(MemoryOffset.LongTermLambdaFuelingTrimEven),
      ),
    );
  }

  // ---- main voltage -------------------------------------------------------

  /**
   * Reads the voltage supplied to the ECU (`c14cux_getMainVoltage`).
   *
   * The first call also reads the ECU's ROM to find the coefficients needed to
   * reverse its ADC computation; they are cached until {@link Ecu.disconnect}.
   *
   * @returns Main relay voltage in volts.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link InvalidReadingError} if the ECU returns a value outside the range its firmware can produce. (coefficients of zero, or a reading that does not fit them)
   */
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

  /**
   * Reads a fuel map (`c14cux_getFuelMap`).
   *
   * The first call also detects the ROM's data layout, which determines where
   * maps 1 to 5 are stored.
   *
   * @param fuelMapId - Map to read, 0 to 5.
   * @returns The 128 bytes of map data (8 rows by 16 columns), the adjustment factor stored after it, and the row scaler.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link RangeError} if `fuelMapId` is not 0 to 5 (no I/O is performed).
   */
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

  /**
   * Reads which fuel map is in use (`c14cux_getCurrentFuelMap`).
   *
   * Selected by a tune resistor in the harness on non-NAS Land Rovers;
   * unmodified NAS vehicles are locked to map 5.
   *
   * @returns The map id, 0 to 5.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link InvalidReadingError} if the ECU returns a value outside the range its firmware can produce.
   */
  getCurrentFuelMap(): Promise<number> {
    return this.#run(async () =>
      decodeCurrentFuelMap(await this.#byte(MemoryOffset.CurrentFuelMapId)),
    );
  }

  /**
   * Reads the current fuel map row index (`c14cux_getFuelMapRowIndex`).
   *
   * @returns The row index (0 to 7) and the row weighting.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link InvalidReadingError} if the ECU returns a value outside the range its firmware can produce.
   */
  getFuelMapRowIndex(): Promise<FuelMapIndex> {
    return this.#run(async () =>
      decodeFuelMapRowIndex(await this.#byte(MemoryOffset.FuelMapRowIndex)),
    );
  }

  /**
   * Reads the current fuel map column index (`c14cux_getFuelMapColumnIndex`).
   *
   * @returns The column index (0 to 15) and the column weighting.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link InvalidReadingError} if the ECU returns a value outside the range its firmware can produce.
   */
  getFuelMapColumnIndex(): Promise<FuelMapIndex> {
    return this.#run(async () =>
      decodeFuelMapColumnIndex(
        await this.#byte(MemoryOffset.FuelMapColumnIndex),
      ),
    );
  }

  /**
   * Reads the table of RPM thresholds that divides engine speed into the sixteen fuel map columns (`c14cux_getRpmTable`).
   *
   * @returns Sixteen RPM values, indexed as in the C library (column 0 is last).
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link InvalidReadingError} if the ECU returns a value outside the range its firmware can produce. (a zero pulse width)
   */
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

  /**
   * Reads the stored fault codes (`c14cux_getFaultCodes`).
   *
   * @returns A flag for each fault; `true` means the fault is set.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
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

  /**
   * Clears the stored fault codes by writing zero to each byte of the fault block (`c14cux_clearFaultCodes`).
   *
   * Stops at the first failed write, so the codes may be partly cleared.
   *
   * @returns A promise that resolves when the operation is complete.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  clearFaultCodes(): Promise<void> {
    return this.#run(async () => {
      for (let i = 0; i < FAULT_CODE_BLOCK_SIZE; i++) {
        await this.#protocol.writeMem(MemoryOffset.FaultCodes + i, 0x00);
      }
    });
  }

  /**
   * Reads the state of the line driving the fuel pump relay (`c14cux_getFuelPumpRelayState`).
   *
   * @returns `true` when the relay is closed (pump running).
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getFuelPumpRelayState(): Promise<boolean> {
    return this.#run(async () =>
      decodeFuelPumpRelay(await this.#byte(MemoryOffset.Port1)),
    );
  }

  /**
   * Reads the malfunction indicator lamp state (`c14cux_isMILOn`). A lit MIL implies at least one fault code, but not every fault lights it.
   *
   * @returns `true` when the MIL is lit.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  isMILOn(): Promise<boolean> {
    return this.#run(async () =>
      decodeMilOn(await this.#byte(MemoryOffset.Port1)),
    );
  }

  /**
   * Reads whether the ECU is driving an idle speed (`c14cux_getIdleMode`).
   *
   * @returns `true` in idle mode.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getIdleMode(): Promise<boolean> {
    return this.#run(async () =>
      decodeIdleMode(await this.#byte(MemoryOffset.IdleMode)),
    );
  }

  /**
   * Reads the state of the carbon canister purge valve (`c14cux_getPurgeValveState`).
   *
   * @returns Closed, toggling, or open.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getPurgeValveState(): Promise<PurgeValveState> {
    return this.#run(async () =>
      decodePurgeValveState(await this.#word(MemoryOffset.PurgeValveState)),
    );
  }

  /**
   * Reads the heated screen state (`c14cux_getScreenHeaterState`).
   *
   * @returns `true` when the screen heater is on.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getScreenHeaterState(): Promise<boolean> {
    return this.#run(async () =>
      decodeScreenHeater(await this.#byte(MemoryOffset.Bits00DD)),
    );
  }

  /**
   * Reads the A/C compressor load input (`c14cux_getACCompressorState`).
   *
   * @returns `true` when the compressor is on.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getACCompressorState(): Promise<boolean> {
    return this.#run(async () =>
      decodeAcCompressor(await this.#byte(MemoryOffset.Bits008A)),
    );
  }

  /**
   * Reads the tune identification from the ROM (`c14cux_getTuneRevision`).
   *
   * @returns The decimal tune number, checksum fixer byte and ident word.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  getTuneRevision(): Promise<TuneRevision> {
    return this.#run(async () =>
      decodeTuneRevision(
        await this.#protocol.readMem(MemoryOffset.TuneRevision, 5),
      ),
    );
  }

  // ---- actuators ----------------------------------------------------------

  /**
   * Closes the fuel pump relay for a single timeout period of about two seconds (`c14cux_runFuelPump`).
   *
   * Affects a running engine; use with care.
   *
   * @returns A promise that resolves when the operation is complete.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   */
  runFuelPump(): Promise<void> {
    return this.#run(async () => {
      const port1 = await this.#byte(MemoryOffset.Port1);

      await this.#protocol.writeMem(MemoryOffset.FuelPumpTimer, 0xff);
      await this.#protocol.writeMem(MemoryOffset.Port1, port1 & 0xbf);
    });
  }

  /**
   * Commands the idle air control motor to move (`c14cux_driveIdleAirControlMotor`).
   *
   * Unlike the C function this reports failure if any step fails. Affects a
   * running engine; use with care.
   *
   * @param direction - 0 opens the valve; any other value closes it.
   * @param steps - Number of steps to travel, 0 to 255.
   * @returns A promise that resolves when the operation is complete.
   * @throws {@link NotConnectedError} if the ECU is not connected.
   * @throws {@link TimeoutError} if the ECU stops responding.
   * @throws {@link ProtocolError} if the ECU echoes a command byte incorrectly.
   * @throws {@link RangeError} if `steps` is out of range.
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

  /**
   * Works out the ROM's data layout (`c14cux_determineDataOffsets`) and caches
   * it. Does nothing if already known.
   *
   * @returns The ROM's data layout.
   */
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
