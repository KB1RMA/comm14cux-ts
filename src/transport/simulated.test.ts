// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §4.1
import {
  NotConnectedError,
  SimulatedTransport,
  TimeoutError,
} from '../index.js';

async function opened() {
  const transport = new SimulatedTransport();

  await transport.open();

  return transport;
}

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('SimulatedTransport', () => {
  it('echoes the coarse-address bytes and write command bytes', async () => {
    const t = await opened();

    await t.write(bytes(0x01, 0x02));
    await t.write(bytes(0x83));
    await t.write(bytes(0x77));

    expect([...(await t.read(4, 1))]).toEqual([0x01, 0x02, 0x83, 0x77]);
    expect(t.memory[(0x02 << 6) | (1 << 14) | 3]).toBe(0x77);
  });

  it('does not echo the read command and streams the data', async () => {
    const t = await opened();

    t.memory.set([9, 8, 7], 0x0040);
    await t.write(bytes(0x02 << 2, 0x01));
    await t.read(2, 1);
    await t.write(bytes(0xc0));

    expect([...(await t.read(3, 1))]).toEqual([9, 8, 7]);
  });

  it('serves a short read (command byte only) with the latched coarse address', async () => {
    const t = await opened();

    t.memory.set([1, 2, 3, 4], 0x0040);
    await t.write(bytes(0x00, 0x01));
    await t.read(2, 1);
    await t.write(bytes(0xc0));
    await t.read(1, 1);
    await t.write(bytes(0xc2));

    expect([...(await t.read(1, 1))]).toEqual([3]);
  });

  it.each([
    [0x10, 80],
    [0x11, 100],
    [0x12, 400],
    [0x13, 512],
    [0x00, 1],
    [0x0f, 16],
  ])('honours length code 0x%x as %i bytes', async (code, length) => {
    const t = await opened();

    await t.write(bytes(code << 2, 0x00));
    await t.read(2, 1);
    await t.write(bytes(0xc0));

    expect(await t.read(length, 1)).toHaveLength(length);
  });

  it('produces nothing for an invalid length code', async () => {
    const t = await opened();

    await t.write(bytes(0x14 << 2, 0x00));
    await t.read(2, 1);
    await t.write(bytes(0xc0));

    await expect(t.read(1, 1)).rejects.toThrow(TimeoutError);
  });

  it('ignores a command byte that has no coarse address', async () => {
    const t = await opened();

    await t.write(bytes(0xc0));

    await expect(t.read(1, 1)).rejects.toThrow(TimeoutError);
  });

  it('wraps reads at the end of the address space', async () => {
    const t = await opened();

    t.memory[0xffff] = 0xab;
    t.memory[0] = 0xcd;
    await t.write(bytes((0x01 << 2) | 3, 0xff));
    await t.read(2, 1);
    await t.write(bytes(0xc0 | 0x3f));

    expect([...(await t.read(2, 1))]).toEqual([0xab, 0xcd]);
  });

  it('rejects a read with a TimeoutError when too few bytes are available', async () => {
    const t = await opened();

    await expect(t.read(1, 1)).rejects.toThrow(TimeoutError);
  });

  it('can corrupt a single echo', async () => {
    const t = await opened();

    t.corruptNextEcho = true;
    await t.write(bytes(0x01, 0x02));

    expect([...(await t.read(2, 1))]).toEqual([0xfe, 0x02]);
  });

  it('can go silent, including for writes and reads', async () => {
    const t = await opened();

    t.silent = true;
    await t.write(bytes(0x00, 0x00, 0xc0, 0x80, 0x00, 0x00));

    await expect(t.read(1, 1)).rejects.toThrow(TimeoutError);
  });

  it('can fail writes', async () => {
    const t = await opened();

    t.failWrites = true;

    await expect(t.write(bytes(1))).rejects.toThrow('Simulated write failure');
  });

  it('can refuse memory writes but still answer reads', async () => {
    const t = await opened();

    t.memory[0x1000] = 0x5a;
    t.failMemoryWrites = true;
    await t.write(bytes(0x00, 0x1000 >> 6));
    await t.read(2, 1);

    await expect(t.write(bytes(0x80, 0x01))).rejects.toThrow(
      'Simulated memory write failure',
    );
    expect(t.memory[0x1000]).toBe(0x5a);
    expect(t.written).toEqual([0x00, 0x1000 >> 6]);

    await t.write(bytes(0x00, 0x1000 >> 6));
    await t.read(2, 1);
    await t.write(bytes(0xc0));
    expect([...(await t.read(1, 1))]).toEqual([0x5a]);
  });

  it('can limit streamed bytes', async () => {
    const t = await opened();

    t.streamLimit = 2;
    await t.write(bytes(0x0f << 2, 0x00));
    await t.read(2, 1);
    await t.write(bytes(0xc0));

    await expect(t.read(3, 1)).rejects.toThrow(TimeoutError);
  });

  it('rejects operations when closed', async () => {
    const t = new SimulatedTransport();

    await expect(t.write(bytes(1))).rejects.toThrow(NotConnectedError);
    await expect(t.read(1, 1)).rejects.toThrow(NotConnectedError);

    await t.open();
    expect(t.isOpen).toBe(true);
    await t.close();
    expect(t.isOpen).toBe(false);
  });

  it('loads a ROM image into 0xC000..0xFFFF', () => {
    const t = new SimulatedTransport();
    const rom = new Uint8Array(0x4000).fill(0x5a);

    t.loadRom(rom);

    expect(t.memory[0xc000]).toBe(0x5a);
    expect(t.memory[0xffff]).toBe(0x5a);
    expect(t.memory[0xbfff]).toBe(0);
    expect(() => t.loadRom(new Uint8Array(10))).toThrow(RangeError);
  });

  it('records every byte written', async () => {
    const t = await opened();

    await t.write(bytes(1, 2));
    await t.write(bytes(3));

    expect(t.written).toEqual([1, 2, 3]);
  });
});
