// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Journey: a workshop session. Read the stored faults, clear them, and
// exercise the fuel pump and idle air control valve.
import { TimeoutError, type FaultCodeName } from '@kb1rma/libcomm14cux-ts';
import {
  allFaultFixtures,
  keyOnEngineOff,
  noFaults,
  revCRom,
  virtualEcu,
  warmIdle,
  workshopFull,
  type FaultFixture,
} from './fixtures/index.js';
import { bench } from './support/bench.js';
import { settle, useVirtualClock } from './support/clock.js';

useVirtualClock();

function setFaults(codes: Record<FaultCodeName, boolean>): FaultCodeName[] {
  return (Object.keys(codes) as FaultCodeName[]).filter((name) => codes[name]);
}

async function workshop(faults: FaultFixture = noFaults) {
  const rig = bench({
    simulator: virtualEcu({ rom: revCRom, state: keyOnEngineOff, faults }),
  });

  await settle(rig.ecu.connect());

  return rig;
}

describe('stored fault codes', () => {
  it.each(allFaultFixtures)('reads $name', async (fixture) => {
    const { ecu } = await workshop(fixture);

    const codes = await settle(ecu.getFaultCodes());

    expect(setFaults(codes).sort()).toEqual([...fixture.set].sort());
  });

  it('clears every fault, and reading again shows none', async () => {
    const { ecu, simulator } = await workshop(workshopFull);

    await settle(ecu.clearFaultCodes());

    expect(setFaults(await settle(ecu.getFaultCodes()))).toEqual([]);
    expect([...simulator.memory.subarray(0x0049, 0x004f)]).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
  });

  it('leaves faults partly cleared if a write is dropped, and finishes without reconnecting', async () => {
    const { ecu, simulator } = await workshop(workshopFull);
    const before = [...simulator.memory.subarray(0x0049, 0x004f)];

    simulator.failMemoryWritesAfter = 2;

    await expect(settle(ecu.clearFaultCodes())).rejects.toThrow(TimeoutError);
    expect([...simulator.memory.subarray(0x0049, 0x004f)]).toEqual([
      0,
      0,
      ...before.slice(2),
    ]);

    simulator.failMemoryWritesAfter = undefined;
    await settle(ecu.clearFaultCodes());

    expect(setFaults(await settle(ecu.getFaultCodes()))).toEqual([]);
  });

  it('leaves faults partly cleared if the cable is pulled, and finishes after reconnecting', async () => {
    const { ecu, port, simulator } = await workshop(workshopFull);

    const clearing = ecu.clearFaultCodes().then(
      () => 'finished',
      (error: unknown) => error,
    );

    // Each write is four echoed bytes; pull the cable part-way through.
    await vi.advanceTimersByTimeAsync(150);
    port.unplug();

    expect(await settle(clearing)).toBeInstanceOf(Error);
    const block = [...simulator.memory.subarray(0x0049, 0x004f)];

    expect(block[0]).toBe(0);
    expect(block[5]).not.toBe(0);

    await settle(ecu.disconnect());
    await vi.advanceTimersByTimeAsync(5000);
    port.plugIn();
    await settle(ecu.connect());
    await settle(ecu.clearFaultCodes());

    expect(setFaults(await settle(ecu.getFaultCodes()))).toEqual([]);
  });
});

describe('actuator tests', () => {
  it('runs the fuel pump: the relay reads as on and the timer is set', async () => {
    const { ecu, simulator } = await workshop();

    expect(await settle(ecu.getFuelPumpRelayState())).toBe(false);
    await settle(ecu.runFuelPump());

    expect(await settle(ecu.getFuelPumpRelayState())).toBe(true);
    expect(simulator.memory[0x00af]).toBe(0xff);
    // The MIL bit in the same port byte is untouched.
    expect(await settle(ecu.isMILOn())).toBe(true);
  });

  it('opens and closes the idle air control valve by the requested steps', async () => {
    const { ecu, simulator } = await workshop();
    const acBefore = await settle(ecu.getACCompressorState());

    await settle(ecu.driveIdleAirControlMotor(0, 20));
    const afterOpen = {
      direction: (simulator.memory[0x008a] ?? 0) & 0x01,
      steps: simulator.memory[0x0075],
    };

    await settle(ecu.driveIdleAirControlMotor(1, 5));
    const afterClose = {
      direction: (simulator.memory[0x008a] ?? 0) & 0x01,
      steps: simulator.memory[0x0075],
    };

    expect(afterOpen).toEqual({ direction: 0, steps: 20 });
    expect(afterClose).toEqual({ direction: 1, steps: 5 });
    // Other flags in the same byte, such as the A/C compressor, are kept.
    expect(await settle(ecu.getACCompressorState())).toBe(acBefore);
  });

  it('rejects an impossible step count without sending anything', async () => {
    const { ecu, simulator } = await workshop();
    const sent = simulator.written.length;

    await expect(settle(ecu.driveIdleAirControlMotor(0, 300))).rejects.toThrow(
      RangeError,
    );
    expect(simulator.written).toHaveLength(sent);
  });

  it('reports an idle air control command the ECU drops, writing nothing, and keeps reading', async () => {
    const { ecu, simulator } = bench({
      simulator: virtualEcu({ rom: revCRom, state: warmIdle }),
    });

    await settle(ecu.connect());
    simulator.failMemoryWritesAfter = 0;

    await expect(settle(ecu.driveIdleAirControlMotor(1, 20))).rejects.toThrow(
      TimeoutError,
    );
    // Neither the direction bit nor the step count was written.
    expect(simulator.memory[0x008a]).toBe(0x00);
    expect(simulator.memory[0x0075]).toBe(0);
    // The link is still in step: readings are right without reconnecting.
    expect(await settle(ecu.getEngineRPM())).toBe(750);
    expect(await settle(ecu.getCoolantTemp())).toBe(190);

    simulator.failMemoryWritesAfter = undefined;
    await settle(ecu.driveIdleAirControlMotor(1, 20));
    expect(simulator.memory[0x0075]).toBe(20);
  });

  it('leaves an idle air control command half done when the second write is dropped', async () => {
    const { ecu, simulator } = bench({
      simulator: virtualEcu({ rom: revCRom, state: warmIdle }),
    });

    await settle(ecu.connect());
    simulator.failMemoryWritesAfter = 1;

    await expect(settle(ecu.driveIdleAirControlMotor(1, 20))).rejects.toThrow(
      TimeoutError,
    );
    // The direction bit was set; the step count was not.
    expect(simulator.memory[0x008a]).toBe(0x01);
    expect(simulator.memory[0x0075]).toBe(0);
    expect(await settle(ecu.getEngineRPM())).toBe(750);
  });

  it('keeps live readings correct while actuator commands are queued between them', async () => {
    const { ecu } = bench({
      simulator: virtualEcu({ rom: revCRom, state: warmIdle }),
    });

    await settle(ecu.connect());
    const [rpm, , coolant, , relay] = await settle(
      Promise.all([
        ecu.getEngineRPM(),
        ecu.driveIdleAirControlMotor(0, 3),
        ecu.getCoolantTemp(),
        ecu.runFuelPump(),
        ecu.getFuelPumpRelayState(),
      ]),
    );

    expect({ rpm, coolant, relay }).toEqual({
      rpm: 750,
      coolant: 190,
      relay: true,
    });
  });
});
