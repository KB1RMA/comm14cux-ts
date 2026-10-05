// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: docs/test-specification.md §5.12 (fault codes), §5.13 (flags),
// §5.14 (tune revision)
import { type FaultCodeName, PurgeValveState } from './index.js';
import { connected } from './test-support/ecu.js';

const FAULT_BITS: [number, number, FaultCodeName][] = [
  [0, 0, 'romChecksumFailure'],
  [0, 1, 'lambdaSensorOdd'],
  [0, 2, 'lambdaSensorEven'],
  [0, 4, 'misfireOddBank'],
  [0, 5, 'misfireEvenBank'],
  [0, 6, 'airflowMeter'],
  [0, 7, 'tuneResistorOutOfRange'],
  [1, 0, 'injectorOddBank'],
  [1, 2, 'injectorEvenBank'],
  [1, 3, 'coolantTempSensor'],
  [1, 4, 'throttlePot'],
  [1, 5, 'throttlePotHiMafLo'],
  [1, 6, 'throttlePotLoMafHi'],
  [1, 7, 'purgeValveLeak'],
  [2, 1, 'mixtureTooLean'],
  [2, 3, 'intakeAirLeak'],
  [3, 0, 'lowFuelPressure'],
  [3, 4, 'idleValveStepperMotor'],
  [3, 6, 'roadSpeedSensor'],
  [3, 7, 'neutralSwitch'],
  [4, 4, 'lowFuelPressureOrAirLeak'],
  [4, 5, 'fuelTempSensor'],
  [5, 6, 'batteryDisconnected'],
  [5, 7, 'ramChecksumFailure'],
];

