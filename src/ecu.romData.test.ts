// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §5.8 (ROM revision detection),
// §5.9 (main voltage), §5.10 (fuel maps and RPM table)
import { DataOffsetRev, InvalidReadingError, TimeoutError } from './index.js';
import { connected, parseWire, setRevision } from './test-support/ecu.js';

const OLD_MAPS = [0xc23f, 0xc351, 0xc463, 0xc575, 0xc687];
const NEW_MAPS = [0xc267, 0xc379, 0xc48b, 0xc59d, 0xc6af];

/** Marks a map so a read from the wrong place is obvious. */
function plantMap(
  memory: Uint8Array,
  offset: number,
  scalerOffset: number,
  marker: number,
) {
  memory.fill(marker, offset, offset + 128);
  memory.set([marker, marker + 1], offset + 128);
  memory[scalerOffset] = marker + 2;
}

describe('Ecu ROM data', () => {
  describe('revision detection (§5.8)', () => {
    it('detects Rev C when any byte of the 16 at 0xC23F exceeds 0x30', async () => {
      const { transport, ecu } = await connected();

      transport.memory.fill(0x10, 0xc23f, 0xc23f + 16);
      transport.memory[0xc23f + 15] = 0x31;
      plantMap(transport.memory, 0xc267, 0xc267 + 0x10a, 0x50);

      expect((await ecu.getFuelMap(1)).rowScaler).toBe(0x52);
    });

    it('does not treat 0x30 as exceeding 0x30', async () => {
      const { transport, ecu } = await connected();

      transport.memory.fill(0x30, 0xc23f, 0xc23f + 16);
      transport.memory[0xc79b] = 0xff;
      // Old layout: map 1 starts at the probe address, so the probe bytes
      // are part of its data.
      transport.memory[0xc23f + 0x10a] = 0x77;

      expect((await ecu.getFuelMap(1)).rowScaler).toBe(0x77);
    });

    it('detects the revision once per connection', async () => {
      const { transport, ecu } = await connected();

      setRevision(transport, DataOffsetRev.RevC);
      await ecu.getFuelMap(1);
      transport.written.length = 0;
      await ecu.getFuelMap(1);

      const probes = parseWire(transport.written).filter(
        (command) =>
          command.kind === 'coarse' &&
          command.lengthCode === 15 &&
          command.address === (0xc23f & ~0x3f),
      );

      expect(probes).toHaveLength(0);
    });

    it('fails, and detects again next time, when the probe read fails', async () => {
      const { transport, ecu } = await connected();

      // Cut the 16-byte probe short; the command itself completes, so the
      // ECU is left ready for the next one.
      transport.streamLimit = 1;
      await expect(ecu.getFuelMap(1)).rejects.toThrow(TimeoutError);

      transport.streamLimit = undefined;
      setRevision(transport, DataOffsetRev.RevC);
      plantMap(transport.memory, 0xc267, 0xc267 + 0x10a, 0x50);

      expect((await ecu.getFuelMap(1)).rowScaler).toBe(0x52);
    });
  });

  describe('getMainVoltage (§5.9)', () => {
    // Golden values from libcomm14cux's formula (data.c) with the Rev A
    // coefficients A=0x64, B=0xBD, C=0x6180:
    //   adc = -(16 * (sqrt(4Ay - AC + 64B^2) - 8B)) / A, truncated
    //   volts = 0.07 * adc - 0.09
    it.each([
      [899, 12.51],
      [2492, 6.84],
      [3000, 5.65],
    ])(
      // 0xC79B holds 0xFF on Rev A, so reading A from the ROM would fail these.
      'Rev A uses the fixed coefficients: stored %i is %d V',
      async (stored, volts) => {
        const { transport, ecu } = await connected();

        setRevision(transport, DataOffsetRev.RevA);
        transport.memory.set([stored >> 8, stored & 0xff], 0x0055);

        expect(await ecu.getMainVoltage()).toBeCloseTo(volts, 5);
      },
    );

    it.each([
      [DataOffsetRev.RevB, 0xc79b],
      [DataOffsetRev.RevC, 0xc7c3],
    ])(
      'revision %i reads coefficients A, B, C (2 bytes) from 0x%x',
      async (rev, offset) => {
        const { transport, ecu } = await connected();

        setRevision(transport, rev);
        transport.memory.set([0x64, 0xbd, 0x61, 0x80], offset);
        transport.memory.set([0x03, 0x83], 0x0055);

        expect(await ecu.getMainVoltage()).toBeCloseTo(12.51, 5);
      },
    );

    it('caches the coefficients after the first successful read', async () => {
      const { transport, ecu } = await connected();

      setRevision(transport, DataOffsetRev.RevB);
      transport.memory.set([0x64, 0xbd, 0x61, 0x80], 0xc79b);
      transport.memory.set([0x03, 0x83], 0x0055);
      await ecu.getMainVoltage();
      transport.written.length = 0;
      await ecu.getMainVoltage();

      // Only the voltage read remains, reusing the previous coarse address.
      expect(transport.written).toEqual([0xc0 | (0x0055 & 0x3f)]);
    });

    it.each([
      [[0x00, 0xbd, 0x61, 0x80]],
      [[0x64, 0x00, 0x61, 0x80]],
      [[0x64, 0xbd, 0x00, 0x00]],
    ])(
      'fails, and retries next time, when a coefficient is zero (%j)',
      async (coefficients) => {
        const { transport, ecu } = await connected();

        setRevision(transport, DataOffsetRev.RevB);
        transport.memory.set(coefficients, 0xc79b);

        await expect(ecu.getMainVoltage()).rejects.toThrow(InvalidReadingError);

        transport.memory.set([0x64, 0xbd, 0x61, 0x80], 0xc79b);
        transport.memory.set([0x03, 0x83], 0x0055);

        expect(await ecu.getMainVoltage()).toBeCloseTo(12.51, 5);
      },
    );

    it('rejects a reading that does not fit the coefficients instead of returning NaN (deliberate divergence)', async () => {
      const { transport, ecu } = await connected();

      setRevision(transport, DataOffsetRev.RevB);
      transport.memory.set([0x01, 0x01, 0xff, 0xff], 0xc79b);
      transport.memory.set([0x00, 0x00], 0x0055);

      await expect(ecu.getMainVoltage()).rejects.toThrow(InvalidReadingError);
    });
  });

  describe('getFuelMap (§5.10)', () => {
    it.each([-1, 6, 1.5, Number.NaN])(
      'rejects map id %d without any I/O',
      async (id) => {
        const { transport, ecu } = await connected();

        await expect(ecu.getFuelMap(id)).rejects.toThrow(RangeError);
        expect(transport.written).toHaveLength(0);
      },
    );

    it.each([DataOffsetRev.RevA, DataOffsetRev.RevB, DataOffsetRev.RevC])(
      'reads map 0 from 0xC000 with its scaler at 0xC1C9 for revision %i',
      async (rev) => {
        const { transport, ecu } = await connected();

        setRevision(transport, rev);
        plantMap(transport.memory, 0xc000, 0xc1c9, 0x07);

        const map = await ecu.getFuelMap(0);

        expect(map.data).toEqual(new Uint8Array(128).fill(0x07));
        expect(map.adjustmentFactor).toBe(0x0708);
        expect(map.rowScaler).toBe(0x09);
      },
    );

    it.each(
      [DataOffsetRev.RevA, DataOffsetRev.RevB].flatMap((rev) =>
        OLD_MAPS.map((offset, i) => [rev, i + 1, offset] as const),
      ),
    )(
      'revision %i reads map %i from 0x%x, scaler at +0x10A',
      async (rev, id, offset) => {
        const { transport, ecu } = await connected();

        setRevision(transport, rev);
        plantMap(transport.memory, offset, offset + 0x10a, 0x20 + id);
        // Map 1 contains the revision probe; keep it in the old-layout range.
        transport.memory.fill(0x10, 0xc23f, 0xc23f + 16);

        const map = await ecu.getFuelMap(id);

        expect(map.data.at(-1)).toBe(0x20 + id);
        expect(map.adjustmentFactor).toBe(((0x20 + id) << 8) | (0x21 + id));
        expect(map.rowScaler).toBe(0x22 + id);
      },
    );

    it.each(NEW_MAPS.map((offset, i) => [i + 1, offset] as const))(
      'Rev C reads map %i from 0x%x, scaler at +0x10A',
      async (id, offset) => {
        const { transport, ecu } = await connected();

        setRevision(transport, DataOffsetRev.RevC);
        plantMap(transport.memory, offset, offset + 0x10a, 0x40 + id);

        const map = await ecu.getFuelMap(id);

        expect(map.data).toEqual(new Uint8Array(128).fill(0x40 + id));
        expect(map.adjustmentFactor).toBe(((0x40 + id) << 8) | (0x41 + id));
        expect(map.rowScaler).toBe(0x42 + id);
      },
    );
  });

  describe('getCurrentFuelMap (§5.10)', () => {
    it.each([0, 3, 5])('reads id %i from 0x202C', async (id) => {
      const { transport, ecu } = await connected();

      transport.memory[0x202c] = id;

      expect(await ecu.getCurrentFuelMap()).toBe(id);
    });

    it.each([6, 0xff])('rejects id %i', async (id) => {
      const { transport, ecu } = await connected();

      transport.memory[0x202c] = id;

      await expect(ecu.getCurrentFuelMap()).rejects.toThrow(
        InvalidReadingError,
      );
    });
  });

  describe('getFuelMapRowIndex and getFuelMapColumnIndex (§5.10)', () => {
    it.each([
      [0x00, 0, 0],
      [0x7a, 7, 10],
    ])(
      'splits row byte 0x%x at 0x005B into index %i, weighting %i',
      async (byte, index, weighting) => {
        const { transport, ecu } = await connected();

        transport.memory[0x005b] = byte;

        expect(await ecu.getFuelMapRowIndex()).toEqual({ index, weighting });
      },
    );

    it.each([0x80, 0xff])('rejects row byte 0x%x', async (byte) => {
      const { transport, ecu } = await connected();

      transport.memory[0x005b] = byte;

      await expect(ecu.getFuelMapRowIndex()).rejects.toThrow(
        InvalidReadingError,
      );
    });

    it.each([
      [0x00, 0, 0],
      [0xc5, 12, 5],
      [0xf3, 15, 3],
    ])(
      'splits column byte 0x%x at 0x005C into index %i, weighting %i',
      async (byte, index, weighting) => {
        const { transport, ecu } = await connected();

        transport.memory[0x005c] = byte;

        expect(await ecu.getFuelMapColumnIndex()).toEqual({ index, weighting });
      },
    );
  });

  describe('getRpmTable (§5.10)', () => {
    it('reads sixteen pulse widths at 0xC800 + column * 4, in reverse column order', async () => {
      const { transport, ecu } = await connected();

      for (let column = 0; column < 16; column++) {
        const pulseWidth = 7500 / (column + 1);

        transport.memory.set(
          [pulseWidth >> 8, pulseWidth & 0xff],
          0xc800 + column * 4,
        );
      }

      const table = await ecu.getRpmTable();

      expect(table).toEqual(
        Array.from({ length: 16 }, (_, slot) =>
          Math.trunc(7500000 / Math.trunc(7500 / (16 - slot))),
        ),
      );
      expect(table[15]).toBe(1000);
    });

    it('fails if any entry is a zero pulse width', async () => {
      const { transport, ecu } = await connected();

      for (let column = 0; column < 16; column++) {
        transport.memory.set([0x1d, 0x4c], 0xc800 + column * 4);
      }

      transport.memory.set([0, 0], 0xc800 + 9 * 4);

      await expect(ecu.getRpmTable()).rejects.toThrow(InvalidReadingError);
    });
  });
});
