// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §2.4 (c14cux_writeMem)
import { ProtocolError, TimeoutError } from '../errors.js';
import { SimulatedTransport } from '../transport/simulated.js';
import { Protocol } from './protocol.js';

async function setup() {
  const transport = new SimulatedTransport();

  await transport.open();

  return { transport, protocol: new Protocol(transport, 5) };
}

describe('writeMem', () => {
  it('sends coarse address (code 0), 0x80 | (addr & 0x3F), then the value', async () => {
    const { transport, protocol } = await setup();

    await protocol.writeMem(0x00af, 0xff);

    expect(transport.written).toEqual([
      0x00,
      (0xaf >> 6) & 0xff,
      0x80 | 0x2f,
      0xff,
    ]);
  });

  it('updates the target address in ECU memory', async () => {
    const { transport, protocol } = await setup();

    await protocol.writeMem(0xc123, 0x5a);

    expect(transport.memory[0xc123]).toBe(0x5a);
  });

  it('clears the coarse-address cache before writing', async () => {
    const { transport, protocol } = await setup();

    await protocol.readMem(0x0100, 1);
    await protocol.writeMem(0x0100, 1);
    transport.written.length = 0;
    await protocol.readMem(0x0101, 1);

    expect(transport.written).toHaveLength(3);
  });

  it.each([0, 1, 2])('fails when echo %i is wrong', async (index) => {
    const { transport, protocol } = await setup();
    const original = transport.read.bind(transport);
    let calls = 0;

    transport.read = async (length, timeout) => {
      const bytes = await original(length, timeout);

      return calls++ === index ? Uint8Array.of((bytes[0] ?? 0) ^ 0xff) : bytes;
    };

    await expect(protocol.writeMem(0x1000, 1)).rejects.toThrow(ProtocolError);
  });

  it('fails when the ECU is silent', async () => {
    const { transport, protocol } = await setup();

    transport.silent = true;

    await expect(protocol.writeMem(0x1000, 1)).rejects.toThrow(TimeoutError);
  });

  it('fails when the transport write rejects', async () => {
    const { transport, protocol } = await setup();

    transport.failWrites = true;

    await expect(protocol.writeMem(0x1000, 1)).rejects.toThrow('Simulated');
  });

  it.each([-1, 256, 1.5])('rejects value %d', async (value) => {
    const { protocol } = await setup();

    await expect(protocol.writeMem(0x1000, value)).rejects.toThrow(RangeError);
  });

  it.each([-1, 0x10000])('rejects address %d', async (addr) => {
    const { protocol } = await setup();

    await expect(protocol.writeMem(addr, 0)).rejects.toThrow(RangeError);
  });
});
