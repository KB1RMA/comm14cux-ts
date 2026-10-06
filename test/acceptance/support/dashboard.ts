// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// Reads every live value the way a dashboard application would: all at once,
// relying on the `Ecu` to queue the calls.
import {
  AirflowType,
  Bank,
  type Ecu,
  ThrottlePosType,
} from '@kb1rma/libcomm14cux-ts';
import type { Dashboard } from '../fixtures/engineStates.js';

/**
 * Requests every live reading concurrently and collects the results.
 *
 * @param ecu - A connected `Ecu`.
 * @returns The readings.
 */
export async function readDashboard(ecu: Ecu): Promise<Dashboard> {
  const [
    coolantTempF,
    fuelTempF,
    engineRpm,
    rpmLimit,
    targetIdleRpm,
    roadSpeedMph,
    throttleAbsolute,
    throttleCorrected,
    gear,
    mafDirect,
    mafLinearised,
    idleBypassPosition,
    injectorPulseWidthUs,
    lambdaTrimShortOdd,
    lambdaTrimShortEven,
    lambdaTrimLongOdd,
    lambdaTrimLongEven,
    coTrimVoltage,
    fuelPumpRelayOn,
    milOn,
    idleMode,
    purgeValve,
    screenHeaterOn,
    acCompressorOn,
    currentFuelMap,
    fuelMapRow,
    fuelMapColumn,
  ] = await Promise.all([
    ecu.getCoolantTemp(),
    ecu.getFuelTemp(),
    ecu.getEngineRPM(),
    ecu.getRPMLimit(),
    ecu.getTargetIdle(),
    ecu.getRoadSpeed(),
    ecu.getThrottlePosition(ThrottlePosType.Absolute),
    ecu.getThrottlePosition(ThrottlePosType.Corrected),
    ecu.getGearSelection(),
    ecu.getMAFReading(AirflowType.Direct),
    ecu.getMAFReading(AirflowType.Linearized),
    ecu.getIdleBypassMotorPosition(),
    ecu.getInjectorPulseWidth(),
    ecu.getLambdaTrimShort(Bank.Odd),
    ecu.getLambdaTrimShort(Bank.Even),
    ecu.getLambdaTrimLong(Bank.Odd),
    ecu.getLambdaTrimLong(Bank.Even),
    ecu.getCOTrimVoltage(),
    ecu.getFuelPumpRelayState(),
    ecu.isMILOn(),
    ecu.getIdleMode(),
    ecu.getPurgeValveState(),
    ecu.getScreenHeaterState(),
    ecu.getACCompressorState(),
    ecu.getCurrentFuelMap(),
    ecu.getFuelMapRowIndex(),
    ecu.getFuelMapColumnIndex(),
  ]);

  return {
    coolantTempF,
    fuelTempF,
    engineRpm,
    rpmLimit,
    targetIdleRpm,
    roadSpeedMph,
    throttleAbsolute,
    throttleCorrected,
    gear,
    mafDirect,
    mafLinearised,
    idleBypassPosition,
    injectorPulseWidthUs,
    lambdaTrimShortOdd,
    lambdaTrimShortEven,
    lambdaTrimLongOdd,
    lambdaTrimLongEven,
    coTrimVoltage,
    fuelPumpRelayOn,
    milOn,
    idleMode,
    purgeValve,
    screenHeaterOn,
    acCompressorOn,
    currentFuelMap,
    fuelMapRow,
    fuelMapColumn,
  };
}

/**
 * Turns an expected dashboard into a matcher that allows for floating-point
 * rounding in fractional readings.
 *
 * @param expected - The fixture's expected readings.
 * @returns A value for `toEqual`.
 */
export function approximately(expected: Dashboard): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(expected).map(([key, value]) => [
      key,
      typeof value === 'number' && !Number.isInteger(value)
        ? expect.closeTo(value, 9)
        : value,
    ]),
  );
}
