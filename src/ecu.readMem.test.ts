// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §2.1 (chunking), §2.2 (coarse address),
// §2.3 (read, cache, cancellation), §6 (readMem, dumpROM)
import {
  NotConnectedError,
  ProtocolError,
  ReadCancelledError,
  TimeoutError,
} from './index.js';
import {
  connected,
  fillPattern,
  parseWire,
  readChunkLengths,
} from './test-support/ecu.js';

async function patterned() {
  const setup = await connected();

  fillPattern(setup.transport);

  return setup;
}

describe('Ecu.readMem', () => {
  describe('command bytes', () => {
    it('sends the coarse address then 0xC0 | (addr & 0x3F)', async () => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0x2003, 1);

      expect(transport.written).toEqual([0x00, (0x2003 >> 6) & 0xff, 0xc3]);
    });

    it('sends (lengthCode << 2) | (addr >> 14), then (addr >> 6) & 0xFF', async () => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0xc23f, 16);

      expect(transport.written.slice(0, 2)).toEqual([
        (15 << 2) | 3,
        (0xc23f >> 6) & 0xff,
      ]);
    });

    it('returns the bytes streamed by the ECU in order', async () => {
      const { transport, ecu } = await patterned();

      expect([...(await ecu.readMem(0x0100, 5))]).toEqual([
        ...transport.memory.slice(0x100, 0x105),
      ]);
    });

    it('returns an empty buffer for a zero-length read without I/O', async () => {
      const { transport, ecu } = await patterned();

      expect(await ecu.readMem(0x1000, 0)).toHaveLength(0);
      expect(transport.written).toHaveLength(0);
    });

    it.each([
      [-1, 1],
      [0x10000, 1],
      [1.5, 1],
      [0, -1],
      [0, 0x10000],
    ])('rejects addr %d with length %d without I/O', async (addr, length) => {
      const { transport, ecu } = await patterned();

      await expect(ecu.readMem(addr, length)).rejects.toThrow(RangeError);
      expect(transport.written).toHaveLength(0);
    });

    it('rejects a read that runs past the end of the address space', async () => {
      const { ecu } = await patterned();

      await expect(ecu.readMem(0xfff0, 0x20)).rejects.toThrow(RangeError);
    });
  });

  describe('chunking', () => {
    it.each([
      [1, [1]],
      [15, [15]],
      [16, [16]],
      [79, [16, 16, 16, 16, 15]],
      [80, [80]],
      [99, [80, 16, 3]],
      [100, [100]],
      [399, [100, 100, 100, 80, 16, 3]],
      [400, [400]],
      [511, [400, 100, 11]],
      [512, [512]],
      [1000, [512, 400, 80, 8]],
    ])('splits a %i-byte read into chunks of %j', async (length, chunks) => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0x0000, length);

      expect(readChunkLengths(transport.written)).toEqual(chunks);
    });

    it('encodes 1-16 as length - 1 and 80, 100, 400, 512 as 0x10-0x13', async () => {
      const { transport, ecu } = await patterned();

      for (const length of [512, 400, 100, 80, 16, 5]) {
        await ecu.readMem(0x0000, length);
      }

      const codes = parseWire(transport.written).flatMap((command) =>
        command.kind === 'coarse' ? [command.lengthCode] : [],
      );

      expect(codes).toEqual([0x13, 0x12, 0x11, 0x10, 15, 4]);
    });

    it('assembles chunks into one contiguous buffer', async () => {
      const { transport, ecu } = await patterned();

      expect([...(await ecu.readMem(0x0123, 1000))]).toEqual([
        ...transport.memory.slice(0x123, 0x123 + 1000),
      ]);
    });

    it('reads at the very end of the address space', async () => {
      const { transport, ecu } = await patterned();

      expect([...(await ecu.readMem(0xfff0, 16))]).toEqual([
        ...transport.memory.slice(0xfff0),
      ]);
    });
  });

  describe('dumpROM', () => {
    it('returns the 0x4000 byte ROM image', async () => {
      const { transport, ecu } = await patterned();
      const rom = Uint8Array.from({ length: 0x4000 }, (_, i) => (i * 3) & 0xff);

      transport.loadRom(rom);

      expect(await ecu.dumpROM()).toEqual(rom);
    });

    it('reads in 32 chunks of 512 bytes', async () => {
      const { transport, ecu } = await patterned();

      await ecu.dumpROM();

      expect(readChunkLengths(transport.written)).toEqual(
        new Array<number>(32).fill(512),
      );
    });
  });

  describe('coarse-address cache', () => {
    it('skips the coarse address when the length matches and addr is in the same 64-byte block', async () => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0x2000, 2);
      transport.written.length = 0;
      await ecu.readMem(0x2010, 2);

      expect(transport.written).toEqual([0xc0 | (0x2010 & 0x3f)]);
    });

    it('skips the coarse address for a lower addr in the same 64-byte block', async () => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0x2010, 2);
      transport.written.length = 0;
      await ecu.readMem(0x2000, 2);

      expect(transport.written).toEqual([0xc0]);
    });

    it('sends the coarse address again when the length differs', async () => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0x2000, 2);
      transport.written.length = 0;
      await ecu.readMem(0x2010, 3);

      expect(transport.written).toHaveLength(3);
    });

    it('sends the coarse address again in the next 64-byte block', async () => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0x2000, 2);
      transport.written.length = 0;
      await ecu.readMem(0x2040, 2);

      expect(transport.written).toHaveLength(3);
    });

    it('sends the coarse address again in a lower 64-byte block', async () => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0x2040, 2);
      transport.written.length = 0;
      await ecu.readMem(0x203f, 2);

      expect(transport.written).toHaveLength(3);
    });

    it('sends the coarse address again when an unaligned last read was in the previous block (deliberate divergence: C compares a 64-byte window from the unaligned address)', async () => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0x005f, 2);
      transport.written.length = 0;
      const bytes = await ecu.readMem(0x0082, 2);

      expect(transport.written).toHaveLength(3);
      expect([...bytes]).toEqual([...transport.memory.slice(0x82, 0x84)]);
    });

    it('returns the right data when a multi-chunk read crosses a 64-byte block', async () => {
      const { transport, ecu } = await patterned();

      expect([...(await ecu.readMem(0x0030, 32))]).toEqual([
        ...transport.memory.slice(0x30, 0x50),
      ]);
    });

    it('is cleared after a failed read', async () => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0x2000, 2);
      transport.streamLimit = 1;
      await expect(ecu.readMem(0x2002, 2)).rejects.toThrow(TimeoutError);
      transport.streamLimit = undefined;
      transport.written.length = 0;
      await ecu.readMem(0x2004, 2);

      expect(transport.written).toHaveLength(3);
    });

    it('is cleared by any write', async () => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0x2000, 1);
      await ecu.writeMem(0x3000, 1);
      transport.written.length = 0;
      await ecu.readMem(0x2001, 1);

      expect(transport.written).toHaveLength(3);
    });

    it('is cleared on disconnect', async () => {
      const { transport, ecu } = await patterned();

      await ecu.readMem(0x2000, 1);
      await ecu.disconnect();
      await ecu.connect();
      transport.written.length = 0;
      await ecu.readMem(0x2001, 1);

      expect(transport.written).toHaveLength(3);
    });
  });

  describe('failure handling', () => {
    it('rejects with a timeout when the ECU stops sending mid-chunk', async () => {
      const { transport, ecu } = await patterned();

      transport.streamLimit = 3;

      await expect(ecu.readMem(0x1000, 8)).rejects.toThrow(TimeoutError);
    });

    it('rejects with a timeout when the ECU is silent', async () => {
      const { transport, ecu } = await patterned();

      transport.silent = true;

      await expect(ecu.readMem(0x1000, 1)).rejects.toThrow(TimeoutError);
    });

    it('sends the second coarse byte only after the first is echoed correctly', async () => {
      const { transport, ecu } = await patterned();

      transport.corruptNextEcho = true;

      await expect(ecu.readMem(0x1000, 1)).rejects.toThrow(ProtocolError);
      expect(transport.written).toHaveLength(1);
    });

    it('rejects when the second coarse echo is wrong', async () => {
      const { transport, ecu } = await patterned();
      const read = transport.read.bind(transport);
      let calls = 0;

      transport.read = async (length, timeout) => {
        const bytes = await read(length, timeout);

        calls += 1;

        return calls === 2 ? Uint8Array.of(0xaa) : bytes;
      };

      await expect(ecu.readMem(0x1000, 1)).rejects.toThrow(ProtocolError);
      expect(transport.written).toHaveLength(2);
    });

    it('rejects when the transport write rejects', async () => {
      const { transport, ecu } = await patterned();

      transport.failWrites = true;

      await expect(ecu.readMem(0x1000, 1)).rejects.toThrow(
        'Simulated write failure',
      );
    });

    it('rejects when the transport has been closed underneath the Ecu', async () => {
      const { transport, ecu } = await patterned();

      await transport.close();

      await expect(ecu.readMem(0x1000, 1)).rejects.toThrow(NotConnectedError);
    });
  });

  describe('cancelRead', () => {
    it('stops a ROM dump after the in-flight chunk, without partial data', async () => {
      const { transport, ecu } = await patterned();
      const read = transport.read.bind(transport);
      let calls = 0;

      transport.read = async (length, timeout) => {
        if (++calls === 3) {
          ecu.cancelRead();
        }

        return read(length, timeout);
      };

      await expect(ecu.dumpROM()).rejects.toThrow(ReadCancelledError);
      // Only the first 512-byte chunk was requested.
      expect(readChunkLengths(transport.written)).toEqual([512]);
    });

    it('clears the coarse-address cache', async () => {
      const { transport, ecu } = await patterned();
      const read = transport.read.bind(transport);
      let first = true;

      transport.read = async (length, timeout) => {
        if (first && length === 512) {
          first = false;
          ecu.cancelRead();
        }

        return read(length, timeout);
      };

      await expect(ecu.readMem(0xc000, 1024)).rejects.toThrow(
        ReadCancelledError,
      );
      transport.written.length = 0;
      await ecu.readMem(0xc000, 512);

      expect(transport.written).toHaveLength(3);
    });

    it('cancels a ROM dump still waiting in the queue, before anything is sent (deliberate divergence: C loses a cancel issued before the read starts)', async () => {
      const { transport, ecu } = await patterned();

      transport.memory[0x2003] = 100;

      const speed = ecu.getRoadSpeed();
      const dump = ecu.dumpROM();

      ecu.cancelRead();

      await expect(speed).resolves.toBe(62);
      await expect(dump).rejects.toThrow(ReadCancelledError);
      // Only the road speed byte was read.
      expect(readChunkLengths(transport.written)).toEqual([1]);
    });

    it('cancels every multi-chunk read requested before the call', async () => {
      const { ecu } = await patterned();

      const first = ecu.readMem(0x1000, 32);
      const second = ecu.readMem(0x2000, 32);

      ecu.cancelRead();

      await expect(first).rejects.toThrow(ReadCancelledError);
      await expect(second).rejects.toThrow(ReadCancelledError);
    });

    it('does not cancel reads that fit in a single chunk', async () => {
      const { transport, ecu } = await patterned();

      const bytes = ecu.readMem(0x1000, 16);

      ecu.cancelRead();

      expect([...(await bytes)]).toEqual([
        ...transport.memory.slice(0x1000, 0x1010),
      ]);
    });

    it('cancels a fuel map read', async () => {
      const { transport, ecu } = await patterned();

      transport.memory[0xc23f] = 0x40;

      const map = ecu.getFuelMap(1);

      ecu.cancelRead();

      await expect(map).rejects.toThrow(ReadCancelledError);
    });

    it('does not affect reads requested after the call', async () => {
      const { transport, ecu } = await patterned();

      ecu.cancelRead();

      expect([...(await ecu.readMem(0x1000, 32))]).toEqual([
        ...transport.memory.slice(0x1000, 0x1020),
      ]);
      await expect(ecu.dumpROM()).resolves.toHaveLength(0x4000);
    });
  });
});
