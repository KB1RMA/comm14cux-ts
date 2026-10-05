// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §2.3 (c14cux_readMem, c14cux_sendReadCmd, c14cux_cancelRead)
import {
  NotConnectedError,
  ProtocolError,
  ReadCancelledError,
  TimeoutError,
} from '../errors.js';
import { SimulatedTransport } from '../transport/simulated.js';
import { Protocol } from './protocol.js';

async function setup() {
  const transport = new SimulatedTransport();

  await transport.open();
  transport.memory.forEach((_, i) => {
    transport.memory[i] = (i * 7 + (i >> 8)) & 0xff;
  });

  return { transport, protocol: new Protocol(transport, 5) };
}

describe('readMem', () => {
  describe('command bytes', () => {
    it('sends the coarse address then 0xC0 | (addr & 0x3F)', async () => {
      const { transport, protocol } = await setup();

      await protocol.readMem(0x2003, 1);

      expect(transport.written).toEqual([0x00, (0x2003 >> 6) & 0xff, 0xc3]);
    });

    it('returns the bytes streamed by the ECU in order', async () => {
      const { transport, protocol } = await setup();
      const bytes = await protocol.readMem(0x0100, 5);

      expect([...bytes]).toEqual([...transport.memory.slice(0x100, 0x105)]);
    });

    it('returns an empty buffer for a zero-length read without I/O', async () => {
      const { transport, protocol } = await setup();

      expect(await protocol.readMem(0x1000, 0)).toHaveLength(0);
      expect(transport.written).toHaveLength(0);
    });

    it.each([
      [-1, 1],
      [0x10000, 1],
      [1.5, 1],
      [0, -1],
      [0, 0x10000],
    ])('rejects addr %d with length %d', async (addr, length) => {
      const { protocol } = await setup();

      await expect(protocol.readMem(addr, length)).rejects.toThrow(RangeError);
    });

    it('rejects a read that runs past the end of the address space', async () => {
      const { protocol } = await setup();

      await expect(protocol.readMem(0xfff0, 0x20)).rejects.toThrow(RangeError);
    });
  });

  describe('chunking', () => {
    it('assembles chunks into one contiguous buffer', async () => {
      const { transport, protocol } = await setup();
      const bytes = await protocol.readMem(0x0123, 1000);

      expect([...bytes]).toEqual([
        ...transport.memory.slice(0x123, 0x123 + 1000),
      ]);
    });

    it('reads a full 0x4000 byte ROM image', async () => {
      const { transport, protocol } = await setup();
      const bytes = await protocol.readMem(0xc000, 0x4000);

      expect([...bytes]).toEqual([...transport.memory.slice(0xc000)]);
    });

    it('reads at the very end of the address space', async () => {
      const { transport, protocol } = await setup();

      expect([...(await protocol.readMem(0xfff0, 16))]).toEqual([
        ...transport.memory.slice(0xfff0),
      ]);
    });
  });

  describe('coarse-address cache', () => {
    it('skips the coarse address when length matches and addr is within the 64-byte window', async () => {
      const { transport, protocol } = await setup();

      await protocol.readMem(0x2000, 2);
      transport.written.length = 0;
      await protocol.readMem(0x2010, 2);

      expect(transport.written).toEqual([0xc0 | (0x2010 & 0x3f)]);
    });

    it('sends the coarse address again when the length differs', async () => {
      const { transport, protocol } = await setup();

      await protocol.readMem(0x2000, 2);
      transport.written.length = 0;
      await protocol.readMem(0x2010, 3);

      expect(transport.written).toHaveLength(3);
    });

    it('sends the coarse address again at 64 or more bytes past the last one', async () => {
      const { transport, protocol } = await setup();

      await protocol.readMem(0x2000, 2);
      transport.written.length = 0;
      await protocol.readMem(0x2040, 2);

      expect(transport.written).toHaveLength(3);
    });

    it('sends the coarse address again when addr is below the last one', async () => {
      const { transport, protocol } = await setup();

      await protocol.readMem(0x2010, 2);
      transport.written.length = 0;
      await protocol.readMem(0x2000, 2);

      expect(transport.written).toHaveLength(3);
    });

    it('clears the cache after a failed read', async () => {
      const { transport, protocol } = await setup();

      await protocol.readMem(0x2000, 2);
      transport.streamLimit = 1;
      await expect(protocol.readMem(0x2002, 2)).rejects.toThrow(TimeoutError);
      transport.streamLimit = undefined;
      transport.written.length = 0;
      await protocol.readMem(0x2004, 2);

      expect(transport.written).toHaveLength(3);
    });

    it('clears the cache after any writeMem', async () => {
      const { transport, protocol } = await setup();

      await protocol.readMem(0x2000, 1);
      await protocol.writeMem(0x3000, 1);
      transport.written.length = 0;
      await protocol.readMem(0x2001, 1);

      expect(transport.written).toHaveLength(3);
    });
  });

  describe('failure handling', () => {
    it('rejects with a timeout when the ECU stops sending mid-chunk', async () => {
      const { transport, protocol } = await setup();

      transport.streamLimit = 3;

      await expect(protocol.readMem(0x1000, 8)).rejects.toThrow(TimeoutError);
    });

    it('rejects when the coarse address echo is wrong', async () => {
      const { transport, protocol } = await setup();

      transport.corruptNextEcho = true;

      await expect(protocol.readMem(0x1000, 1)).rejects.toThrow(ProtocolError);
    });

    it('rejects when the transport write rejects', async () => {
      const { transport, protocol } = await setup();

      transport.failWrites = true;

      await expect(protocol.readMem(0x1000, 1)).rejects.toThrow('Simulated');
    });

    it('rejects when the transport is closed', async () => {
      const { transport, protocol } = await setup();

      await transport.close();

      await expect(protocol.readMem(0x1000, 1)).rejects.toThrow(
        NotConnectedError,
      );
    });
  });

  describe('cancellation', () => {
    it('stops after the in-flight chunk and rejects without partial data', async () => {
      const { transport, protocol } = await setup();
      const original = transport.read.bind(transport);
      let reads = 0;

      transport.read = async (length, timeout) => {
        reads += 1;

        if (reads === 4) {
          protocol.cancelRead();
        }

        return original(length, timeout);
      };

      await expect(protocol.readMem(0xc000, 0x4000)).rejects.toThrow(
        ReadCancelledError,
      );
      // 2 reads per coarse-address command echo, then data: stopped early.
      expect(transport.written.length).toBeLessThan(10);
    });

    it('clears the cache after a cancelled read', async () => {
      const { transport, protocol } = await setup();
      const original = transport.read.bind(transport);
      let first = true;

      transport.read = async (length, timeout) => {
        if (first && length === 512) {
          first = false;
          protocol.cancelRead();
        }

        return original(length, timeout);
      };

      await expect(protocol.readMem(0xc000, 1024)).rejects.toThrow(
        ReadCancelledError,
      );
      transport.written.length = 0;
      await protocol.readMem(0xc200, 512);

      expect(transport.written).toHaveLength(3);
    });

    it('does not affect the next read', async () => {
      const { protocol } = await setup();

      protocol.cancelRead();

      await expect(protocol.readMem(0x1000, 4)).resolves.toHaveLength(4);
    });
  });
});
