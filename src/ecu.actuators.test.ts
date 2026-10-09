// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §6 (c14cux_runFuelPump,
// c14cux_driveIdleAirControlMotor)
import { ProtocolError, TimeoutError } from './index.js';
import { connected } from './test-support/ecu.js';

describe('Ecu actuators', () => {
  describe('runFuelPump', () => {
    it('reads port 1, writes 0xFF to the timer, then clears bit 6 of port 1', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x0002] = 0xff;
      await ecu.runFuelPump();

      expect(transport.memory[0x00af]).toBe(0xff);
      expect(transport.memory[0x0002]).toBe(0xbf);
    });

    it('writes nothing when the initial read fails', async () => {
      const { transport, ecu } = await connected();

      transport.silent = true;

      await expect(ecu.runFuelPump()).rejects.toThrow(TimeoutError);
      expect(transport.memory[0x00af]).toBe(0);
    });

    it('writes nothing when the first write fails', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x0002] = 0xff;
      transport.failMemoryWritesAfter = 0;

      await expect(ecu.runFuelPump()).rejects.toThrow(TimeoutError);
      expect(transport.memory[0x00af]).toBe(0);
      expect(transport.memory[0x0002]).toBe(0xff);
    });

    it('sets the timer but leaves port 1 when the second write fails', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x0002] = 0xff;
      transport.failMemoryWritesAfter = 1;

      await expect(ecu.runFuelPump()).rejects.toThrow(TimeoutError);
      expect(transport.memory[0x00af]).toBe(0xff);
      expect(transport.memory[0x0002]).toBe(0xff);
      expect(await ecu.getFuelPumpRelayState()).toBe(false);
    });
  });

  describe('driveIdleAirControlMotor', () => {
    it('writes nothing when the direction write fails', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x008a] = 0x10;
      transport.failMemoryWritesAfter = 0;

      await expect(ecu.driveIdleAirControlMotor(1, 20)).rejects.toThrow(
        TimeoutError,
      );
      expect(transport.memory[0x008a]).toBe(0x10);
      expect(transport.memory[0x0075]).toBe(0);
    });

    it('sets the direction but not the step count when the second write fails', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x008a] = 0x10;
      transport.failMemoryWritesAfter = 1;

      await expect(ecu.driveIdleAirControlMotor(1, 20)).rejects.toThrow(
        TimeoutError,
      );
      expect(transport.memory[0x008a]).toBe(0x11);
      expect(transport.memory[0x0075]).toBe(0);
    });

    it('direction 0 clears bit 0 of 0x008A, then writes the step count', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x008a] = 0xff;
      await ecu.driveIdleAirControlMotor(0, 12);

      expect(transport.memory[0x008a]).toBe(0xfe);
      expect(transport.memory[0x0075]).toBe(12);
    });

    it.each([1, 2, -1])(
      'direction %i sets bit 0 and preserves the other bits',
      async (direction) => {
        const { transport, ecu } = await connected();

        transport.memory[0x008a] = 0x10;
        await ecu.driveIdleAirControlMotor(direction, 3);

        expect(transport.memory[0x008a]).toBe(0x11);
        expect(transport.memory[0x0075]).toBe(3);
      },
    );

    it.each([-1, 256, 1.5, Number.NaN])(
      'rejects step count %d without any I/O',
      async (steps) => {
        const { transport, ecu } = await connected();

        transport.memory[0x008a] = 0xff;

        await expect(ecu.driveIdleAirControlMotor(0, steps)).rejects.toThrow(
          RangeError,
        );
        expect(transport.written).toHaveLength(0);
        expect(transport.memory[0x008a]).toBe(0xff);
      },
    );

    it.each([0, 255])('accepts step count %i', async (steps) => {
      const { transport, ecu } = await connected();

      transport.memory[0x0075] = 0x42;
      await ecu.driveIdleAirControlMotor(0, steps);

      expect(transport.memory[0x0075]).toBe(steps);
    });

    it('writes nothing when the read fails', async () => {
      const { transport, ecu } = await connected();

      transport.silent = true;

      await expect(ecu.driveIdleAirControlMotor(0, 5)).rejects.toThrow(
        TimeoutError,
      );
      expect(transport.memory[0x0075]).toBe(0);
    });

    it('fails when a write fails (deliberate divergence: C ignores write results)', async () => {
      const { transport, ecu } = await connected();
      const write = transport.write.bind(transport);
      let writes = 0;

      transport.memory[0x008a] = 0x01;

      transport.write = (data) => {
        // Writes 1-3 are the read; corrupt the echo of the first write.
        if (++writes === 4) {
          transport.corruptNextEcho = true;
        }

        return write(data);
      };

      await expect(ecu.driveIdleAirControlMotor(0, 5)).rejects.toThrow(
        ProtocolError,
      );
      expect(transport.memory[0x0075]).toBe(0);
    });
  });
});
