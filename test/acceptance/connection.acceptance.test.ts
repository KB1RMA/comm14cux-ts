// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// Journey: an application opens the serial port the user picked, talks to
// the ECU, and hands the port back when it is done.
import {
  BAUD_DOUBLE_SPEED,
  NotConnectedError,
  TimeoutError,
  WebSerialTransport,
} from '@kb1rma/libcomm14cux-ts';
import { revCRom, virtualEcu, warmIdle } from './fixtures/index.js';
import { bench } from './support/bench.js';
import { settle, timed, useVirtualClock } from './support/clock.js';
import { approximately, readDashboard } from './support/dashboard.js';

useVirtualClock();

const simulator = () => virtualEcu({ rom: revCRom, state: warmIdle });

describe('connecting over Web Serial', () => {
  it('opens the port once at 7812 baud, 8N1, without flow control', async () => {
    const { ecu, port } = bench({ simulator: simulator() });

    await settle(ecu.connect());
    await settle(ecu.connect());

    expect(port.opens).toEqual([
      {
        baudRate: 7812,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      },
    ]);
    expect(ecu.isConnected()).toBe(true);
  });

  it('refuses every call before connecting, without touching the port', async () => {
    const { ecu, port } = bench({ simulator: simulator() });

    await expect(settle(ecu.getEngineRPM())).rejects.toThrow(NotConnectedError);
    await expect(settle(ecu.dumpROM())).rejects.toThrow(NotConnectedError);
    expect(port.opens).toHaveLength(0);
  });

  it('closes the port on disconnect so another application can open it', async () => {
    const { ecu, port } = bench({ simulator: simulator() });

    await settle(ecu.connect());
    await settle(ecu.getEngineRPM());
    await settle(ecu.disconnect());

    expect(port.isOpen).toBe(false);
    expect(ecu.isConnected()).toBe(false);
    await expect(settle(ecu.getEngineRPM())).rejects.toThrow(NotConnectedError);

    // The port is free: a second transport can claim it.
    const other = new WebSerialTransport(port.asSerialPort());

    await settle(other.open());
    expect(port.isOpen).toBe(true);
    await settle(other.close());
  });

  it('reconnects after a disconnect and reads the same data', async () => {
    const { ecu, port } = bench({ simulator: simulator() });

    await settle(ecu.connect());
    const first = await settle(readDashboard(ecu));

    await settle(ecu.disconnect());
    await settle(ecu.connect());
    const second = await settle(readDashboard(ecu));

    expect(port.opens).toHaveLength(2);
    expect(first).toEqual(approximately(warmIdle.expected));
    expect(second).toEqual(first);
  });

  it('waits for a call in progress before disconnecting', async () => {
    const { ecu, port } = bench({ simulator: simulator() });

    await settle(ecu.connect());
    const reading = ecu.getEngineRPM();
    const closing = ecu.disconnect();

    expect(await settle(reading)).toBe(750);
    await settle(closing);
    expect(port.isOpen).toBe(false);
  });
});

describe('double-speed firmware', () => {
  it('works at 15625 baud and dumps the ROM in about half the time', async () => {
    const standard = bench({ simulator: simulator() });
    const fast = bench({
      simulator: simulator(),
      cable: { ecuBaudRate: BAUD_DOUBLE_SPEED },
      transport: { baudRate: BAUD_DOUBLE_SPEED },
    });

    await settle(standard.ecu.connect());
    await settle(fast.ecu.connect());
    const slowDump = await timed(() => standard.ecu.dumpROM());
    const fastDump = await timed(() => fast.ecu.dumpROM());

    expect(fast.port.opens[0]?.baudRate).toBe(15625);
    expect(fastDump.result).toEqual(revCRom.image);
    expect(fastDump.elapsedMs / slowDump.elapsedMs).toBeGreaterThan(0.45);
    expect(fastDump.elapsedMs / slowDump.elapsedMs).toBeLessThan(0.6);
  });

  it('times out when the application uses the wrong baud rate', async () => {
    const { ecu } = bench({
      simulator: simulator(),
      cable: { ecuBaudRate: BAUD_DOUBLE_SPEED },
    });

    await settle(ecu.connect());

    await expect(settle(ecu.getEngineRPM())).rejects.toThrow(TimeoutError);
  });
});
