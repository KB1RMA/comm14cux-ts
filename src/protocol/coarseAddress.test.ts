// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §2.2 (c14cux_setCoarseAddr)
import { ProtocolError, TimeoutError } from '../errors.js';
import { SimulatedTransport } from '../transport/simulated.js';
import { Protocol } from './protocol.js';

async function setup() {
  const transport = new SimulatedTransport();

  await transport.open();

  return { transport, protocol: new Protocol(transport, 5) };
}

describe('coarse address command', () => {
  it('sends (lengthCode << 2) | (addr >> 14), then (addr >> 6) & 0xFF', async () => {
    const { transport, protocol } = await setup();

    await protocol.setCoarseAddr(0xc23f, 16);

    expect(transport.written).toEqual([(15 << 2) | 3, (0xc23f >> 6) & 0xff]);
  });

  it('uses length code 0 for the write form', async () => {
    const { transport, protocol } = await setup();

    await protocol.setCoarseAddr(0x4000, 0);

    expect(transport.written).toEqual([0x01, 0x00]);
  });

  it('encodes the preset lengths', async () => {
    const { transport, protocol } = await setup();

    await protocol.setCoarseAddr(0, 512);

    expect(transport.written[0]).toBe(0x13 << 2);
  });

  it('sends the second byte only after the first is echoed', async () => {
    const { transport, protocol } = await setup();

    transport.corruptNextEcho = true;

    await expect(protocol.setCoarseAddr(0x1000, 1)).rejects.toThrow(
      ProtocolError,
    );
    expect(transport.written).toHaveLength(1);
  });

  it('fails when the second echo differs', async () => {
    const { transport, protocol } = await setup();
    const original = transport.read.bind(transport);
    let calls = 0;

    transport.read = async (length, timeout) => {
      const bytes = await original(length, timeout);

      calls += 1;

      return calls === 2 ? Uint8Array.of(0xaa) : bytes;
    };

    await expect(protocol.setCoarseAddr(0x1000, 1)).rejects.toThrow(
      ProtocolError,
    );
  });

  it('fails when the ECU is silent', async () => {
    const { transport, protocol } = await setup();

    transport.silent = true;

    await expect(protocol.setCoarseAddr(0x1000, 1)).rejects.toThrow(
      TimeoutError,
    );
  });

  it('fails on an invalid length without writing anything', async () => {
    const { transport, protocol } = await setup();

    await expect(protocol.setCoarseAddr(0x1000, 17)).rejects.toThrow(
      RangeError,
    );
    expect(transport.written).toHaveLength(0);
  });

  it('fails when the transport write rejects', async () => {
    const { transport, protocol } = await setup();

    transport.failWrites = true;

    await expect(protocol.setCoarseAddr(0x1000, 1)).rejects.toThrow(
      'Simulated write failure',
    );
  });
});
