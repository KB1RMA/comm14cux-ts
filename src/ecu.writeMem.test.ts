// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §2.4 (c14cux_writeMem)
import {
  Ecu,
  NotConnectedError,
  ProtocolError,
  SimulatedTransport,
  TimeoutError,
} from './index.js';
import { connected } from './test-support/ecu.js';

describe('Ecu.writeMem', () => {
  it('sends coarse address (code 0), 0x80 | (addr & 0x3F), then the value', async () => {
    const { transport, ecu } = await connected();

    await ecu.writeMem(0x00af, 0xff);

    expect(transport.written).toEqual([
      0x00,
      (0xaf >> 6) & 0xff,
      0x80 | 0x2f,
      0xff,
    ]);
  });

  it('puts the address bits above 0x3FFF in the first coarse byte', async () => {
    const { transport, ecu } = await connected();

    await ecu.writeMem(0x4000, 0);

    expect(transport.written.slice(0, 2)).toEqual([0x01, 0x00]);
  });

  it('updates the target address in ECU memory', async () => {
    const { transport, ecu } = await connected();

    await ecu.writeMem(0xc123, 0x5a);

    expect(transport.memory[0xc123]).toBe(0x5a);
  });

  it.each([0, 1, 2, 3])('fails when echo %i is wrong', async (index) => {
    const { transport, ecu } = await connected();
    const read = transport.read.bind(transport);
    let calls = 0;

    transport.read = async (length, timeout) => {
      const bytes = await read(length, timeout);

      return calls++ === index ? Uint8Array.of((bytes[0] ?? 0) ^ 0xff) : bytes;
    };

    await expect(ecu.writeMem(0x1000, 1)).rejects.toThrow(ProtocolError);
    expect(transport.written).toHaveLength(index + 1);
  });

  it('fails when the ECU is silent', async () => {
    const { transport, ecu } = await connected();

    transport.silent = true;

    await expect(ecu.writeMem(0x1000, 1)).rejects.toThrow(TimeoutError);
  });

  it('fails when the transport write rejects', async () => {
    const { transport, ecu } = await connected();

    transport.failWrites = true;

    await expect(ecu.writeMem(0x1000, 1)).rejects.toThrow(
      'Simulated write failure',
    );
  });

  it('times out on an injected memory write fault, leaving memory unchanged and reads working', async () => {
    const { transport, ecu } = await connected();

    transport.memory[0x1000] = 0x5a;
    transport.failMemoryWritesAfter = 0;

    await expect(ecu.writeMem(0x1000, 1)).rejects.toThrow(TimeoutError);
    // The value byte is never sent.
    expect(transport.written).toEqual([0x00, 0x1000 >> 6, 0x80]);
    expect(transport.memory[0x1000]).toBe(0x5a);
    expect([...(await ecu.readMem(0x1000, 1))]).toEqual([0x5a]);
  });

  it('waits for the ECU to drop a write whose command echo was garbled, so the next command is not stored as its value (deliberate divergence)', async () => {
    const { transport, ecu } = await connected();

    transport.memory[0x007c] = 0x27;
    transport.memory[0x007d] = 0x10;
    transport.memoryWriteFault = 'commandEchoCorrupted';
    transport.failMemoryWritesAfter = 0;

    await expect(ecu.writeMem(0x1000, 1)).rejects.toThrow(ProtocolError);
    expect(await ecu.getEngineRPM()).toBe(750);
    expect(transport.memory[0x1000]).toBe(0);
  });

  it('may have written the value when its echo is lost', async () => {
    const { transport, ecu } = await connected();

    transport.memoryWriteFault = 'valueEchoLost';
    transport.failMemoryWritesAfter = 0;

    await expect(ecu.writeMem(0x1000, 1)).rejects.toThrow(TimeoutError);
    expect(transport.memory[0x1000]).toBe(1);
    expect([...(await ecu.readMem(0x1000, 1))]).toEqual([1]);
  });

  it('may have written the value when its echo is garbled', async () => {
    const { transport, ecu } = await connected();

    transport.memoryWriteFault = 'valueEchoCorrupted';
    transport.failMemoryWritesAfter = 0;

    await expect(ecu.writeMem(0x1000, 1)).rejects.toThrow(ProtocolError);
    expect([...(await ecu.readMem(0x1000, 1))]).toEqual([1]);
  });

  it('waits commandResetMs of quiet before the next command after a failure', async () => {
    const transport = new SimulatedTransport();
    const ecu = new Ecu(transport, { readTimeoutMs: 5, commandResetMs: 42 });
    const read = transport.read.bind(transport);
    const timeouts: number[] = [];

    await ecu.connect();
    transport.failMemoryWritesAfter = 0;
    await expect(ecu.writeMem(0x1000, 1)).rejects.toThrow(TimeoutError);

    transport.read = (length, timeoutMs) => {
      timeouts.push(timeoutMs);

      return read(length, timeoutMs);
    };

    await ecu.readMem(0x1000, 1);
    await ecu.readMem(0x1000, 1);

    // Only the first command after the failure waits.
    expect(timeouts).toEqual([42, 5, 5, 5, 5]);
  });

  it('reports a closed transport while waiting for quiet after a failure', async () => {
    const { transport, ecu } = await connected();

    transport.failMemoryWritesAfter = 0;
    await expect(ecu.writeMem(0x1000, 1)).rejects.toThrow(TimeoutError);
    await transport.close();

    await expect(ecu.readMem(0x1000, 1)).rejects.toThrow(NotConnectedError);
  });

  it('fails the next command if the ECU never goes quiet after a failure', async () => {
    const { transport, ecu } = await connected();

    transport.failMemoryWritesAfter = 0;
    await expect(ecu.writeMem(0x1000, 1)).rejects.toThrow(TimeoutError);
    transport.read = () => Promise.resolve(Uint8Array.of(0));

    await expect(ecu.readMem(0x1000, 1)).rejects.toThrow(
      'ECU did not go quiet',
    );
  });

  it('fails when the transport has been closed underneath the Ecu', async () => {
    const { transport, ecu } = await connected();

    await transport.close();

    await expect(ecu.writeMem(0x1000, 1)).rejects.toThrow(NotConnectedError);
  });

  it.each([-1, 256, 1.5])('rejects value %d without I/O', async (value) => {
    const { transport, ecu } = await connected();

    await expect(ecu.writeMem(0x1000, value)).rejects.toThrow(RangeError);
    expect(transport.written).toHaveLength(0);
  });

  it.each([-1, 0x10000, 1.5])(
    'rejects address %d without I/O',
    async (addr) => {
      const { transport, ecu } = await connected();

      await expect(ecu.writeMem(addr, 0)).rejects.toThrow(RangeError);
      expect(transport.written).toHaveLength(0);
    },
  );
});
