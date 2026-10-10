// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// Journey: an application depends on the published package and expects the
// names and types it imports to stay put from one release to the next. Every
// list below is a literal so that an accidental rename, removal or new export
// has to be acknowledged here.
import * as api from '@kb1rma/libcomm14cux-ts';
import type {
  Bank,
  Ecu,
  EcuOptions,
  FaultCodeName,
  FaultCodes,
  FuelMap,
  FuelMapIndex,
  Gear,
  Transport,
  TuneRevision,
  Version,
  WebSerialTransportOptions,
} from '@kb1rma/libcomm14cux-ts';

const prototypeMethods = (ctor: abstract new (...args: never[]) => unknown) =>
  Object.getOwnPropertyNames(ctor.prototype)
    .filter((name) => name !== 'constructor')
    .sort();

describe('public API surface', () => {
  it('exports exactly the documented runtime names', () => {
    expect(Object.keys(api).sort()).toEqual([
      'AirflowType',
      'BAUD',
      'BAUD_DOUBLE_SPEED',
      'Bank',
      'Comm14cuxError',
      'DEFAULT_READ_TIMEOUT_MS',
      'DataOffsetRev',
      'DataSize',
      'Ecu',
      'FUEL_MAP_COLUMNS',
      'FUEL_MAP_ROWS',
      'FUEL_MAP_ROW_SCALER_OFFSET',
      'FeedbackMode',
      'Gear',
      'InvalidReadingError',
      'LambdaTrimType',
      'MemoryOffset',
      'NotConnectedError',
      'ProtocolError',
      'PurgeValveState',
      'ReadCancelledError',
      'ReadCount',
      'ReadCountValue',
      'RevAMainVoltageFactor',
      'SimulatedTransport',
      'ThrottlePosType',
      'TimeoutError',
      'WebSerialTransport',
    ]);
  });

  it('keeps every Ecu method', () => {
    expect(prototypeMethods(api.Ecu)).toEqual([
      'cancelRead',
      'clearFaultCodes',
      'connect',
      'disconnect',
      'driveIdleAirControlMotor',
      'dumpROM',
      'getACCompressorState',
      'getCOTrimVoltage',
      'getCoolantTemp',
      'getCurrentFuelMap',
      'getEngineRPM',
      'getFaultCodes',
      'getFuelMap',
      'getFuelMapColumnIndex',
      'getFuelMapRowIndex',
      'getFuelPumpRelayState',
      'getFuelTemp',
      'getGearSelection',
      'getIdleBypassMotorPosition',
      'getIdleMode',
      'getInjectorPulseWidth',
      'getLambdaTrimLong',
      'getLambdaTrimShort',
      'getMAFReading',
      'getMainVoltage',
      'getPurgeValveState',
      'getRPMLimit',
      'getRoadSpeed',
      'getRpmTable',
      'getScreenHeaterState',
      'getTargetIdle',
      'getThrottlePosition',
      'getTuneRevision',
      'isConnected',
      'isMILOn',
      'readMem',
      'runFuelPump',
      'writeMem',
    ]);
    expect(typeof api.Ecu.getLibraryVersion).toBe('function');
  });

  it('keeps the Transport contract on both transports', () => {
    expect(prototypeMethods(api.WebSerialTransport)).toEqual([
      'close',
      'open',
      'read',
      'write',
    ]);
    expect(prototypeMethods(api.SimulatedTransport)).toEqual([
      'close',
      'isOpen',
      'loadRom',
      'open',
      'read',
      'write',
    ]);
    expectTypeOf<api.WebSerialTransport>().toExtend<Transport>();
    expectTypeOf<api.SimulatedTransport>().toExtend<Transport>();
  });

  it('derives every error from Comm14cuxError and names it', () => {
    const errors = [
      api.TimeoutError,
      api.ProtocolError,
      api.NotConnectedError,
      api.ReadCancelledError,
      api.InvalidReadingError,
    ];

    expect(new api.Comm14cuxError('x')).toBeInstanceOf(Error);
    expect(new api.Comm14cuxError('x').name).toBe('Comm14cuxError');
    errors.forEach((Ctor) => {
      const error = new Ctor('x');
      expect(error).toBeInstanceOf(api.Comm14cuxError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(Ctor.name);
      expect(error.message).toBe('x');
    });
  });

  it('pins the wire constants an application may hard-code', () => {
    expect(api.BAUD).toBe(7812);
    expect(api.BAUD_DOUBLE_SPEED).toBe(15625);
    expect(api.DEFAULT_READ_TIMEOUT_MS).toBe(100);
    expect(api.FUEL_MAP_ROWS).toBe(8);
    expect(api.FUEL_MAP_COLUMNS).toBe(16);
    expect(api.Gear).toEqual({
      NoReading: 0,
      ParkOrNeutral: 1,
      DriveOrReverse: 2,
      ManualGearbox: 3,
    });
    expect(api.Bank).toEqual({ Odd: 0, Even: 1 });
  });

  it('pins the exported types', () => {
    expectTypeOf<Gear>().toEqualTypeOf<0 | 1 | 2 | 3>();
    expectTypeOf<Bank>().toEqualTypeOf<0 | 1>();
    expectTypeOf<FaultCodeName>().toEqualTypeOf<
      | 'airflowMeter'
      | 'batteryDisconnected'
      | 'coolantTempSensor'
      | 'fuelTempSensor'
      | 'idleValveStepperMotor'
      | 'injectorEvenBank'
      | 'injectorOddBank'
      | 'intakeAirLeak'
      | 'lambdaSensorEven'
      | 'lambdaSensorOdd'
      | 'lowFuelPressure'
      | 'lowFuelPressureOrAirLeak'
      | 'misfireEvenBank'
      | 'misfireOddBank'
      | 'mixtureTooLean'
      | 'neutralSwitch'
      | 'purgeValveLeak'
      | 'ramChecksumFailure'
      | 'roadSpeedSensor'
      | 'romChecksumFailure'
      | 'throttlePot'
      | 'throttlePotHiMafLo'
      | 'throttlePotLoMafHi'
      | 'tuneResistorOutOfRange'
    >();
    expectTypeOf<FaultCodes>().toEqualTypeOf<Record<FaultCodeName, boolean>>();
    expectTypeOf<FuelMap>().toEqualTypeOf<{
      data: Uint8Array;
      adjustmentFactor: number;
      rowScaler: number;
    }>();
    expectTypeOf<FuelMapIndex>().toEqualTypeOf<{
      index: number;
      weighting: number;
    }>();
    expectTypeOf<TuneRevision>().toEqualTypeOf<{
      tuneNumber: number;
      checksumFixer: number;
      tuneIdent: number;
    }>();
    expectTypeOf<Version>().toEqualTypeOf<{
      major: number;
      minor: number;
      patch: number;
    }>();
    expectTypeOf<EcuOptions>().toEqualTypeOf<{ readTimeoutMs?: number }>();
    expectTypeOf<WebSerialTransportOptions>().toEqualTypeOf<{
      baudRate?: number;
    }>();
  });

  it('pins the Ecu method signatures an application calls', () => {
    expectTypeOf<typeof api.Ecu>().constructorParameters.toEqualTypeOf<
      [transport: Transport, options?: EcuOptions]
    >();
    expectTypeOf<Ecu['connect']>().toEqualTypeOf<() => Promise<void>>();
    expectTypeOf<Ecu['readMem']>().returns.toEqualTypeOf<Promise<Uint8Array>>();
    expectTypeOf<Ecu['getGearSelection']>().returns.toEqualTypeOf<
      Promise<Gear>
    >();
    expectTypeOf<Ecu['getFaultCodes']>().returns.toEqualTypeOf<
      Promise<FaultCodes>
    >();
    expectTypeOf<Ecu['getFuelMap']>().toEqualTypeOf<
      (fuelMapId: number) => Promise<FuelMap>
    >();
    expectTypeOf<Ecu['getTuneRevision']>().returns.toEqualTypeOf<
      Promise<TuneRevision>
    >();
    expectTypeOf<
      typeof api.Ecu.getLibraryVersion
    >().returns.toEqualTypeOf<Version>();
  });
});