describe('Ecu status', () => {
  describe('getFaultCodes (§5.12)', () => {
    it('reports exactly the 24 named faults, none set for all-zero memory', async () => {
      const { ecu } = await connected();
      const codes = await ecu.getFaultCodes();

      expect(Object.keys(codes).sort()).toEqual(
        FAULT_BITS.map(([, , name]) => name).sort(),
      );
      expect(Object.values(codes)).not.toContain(true);
    });

    it.each(FAULT_BITS)(
      'byte 0x%i bit %i sets only %s',
      async (byte, bit, name) => {
        const { transport, ecu } = await connected();

        transport.memory[0x0049 + byte] = 1 << bit;

        const codes = await ecu.getFaultCodes();

        expect(codes[name]).toBe(true);
        expect(Object.values(codes).filter(Boolean)).toHaveLength(1);
      },
    );

    it('ignores spare bits and the bytes either side of the block', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x0048] = 0xff;
      transport.memory.set([0x08, 0x02, 0xf5, 0x2e, 0xcf, 0x3f], 0x0049);
      transport.memory[0x004f] = 0xff;

      expect(Object.values(await ecu.getFaultCodes())).not.toContain(true);
    });

    it('decodes several simultaneous faults', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x03, 0, 0, 0, 0, 0xc0], 0x0049);

      const codes = await ecu.getFaultCodes();

      expect(
        Object.entries(codes)
          .filter(([, set]) => set)
          .map(([n]) => n),
      ).toEqual([
        'romChecksumFailure',
        'lambdaSensorOdd',
        'batteryDisconnected',
        'ramChecksumFailure',
      ]);
    });
  });

  describe('clearFaultCodes (§5.12)', () => {
    it('writes zero to the six bytes of the block only', async () => {
      const { transport, ecu } = await connected();

      transport.memory.fill(0xff, 0x0048, 0x0050);
      await ecu.clearFaultCodes();

      expect([...transport.memory.slice(0x0048, 0x0050)]).toEqual([
        0xff, 0, 0, 0, 0, 0, 0, 0xff,
      ]);
    });

    it('stops at the first failed write, leaving the codes partly cleared', async () => {
      const { transport, ecu } = await connected();
      const write = transport.write.bind(transport);
      let valueWrites = 0;

      transport.write = (data) => {
        // A value byte follows a 0x8_ write command.
        if ((transport.written.at(-1) ?? 0) >= 0x80 && ++valueWrites === 3) {
          return Promise.reject(new Error('stop'));
        }

        return write(data);
      };

      transport.memory.fill(0xff, 0x0049, 0x004f);

      await expect(ecu.clearFaultCodes()).rejects.toThrow('stop');
      expect([...transport.memory.slice(0x0049, 0x004f)]).toEqual([
        0, 0, 0xff, 0xff, 0xff, 0xff,
      ]);
    });
  });

  describe('flags (§5.13)', () => {
    it.each([
      [0x00, true],
      [0xbf, true],
      [0x40, false],
    ])(
      'getFuelPumpRelayState: port 1 = 0x%x -> %s (on when bit 6 is clear)',
      async (port1, on) => {
        const { transport, ecu } = await connected();

        transport.memory[0x0002] = port1;

        expect(await ecu.getFuelPumpRelayState()).toBe(on);
      },
    );

    it.each([
      [0xfe, true],
      [0x01, false],
    ])(
      'isMILOn: port 1 = 0x%x -> %s (lit when bit 0 is clear)',
      async (port1, on) => {
        const { transport, ecu } = await connected();

        transport.memory[0x0002] = port1;

        expect(await ecu.isMILOn()).toBe(on);
      },
    );

    it.each([
      [0x01, true],
      [0xfe, false],
    ])(
      'getIdleMode: 0x2047 = 0x%x -> %s (on when bit 0 is set)',
      async (byte, on) => {
        const { transport, ecu } = await connected();

        transport.memory[0x2047] = byte;

        expect(await ecu.getIdleMode()).toBe(on);
      },
    );

    it.each([
      [0xfb, true],
      [0x04, false],
    ])(
      'getScreenHeaterState: 0x00DD = 0x%x -> %s (on when bit 2 is clear)',
      async (byte, on) => {
        const { transport, ecu } = await connected();

        transport.memory[0x00dd] = byte;

        expect(await ecu.getScreenHeaterState()).toBe(on);
      },
    );

    it.each([
      [0xf7, true],
      [0x08, false],
    ])(
      'getACCompressorState: 0x008A = 0x%x -> %s (on when bit 3 is clear)',
      async (byte, on) => {
        const { transport, ecu } = await connected();

        transport.memory[0x008a] = byte;

        expect(await ecu.getACCompressorState()).toBe(on);
      },
    );

    it.each([
      [0, PurgeValveState.Closed],
      [3999, PurgeValveState.Closed],
      [4000, PurgeValveState.Toggling],
      [28999, PurgeValveState.Toggling],
      [29000, PurgeValveState.Open],
      [0xffff, PurgeValveState.Open],
    ])(
      'getPurgeValveState: timer %i at 0x0096 is state %i',
      async (timer, state) => {
        const { transport, ecu } = await connected();

        transport.memory.set([timer >> 8, timer & 0xff], 0x0096);

        expect(await ecu.getPurgeValveState()).toBe(state);
      },
    );
  });

  describe('getTuneRevision (§5.14)', () => {
    it('reads the BCD tune number, checksum fixer and big-endian ident at 0xFFE9', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x36, 0x52, 0xa5, 0x12, 0x34], 0xffe9);

      expect(await ecu.getTuneRevision()).toEqual({
        tuneNumber: 3652,
        checksumFixer: 0xa5,
        tuneIdent: 0x1234,
      });
    });

    it.each([
      [0x00, 0x00, 0],
      [0x00, 0x09, 9],
      [0x99, 0x99, 9999],
    ])('decodes BCD 0x%x 0x%x as %i', async (high, low, tuneNumber) => {
      const { transport, ecu } = await connected();

      transport.memory.set([high, low], 0xffe9);

      expect((await ecu.getTuneRevision()).tuneNumber).toBe(tuneNumber);
    });
  });
});
