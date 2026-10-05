// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §3 (one operation at a time, as the
// libcomm14cux mutex guarantees)
import { AirflowType, InvalidReadingError } from './index.js';
import { connected, parseWire } from './test-support/ecu.js';

/** Makes every transport read wait a macrotask, so operations overlap in time. */
function slowReads(
  transport: Awaited<ReturnType<typeof connected>>['transport'],
) {
  const read = transport.read.bind(transport);

  transport.read = async (length, timeout) => {
    await new Promise((resolve) => setTimeout(resolve, 0));

    return read(length, timeout);
  };
}

describe('Ecu serialisation', () => {
  it('runs concurrent operations one at a time, in call order', async () => {
    const { transport, ecu } = await connected();

    slowReads(transport);
    transport.memory[0x2003] = 100;
    transport.memory[0x006a] = 0;
    transport.memory[0x2006] = 255;

    const results = await Promise.all([
      ecu.getRoadSpeed(),
      ecu.getCoolantTemp(),
      ecu.getFuelTemp(),
    ]);

    expect(results).toEqual([62, 266, -13]);
    expect(parseWire(transport.written)).toEqual([
      { kind: 'coarse', lengthCode: 0, address: 0x2000 },
      { kind: 'read', low: 0x03 },
      { kind: 'coarse', lengthCode: 0, address: 0x0040 },
      { kind: 'read', low: 0x2a },
      { kind: 'coarse', lengthCode: 0, address: 0x2000 },
      { kind: 'read', low: 0x06 },
    ]);
  });

  it('does not interleave a compound operation with another call', async () => {
    const { transport, ecu } = await connected();

    slowReads(transport);
    transport.memory[0x0002] = 0xff;

    await Promise.all([ecu.runFuelPump(), ecu.isMILOn()]);

    const kinds = parseWire(transport.written).map((command) => command.kind);

    // runFuelPump: read port 1, write the timer, write port 1; then isMILOn.
    expect(kinds).toEqual([
      'coarse',
      'read',
      'coarse',
      'write',
      'coarse',
      'write',
      'coarse',
      'read',
    ]);
  });

  it('a failing operation rejects only its own caller', async () => {
    const { transport, ecu } = await connected();

    transport.memory[0x2003] = 100;
    transport.memory.set([0x04, 0x00], 0x0057);

    const failing = ecu.getMAFReading(AirflowType.Direct);
    const next = ecu.getRoadSpeed();

    await expect(failing).rejects.toThrow(InvalidReadingError);
    await expect(next).resolves.toBe(62);
  });

  it('cancelRead acts at once instead of waiting in the queue', async () => {
    const { transport, ecu } = await connected();
    const read = transport.read.bind(transport);
    let cancelled = false;

    transport.read = async (length, timeout) => {
      await new Promise((resolve) => setTimeout(resolve, 0));

      if (length === 512 && !cancelled) {
        cancelled = true;
        ecu.cancelRead();
      }

      return read(length, timeout);
    };

    const dump = ecu.dumpROM();
    const after = ecu.getRoadSpeed();

    await expect(dump).rejects.toThrow('Read cancelled');
    await expect(after).resolves.toBe(0);
  });
});
