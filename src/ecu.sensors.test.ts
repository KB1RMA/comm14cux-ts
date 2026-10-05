// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §5.1-5.7, §5.11, §5.15
import {
  AirflowType,
  Bank,
  Gear,
  InvalidReadingError,
  ThrottlePosType,
  TimeoutError,
} from './index.js';
import { connected } from './test-support/ecu.js';

const word = (value: number) => [value >> 8, value & 0xff];

describe('Ecu sensor readings', () => {
  describe('getCoolantTemp and getFuelTemp (§5.1)', () => {
    it.each([
      [0, 266],
      [1, 264],
      [127, 82],
      [128, 82],
      [200, 29],
      [254, -13],
      [255, -13],
    ])('map ADC count %i to %i °F', async (count, degrees) => {
      const { transport, ecu } = await connected();

      transport.memory[0x006a] = count;
      transport.memory[0x2006] = count;

      expect(await ecu.getCoolantTemp()).toBe(degrees);
      expect(await ecu.getFuelTemp()).toBe(degrees);
    });

    it('never rises as the ADC count rises, over all 256 counts', async () => {
      const { transport, ecu } = await connected();
      const temps: number[] = [];

      for (let count = 0; count < 256; count++) {
        transport.memory[0x006a] = count;
        temps.push(await ecu.getCoolantTemp());
      }

      expect(temps.every((t, i) => i === 0 || t <= (temps[i - 1] ?? t))).toBe(
        true,
      );
    });
  });

  describe('getRoadSpeed (§5.2)', () => {
    it.each([
      [0, 0],
      [1, 0],
      [2, 1],
      [100, 62],
      [160, 99],
      [255, 158],
    ])('converts %i km/h at 0x2003 to %i mph (truncated)', async (kph, mph) => {
      const { transport, ecu } = await connected();

      transport.memory[0x2003] = kph;

      expect(await ecu.getRoadSpeed()).toBe(mph);
    });
  });

  describe('getMAFReading (§5.3)', () => {
    it.each([
      [0, 0],
      [511, 511 / 1023],
      [1023, 1],
    ])('direct: decodes %i at 0x0057 as %d', async (raw, expected) => {
      const { transport, ecu } = await connected();

      transport.memory.set(word(raw), 0x0057);

      expect(await ecu.getMAFReading(AirflowType.Direct)).toBeCloseTo(
        expected,
        10,
      );
    });

    it('direct: rejects readings above 1023', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set(word(1024), 0x0057);

      await expect(ecu.getMAFReading(AirflowType.Direct)).rejects.toThrow(
        InvalidReadingError,
      );
    });

    it.each([
      [0, 0],
      [8645, 0.5],
      [17290, 1],
    ])('linearized: decodes %i at 0x204D as %d', async (raw, expected) => {
      const { transport, ecu } = await connected();

      transport.memory.set(word(raw), 0x204d);

      expect(await ecu.getMAFReading(AirflowType.Linearized)).toBeCloseTo(
        expected,
        10,
      );
    });

    it('linearized: rejects readings above 17290', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set(word(17291), 0x204d);

      await expect(ecu.getMAFReading(AirflowType.Linearized)).rejects.toThrow(
        InvalidReadingError,
      );
    });
  });

  describe('getIdleBypassMotorPosition and getTargetIdle (§5.4)', () => {
    it.each([
      [0, 1],
      [90, 0.5],
      [180, 0],
      [181, 0],
      [255, 0],
    ])('decodes idle bypass %i at 0x006D as %d', async (raw, expected) => {
      const { transport, ecu } = await connected();

      transport.memory[0x006d] = raw;

      expect(await ecu.getIdleBypassMotorPosition()).toBeCloseTo(expected, 10);
    });

    it('reads the target idle as a big-endian word at 0x2051', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set(word(800), 0x2051);

      expect(await ecu.getTargetIdle()).toBe(800);
    });
  });

  describe('getEngineRPM and getRPMLimit (§5.5)', () => {
    it.each([
      [7500, 1000],
      [1, 7500000],
      [3000, 2500],
      [7501, 999],
      [0xfffe, 114],
    ])('convert pulse width %i to %i RPM (truncated)', async (pw, rpm) => {
      const { transport, ecu } = await connected();

      transport.memory.set(word(pw), 0x007c);
      transport.memory.set(word(pw), 0x200c);

      expect(await ecu.getEngineRPM()).toBe(rpm);
      expect(await ecu.getRPMLimit()).toBe(rpm);
    });

    it('treats 0xFFFF as 0 RPM for the engine speed only', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set(word(0xffff), 0x007c);
      transport.memory.set(word(0xffff), 0x200c);

      expect(await ecu.getEngineRPM()).toBe(0);
      expect(await ecu.getRPMLimit()).toBe(114);
    });

    it('rejects a pulse width of 0 (deliberate divergence: C divides by zero)', async () => {
      const { ecu } = await connected();

      await expect(ecu.getEngineRPM()).rejects.toThrow(InvalidReadingError);
      await expect(ecu.getRPMLimit()).rejects.toThrow(InvalidReadingError);
    });
  });

  describe('getThrottlePosition (§5.6)', () => {
    async function throttle(raw: number, minimum: number) {
      const setup = await connected();

      setup.transport.memory.set(word(raw), 0x005f);
      setup.transport.memory.set(word(minimum), 0x0051);

      return setup;
    }

    it.each([
      [0, 0],
      [511, 511 / 1023],
      [1023, 1],
    ])('absolute: decodes %i as %d', async (raw, expected) => {
      const { ecu } = await throttle(raw, 0x40);

      expect(
        await ecu.getThrottlePosition(ThrottlePosType.Absolute),
      ).toBeCloseTo(expected, 10);
    });

    it.each([
      [0x140, 0x40, 256 / 959],
      [0x40, 0x40, 0],
      [1023, 0x40, 1],
      [10, 0x40, 0],
      [1023, 1023, 0],
    ])(
      'corrected: decodes %i with minimum %i as %d (clamped at 0, no division by zero)',
      async (raw, minimum, expected) => {
        const { ecu } = await throttle(raw, minimum);

        expect(
          await ecu.getThrottlePosition(ThrottlePosType.Corrected),
        ).toBeCloseTo(expected, 10);
      },
    );

    it('rejects readings above 1023 before reading the minimum', async () => {
      const { transport, ecu } = await throttle(1024, 0);

      await expect(
        ecu.getThrottlePosition(ThrottlePosType.Corrected),
      ).rejects.toThrow(InvalidReadingError);
      expect(transport.written).toHaveLength(3);
    });

    it('fails when the minimum cannot be read', async () => {
      const { transport, ecu } = await throttle(0x100, 0);
      const read = transport.read.bind(transport);

      transport.read = async (length, timeout) => {
        if (transport.written.includes(0xc0 | (0x51 & 0x3f))) {
          throw new TimeoutError('silent');
        }

        return read(length, timeout);
      };

      await expect(
        ecu.getThrottlePosition(ThrottlePosType.Corrected),
      ).rejects.toThrow(TimeoutError);
    });
  });

  describe('getGearSelection (§5.7)', () => {
    it.each([
      [0x00, Gear.ParkOrNeutral],
      [0x4c, Gear.ParkOrNeutral],
      [0x4d, Gear.ManualGearbox],
      [0x80, Gear.ManualGearbox],
      [0xb3, Gear.ManualGearbox],
      [0xb4, Gear.DriveOrReverse],
      [0xff, Gear.DriveOrReverse],
    ])('decodes 0x%x at 0x2000 as gear %i', async (adc, gear) => {
      const { transport, ecu } = await connected();

      transport.memory[0x2000] = adc;

      expect(await ecu.getGearSelection()).toBe(gear);
    });
  });

  describe('lambda and CO trims (§5.11)', () => {
    it.each([
      [0x0000, -256],
      [0x007f, -256],
      [0x0080, -255],
      [0x8000, 0],
      [0x8080, 1],
      [0xffff, 255],
    ])('decode raw 0x%x as %i counts', async (raw, counts) => {
      const { transport, ecu } = await connected();

      transport.memory.set(word(raw), 0x0065);
      transport.memory.set(word(raw), 0x0042);

      expect(await ecu.getLambdaTrimShort(Bank.Odd)).toBe(counts);
      expect(await ecu.getLambdaTrimLong(Bank.Odd)).toBe(counts);
    });

    it('read 0x0065/0x0067 (short) and 0x0042/0x0046 (long) by bank', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set(word(0x0000), 0x0065);
      transport.memory.set(word(0xffff), 0x0067);
      transport.memory.set(word(0x8000), 0x0042);
      transport.memory.set(word(0x8080), 0x0046);

      expect(await ecu.getLambdaTrimShort(Bank.Odd)).toBe(-256);
      expect(await ecu.getLambdaTrimShort(Bank.Even)).toBe(255);
      expect(await ecu.getLambdaTrimLong(Bank.Odd)).toBe(0);
      expect(await ecu.getLambdaTrimLong(Bank.Even)).toBe(1);
    });

    it.each([
      [0x0000, 0],
      [0x8000, 1.25],
      [0xffff, (5 * 511) / 1024],
    ])(
      'decode the CO trim voltage from 0x0046 raw 0x%x as %d V',
      async (raw, volts) => {
        const { transport, ecu } = await connected();

        transport.memory.set(word(raw), 0x0046);

        expect(await ecu.getCOTrimVoltage()).toBeCloseTo(volts, 10);
      },
    );
  });

  describe('getInjectorPulseWidth (§5.15)', () => {
    it('reads a big-endian word at 0x0082', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set(word(3000), 0x0082);

      expect(await ecu.getInjectorPulseWidth()).toBe(3000);
    });
  });
});
