// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §6 (c14cux_connect, c14cux_disconnect,
// c14cux_isConnected, c14cux_getLibraryVersion)
import { readFileSync } from 'node:fs';
import {
  DataOffsetRev,
  Ecu,
  NotConnectedError,
  SimulatedTransport,
} from './index.js';
import { connected, setRevision } from './test-support/ecu.js';

describe('Ecu connection', () => {
  it('is not connected after construction, and rejects operations', async () => {
    const transport = new SimulatedTransport();
    const ecu = new Ecu(transport);

    expect(ecu.isConnected()).toBe(false);
    await expect(ecu.getRoadSpeed()).rejects.toThrow(NotConnectedError);
    await expect(ecu.readMem(0, 1)).rejects.toThrow(NotConnectedError);
    await expect(ecu.writeMem(0, 1)).rejects.toThrow(NotConnectedError);
    expect(transport.isOpen).toBe(false);
  });

  it('connects by opening the transport, once', async () => {
    const transport = new SimulatedTransport();
    const open = vi.spyOn(transport, 'open');
    const ecu = new Ecu(transport);

    await ecu.connect();
    await ecu.connect();

    expect(ecu.isConnected()).toBe(true);
    expect(transport.isOpen).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('stays disconnected when the transport cannot open', async () => {
    const transport = new SimulatedTransport();
    const ecu = new Ecu(transport);

    vi.spyOn(transport, 'open').mockRejectedValueOnce(new Error('no port'));

    await expect(ecu.connect()).rejects.toThrow('no port');
    expect(ecu.isConnected()).toBe(false);
  });

  it('disconnects by closing the transport, and is a no-op when not connected', async () => {
    const { transport, ecu } = await connected();
    const close = vi.spyOn(transport, 'close');

    await ecu.disconnect();
    await ecu.disconnect();

    expect(ecu.isConnected()).toBe(false);
    expect(transport.isOpen).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    await expect(ecu.getRoadSpeed()).rejects.toThrow(NotConnectedError);
  });

  it('stays connected when the transport cannot close', async () => {
    const { transport, ecu } = await connected();

    vi.spyOn(transport, 'close').mockRejectedValueOnce(new Error('busy'));

    await expect(ecu.disconnect()).rejects.toThrow('busy');
    expect(ecu.isConnected()).toBe(true);
  });

  it('waits for an operation in progress before disconnecting', async () => {
    const { transport, ecu } = await connected();

    transport.memory[0x2003] = 100;

    const speed = ecu.getRoadSpeed();
    const disconnect = ecu.disconnect();

    await expect(speed).resolves.toBe(62);
    await disconnect;
    expect(ecu.isConnected()).toBe(false);
  });

  it('forgets the ROM revision on reconnect, so a different ECU is safe (deliberate divergence)', async () => {
    const { transport, ecu } = await connected();

    setRevision(transport, DataOffsetRev.RevC);
    transport.memory.fill(0x22, 0xc267, 0xc267 + 128);
    expect((await ecu.getFuelMap(1)).data[0]).toBe(0x22);

    await ecu.disconnect();
    await ecu.connect();
    setRevision(transport, DataOffsetRev.RevB);
    transport.memory.fill(0x11, 0xc23f + 16, 0xc23f + 128);

    expect((await ecu.getFuelMap(1)).data).toEqual(
      transport.memory.slice(0xc23f, 0xc23f + 128),
    );
  });

  it('forgets the main-voltage coefficients on reconnect (deliberate divergence)', async () => {
    const { transport, ecu } = await connected();

    setRevision(transport, DataOffsetRev.RevB);
    transport.memory.set([0x64, 0xbd, 0x61, 0x80], 0xc79b);
    transport.memory.set([0x03, 0x83], 0x0055);
    expect(await ecu.getMainVoltage()).toBeCloseTo(12.51, 5);

    await ecu.disconnect();
    await ecu.connect();
    transport.memory.set([0x01, 0x01, 0x00, 0x01], 0xc79b);

    expect(await ecu.getMainVoltage()).not.toBeCloseTo(12.51, 1);
  });

  it('reports the library version, matching package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      version: string;
    };
    const { major, minor, patch } = Ecu.getLibraryVersion();

    expect(`${major}.${minor}.${patch}`).toBe(pkg.version);
  });

  it('returns a copy of the version that callers cannot use to change it', () => {
    const version = Ecu.getLibraryVersion();

    version.major = 99;

    expect(Ecu.getLibraryVersion().major).not.toBe(99);
  });
});
