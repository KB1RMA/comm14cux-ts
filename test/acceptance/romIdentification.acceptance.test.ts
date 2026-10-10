// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Journey: identify an unknown ECU and read its calibration — tune number,
// battery voltage, fuel maps and RPM table — then save a copy of its ROM.
import { DataSize, ReadCancelledError } from '@kb1rma/libcomm14cux-ts';
import {
  allRoms,
  fuelMapAdjustment,
  fuelMapCell,
  fuelMapRowScaler,
  revBRom,
  revCRom,
  virtualEcu,
  warmIdle,
} from './fixtures/index.js';
import { bench } from './support/bench.js';
import { settle, timed, useVirtualClock } from './support/clock.js';

useVirtualClock();

function expectedMap(map: number): Uint8Array {
  const data = new Uint8Array(DataSize.FuelMap);

  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 16; column++) {
      data[row * 16 + column] = fuelMapCell(map, row, column);
    }
  }

  return data;
}

describe.each(allRoms)('identifying a $name ECU', (rom) => {
  async function connectedBench() {
    const rig = bench({ simulator: virtualEcu({ rom, state: warmIdle }) });

    await settle(rig.ecu.connect());

    return rig;
  }

  it('reads the tune revision', async () => {
    const { ecu } = await connectedBench();

    expect(await settle(ecu.getTuneRevision())).toEqual(rom.tuneRevision);
  });

  it("reads the battery voltage using the ROM's coefficients", async () => {
    const { ecu } = await connectedBench();

    expect(await settle(ecu.getMainVoltage())).toBeCloseTo(
      rom.battery.volts,
      2,
    );
  });

  it('reads all six fuel maps from where this layout keeps them', async () => {
    const { ecu } = await connectedBench();

    for (let map = 0; map <= 5; map++) {
      expect(await settle(ecu.getFuelMap(map))).toEqual({
        data: expectedMap(map),
        adjustmentFactor: fuelMapAdjustment(map),
        rowScaler: fuelMapRowScaler(map),
      });
    }
  });

  it('reads the RPM table', async () => {
    const { ecu } = await connectedBench();

    expect(await settle(ecu.getRpmTable())).toEqual(rom.rpmTable);
  });

  it('dumps the ROM byte for byte in the time 7812 baud allows', async () => {
    const { ecu } = await connectedBench();

    const { result, elapsedMs } = await timed(() => ecu.dumpROM());

    expect(result).toEqual(rom.image);
    // 16 KiB at 1.28 ms a byte is 21 s on the wire, plus command overhead.
    expect(elapsedMs).toBeGreaterThan(20_000);
    expect(elapsedMs).toBeLessThan(25_000);
  });
});

describe('a ROM dump the user cancels', () => {
  it('stops within one chunk, returns nothing, and leaves the link usable', async () => {
    const { ecu } = bench({
      simulator: virtualEcu({ rom: revCRom, state: warmIdle }),
    });

    await settle(ecu.connect());
    const dump = ecu.dumpROM();
    const outcome = dump.then(
      () => 'finished',
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(5000);
    ecu.cancelRead();
    const cancelledAt = Date.now();

    expect(await settle(outcome)).toBeInstanceOf(ReadCancelledError);
    // A 512-byte chunk is about 655 ms on the wire.
    expect(Date.now() - cancelledAt).toBeLessThan(1000);
    expect(await settle(ecu.getTuneRevision())).toEqual(revCRom.tuneRevision);
  });
});

describe('moving the cable to a different ECU', () => {
  it('forgets the first ECU on disconnect and reads the second correctly', async () => {
    const { ecu, simulator } = bench({
      simulator: virtualEcu({ rom: revBRom, state: warmIdle }),
    });

    await settle(ecu.connect());
    const firstVoltage = await settle(ecu.getMainVoltage());
    const firstMap = await settle(ecu.getFuelMap(1));

    await settle(ecu.disconnect());
    // Swap the ECU: a Rev C unit with its own battery reading.
    simulator.loadRom(revCRom.image);
    simulator.memory.set(
      [revCRom.battery.raw >> 8, revCRom.battery.raw & 0xff],
      0x0055,
    );
    await settle(ecu.connect());

    expect(firstVoltage).toBeCloseTo(revBRom.battery.volts, 2);
    expect(firstMap.data).toEqual(expectedMap(1));
    expect(await settle(ecu.getMainVoltage())).toBeCloseTo(
      revCRom.battery.volts,
      2,
    );
    expect(await settle(ecu.getFuelMap(1))).toEqual({
      data: expectedMap(1),
      adjustmentFactor: fuelMapAdjustment(1),
      rowScaler: fuelMapRowScaler(1),
    });
    expect(await settle(ecu.getTuneRevision())).toEqual(revCRom.tuneRevision);
  });
});
