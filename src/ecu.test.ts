// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §6 (public Ecu API, one section per libcomm14cux function)
import { readFileSync } from 'node:fs';
import {
  AirflowType,
  Bank,
  DataOffsetRev,
  Gear,
  PurgeValveState,
  ThrottlePosType,
} from './constants.js';
import { Ecu } from './ecu.js';
import {
  InvalidReadingError,
  NotConnectedError,
  ReadCancelledError,
  TimeoutError,
} from './errors.js';
import { SimulatedTransport } from './transport/simulated.js';

async function connected() {
  const transport = new SimulatedTransport();
  const ecu = new Ecu(transport, { readTimeoutMs: 5 });

  await ecu.connect();

  return { transport, ecu };
}

/** Sets memory so that the ROM looks like the given data layout. */
function setRevision(transport: SimulatedTransport, rev: DataOffsetRev) {
  if (rev === DataOffsetRev.RevC) {
    transport.memory[0xc23f] = 0x40;
  } else {
    transport.memory.fill(0x10, 0xc23f, 0xc23f + 16);
    transport.memory[0xc79b] = rev === DataOffsetRev.RevA ? 0xff : 0x64;
  }
}

describe('Ecu', () => {
  describe('connection', () => {
    it('is not connected after construction, and rejects operations', async () => {
      const ecu = new Ecu(new SimulatedTransport());

      expect(ecu.isConnected()).toBe(false);
      await expect(ecu.getRoadSpeed()).rejects.toThrow(NotConnectedError);
      await expect(ecu.readMem(0, 1)).rejects.toThrow(NotConnectedError);
    });

    it('connects by opening the transport, once', async () => {
      const transport = new SimulatedTransport();
      const open = vi.spyOn(transport, 'open');
      const ecu = new Ecu(transport);

      await ecu.connect();
      await ecu.connect();

      expect(ecu.isConnected()).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('stays disconnected when the transport cannot open', async () => {
      const transport = new SimulatedTransport();
      const ecu = new Ecu(transport);

      vi.spyOn(transport, 'open').mockRejectedValueOnce(new Error('no port'));

      await expect(ecu.connect()).rejects.toThrow('no port');
      expect(ecu.isConnected()).toBe(false);
    });

    it('disconnects by closing the transport, and is a no-op when not connected', async () => {
      const { transport, ecu } = await connected();
      const close = vi.spyOn(transport, 'close');

      await ecu.disconnect();
      await ecu.disconnect();

      expect(ecu.isConnected()).toBe(false);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('forgets the ROM revision and voltage factors on reconnect', async () => {
      const { transport, ecu } = await connected();

      setRevision(transport, DataOffsetRev.RevC);
      await ecu.getFuelMap(1);
      await ecu.disconnect();
      await ecu.connect();
      setRevision(transport, DataOffsetRev.RevB);
      transport.memory.fill(0, 0xc23f, 0xc23f + 16);
      await ecu.getFuelMap(1);

      expect([...transport.written].length).toBeGreaterThan(0);
      expect((await ecu.getFuelMap(1)).data).toEqual(
        transport.memory.slice(0xc23f, 0xc23f + 128),
      );
    });

    it('reports the library version, matching package.json', () => {
      const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
        version: string;
      };
      const { major, minor, patch } = Ecu.getLibraryVersion();

      expect(`${major}.${minor}.${patch}`).toBe(pkg.version);
    });
  });

  describe('raw access (c14cux_readMem, c14cux_writeMem, c14cux_dumpROM)', () => {
    it('readMem returns the requested bytes', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([1, 2, 3], 0x1000);

      expect([...(await ecu.readMem(0x1000, 3))]).toEqual([1, 2, 3]);
    });

    it('writeMem writes one byte', async () => {
      const { transport, ecu } = await connected();

      await ecu.writeMem(0x1000, 0x42);

      expect(transport.memory[0x1000]).toBe(0x42);
    });

    it('dumpROM returns the 0x4000 byte ROM image', async () => {
      const { transport, ecu } = await connected();
      const rom = Uint8Array.from({ length: 0x4000 }, (_, i) => (i * 3) & 0xff);

      transport.loadRom(rom);

      expect(await ecu.dumpROM()).toEqual(rom);
    });

    it('cancelRead stops a ROM dump', async () => {
      const { transport, ecu } = await connected();
      const read = transport.read.bind(transport);
      let calls = 0;

      transport.read = async (length, timeout) => {
        if (++calls === 3) {
          ecu.cancelRead();
        }

        return read(length, timeout);
      };

      await expect(ecu.dumpROM()).rejects.toThrow(ReadCancelledError);
    });
  });

  describe('simple readings', () => {
    it('getRoadSpeed converts the km/h byte at 0x2003 to mph', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x2003] = 100;

      expect(await ecu.getRoadSpeed()).toBe(62);
    });

    it('getCoolantTemp reads 0x006A through the temperature table', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x006a] = 0;

      expect(await ecu.getCoolantTemp()).toBe(266);
    });

    it('getFuelTemp reads 0x2006 through the temperature table', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x2006] = 255;

      expect(await ecu.getFuelTemp()).toBe(-13);
    });

    it('getMAFReading reads the direct and linearized locations', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x03, 0xff], 0x0057);
      transport.memory.set([0x43, 0x8a], 0x204d);

      expect(await ecu.getMAFReading(AirflowType.Direct)).toBe(1);
      expect(await ecu.getMAFReading(AirflowType.Linearized)).toBe(1);
    });

    it('getMAFReading rejects out-of-range readings', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x04, 0x00], 0x0057);

      await expect(ecu.getMAFReading(AirflowType.Direct)).rejects.toThrow(
        InvalidReadingError,
      );
    });

    it('getEngineRPM treats 0xFFFF as stopped, and converts other pulse widths', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0xff, 0xff], 0x007c);
      expect(await ecu.getEngineRPM()).toBe(0);

      transport.memory.set([0x1d, 0x4c], 0x007c);
      expect(await ecu.getEngineRPM()).toBe(1000);
    });

    it('getRPMLimit converts the pulse width at 0x200C', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x0b, 0xb8], 0x200c);

      expect(await ecu.getRPMLimit()).toBe(2500);
    });

    it('getTargetIdle reads a big-endian word at 0x2051', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x03, 0x20], 0x2051);

      expect(await ecu.getTargetIdle()).toBe(800);
    });

    it('getThrottlePosition reads absolute and corrected values', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x01, 0x40], 0x005f);
      transport.memory.set([0x00, 0x40], 0x0051);

      expect(
        await ecu.getThrottlePosition(ThrottlePosType.Absolute),
      ).toBeCloseTo(0x140 / 1023, 10);
      expect(
        await ecu.getThrottlePosition(ThrottlePosType.Corrected),
      ).toBeCloseTo(256 / 959, 10);
    });

    it('getThrottlePosition rejects readings above 1023 before reading the minimum', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x04, 0x00], 0x005f);
      transport.written.length = 0;

      await expect(
        ecu.getThrottlePosition(ThrottlePosType.Corrected),
      ).rejects.toThrow(InvalidReadingError);
      expect(transport.written).toHaveLength(3);
    });

    it('getThrottlePosition fails when the minimum cannot be read', async () => {
      const { transport, ecu } = await connected();
      const read = transport.read.bind(transport);

      transport.memory.set([0x01, 0x00], 0x005f);

      transport.read = async (length, timeout) => {
        if (
          transport.written.some((_, i, w) => w[i] === 0xc0 + (0x51 & 0x3f))
        ) {
          throw new TimeoutError('silent');
        }

        return read(length, timeout);
      };

      await expect(
        ecu.getThrottlePosition(ThrottlePosType.Corrected),
      ).rejects.toThrow(TimeoutError);
    });

    it('getGearSelection decodes 0x2000', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x2000] = 0x10;
      expect(await ecu.getGearSelection()).toBe(Gear.ParkOrNeutral);

      transport.memory[0x2000] = 0x80;
      expect(await ecu.getGearSelection()).toBe(Gear.ManualGearbox);

      transport.memory[0x2000] = 0xc0;
      expect(await ecu.getGearSelection()).toBe(Gear.DriveOrReverse);
    });

    it('getIdleBypassMotorPosition decodes 0x006D', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x006d] = 90;

      expect(await ecu.getIdleBypassMotorPosition()).toBe(0.5);
    });

    it('getInjectorPulseWidth reads a big-endian word at 0x0082', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x0b, 0xb8], 0x0082);

      expect(await ecu.getInjectorPulseWidth()).toBe(3000);
    });
  });

  describe('fuel trims', () => {
    it('getLambdaTrimShort reads 0x0065 (odd) and 0x0067 (even)', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x00, 0x00], 0x0065);
      transport.memory.set([0xff, 0xff], 0x0067);

      expect(await ecu.getLambdaTrimShort(Bank.Odd)).toBe(-256);
      expect(await ecu.getLambdaTrimShort(Bank.Even)).toBe(255);
    });

    it('getLambdaTrimLong reads 0x0042 (odd) and 0x0046 (even)', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x80, 0x00], 0x0042);
      transport.memory.set([0xff, 0xff], 0x0046);

      expect(await ecu.getLambdaTrimLong(Bank.Odd)).toBe(0);
      expect(await ecu.getLambdaTrimLong(Bank.Even)).toBe(255);
    });

    it('getCOTrimVoltage reads the even-bank long-term trim location', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x80, 0x00], 0x0046);

      expect(await ecu.getCOTrimVoltage()).toBeCloseTo(1.25, 10);
    });
  });

  describe('getMainVoltage', () => {
    it('uses the fixed Rev A coefficients without reading them', async () => {
      const { transport, ecu } = await connected();

      setRevision(transport, DataOffsetRev.RevA);
      transport.memory.set([0x03, 0x83], 0x0055);

      expect(await ecu.getMainVoltage()).toBeCloseTo(12.51, 5);
    });

    it('reads Rev B coefficients from 0xC79B..0xC79E', async () => {
      const { transport, ecu } = await connected();

      setRevision(transport, DataOffsetRev.RevB);
      transport.memory.set([0x64, 0xbd, 0x61, 0x80], 0xc79b);
      transport.memory.set([0x03, 0x83], 0x0055);

      expect(await ecu.getMainVoltage()).toBeCloseTo(12.51, 5);
    });

    it('reads Rev C coefficients from 0xC7C3..0xC7C6', async () => {
      const { transport, ecu } = await connected();

      setRevision(transport, DataOffsetRev.RevC);
      transport.memory.set([0x64, 0xbd, 0x61, 0x80], 0xc7c3);
      transport.memory.set([0x03, 0x83], 0x0055);

      expect(await ecu.getMainVoltage()).toBeCloseTo(12.51, 5);
    });

    it('caches the coefficients after the first successful read', async () => {
      const { transport, ecu } = await connected();

      setRevision(transport, DataOffsetRev.RevA);
      transport.memory.set([0x03, 0x83], 0x0055);
      await ecu.getMainVoltage();
      transport.written.length = 0;
      await ecu.getMainVoltage();

      // Only the voltage read remains, and it reuses the coarse address of
      // the previous read (same length, within the 64-byte window).
      expect(transport.written).toEqual([0xc0 | (0x0055 & 0x3f)]);
    });

    it('fails, and retries next time, when the ECU reports zero coefficients', async () => {
      const { transport, ecu } = await connected();

      setRevision(transport, DataOffsetRev.RevB);

      await expect(ecu.getMainVoltage()).rejects.toThrow(InvalidReadingError);

      transport.memory.set([0x64, 0xbd, 0x61, 0x80], 0xc79b);
      transport.memory.set([0x03, 0x83], 0x0055);

      expect(await ecu.getMainVoltage()).toBeCloseTo(12.51, 5);
    });
  });

  describe('fuel maps', () => {
    it('getFuelMap rejects invalid ids without any I/O', async () => {
      const { transport, ecu } = await connected();

      await expect(ecu.getFuelMap(6)).rejects.toThrow(RangeError);
      await expect(ecu.getFuelMap(-1)).rejects.toThrow(RangeError);
      expect(transport.written).toHaveLength(0);
    });

    it('getFuelMap 0 reads data, adjustment factor and scaler', async () => {
      const { transport, ecu } = await connected();

      setRevision(transport, DataOffsetRev.RevC);
      transport.memory[0xc23f] = 0x40;
      transport.memory.fill(0, 0xc000, 0xc080);
      transport.memory.fill(7, 0xc000, 0xc010);
      transport.memory.set([0x12, 0x34], 0xc080);
      transport.memory[0xc1c9] = 0x99;

      const map = await ecu.getFuelMap(0);

      expect(map.data).toHaveLength(128);
      expect(map.data[0]).toBe(7);
      expect(map.adjustmentFactor).toBe(0x1234);
      expect(map.rowScaler).toBe(0x99);
    });

    it.each([
      [DataOffsetRev.RevA, 0xc351],
      [DataOffsetRev.RevB, 0xc351],
      [DataOffsetRev.RevC, 0xc379],
    ])('getFuelMap 2 for revision %i is at 0x%x', async (rev, offset) => {
      const { transport, ecu } = await connected();

      setRevision(transport, rev);
      transport.memory.fill(0x11, offset, offset + 128);
      transport.memory.set([0xab, 0xcd], offset + 128);
      transport.memory[offset + 0x10a] = 0x55;

      const map = await ecu.getFuelMap(2);

      expect(map.data[127]).toBe(0x11);
      expect(map.adjustmentFactor).toBe(0xabcd);
      expect(map.rowScaler).toBe(0x55);
    });

    it('getFuelMap fails when revision detection fails', async () => {
      const { transport, ecu } = await connected();

      transport.silent = true;

      await expect(ecu.getFuelMap(1)).rejects.toThrow(TimeoutError);
    });

    it('detects the revision once', async () => {
      const { transport, ecu } = await connected();

      setRevision(transport, DataOffsetRev.RevC);
      await ecu.getFuelMap(1);
      transport.written.length = 0;
      await ecu.getFuelMap(1);

      // No coarse-address command for the 16-byte probe at 0xC23F.
      const probe = [(15 << 2) | (0xc23f >> 14), (0xc23f >> 6) & 0xff];

      expect(transport.written.join()).not.toContain(probe.join());
    });

    it('getCurrentFuelMap reads 0x202C and rejects ids above 5', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x202c] = 4;
      expect(await ecu.getCurrentFuelMap()).toBe(4);

      transport.memory[0x202c] = 6;
      await expect(ecu.getCurrentFuelMap()).rejects.toThrow(
        InvalidReadingError,
      );
    });

    it('getFuelMapRowIndex and ColumnIndex split nibbles', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x005b] = 0x73;
      transport.memory[0x005c] = 0xc5;

      expect(await ecu.getFuelMapRowIndex()).toEqual({
        index: 7,
        weighting: 3,
      });
      expect(await ecu.getFuelMapColumnIndex()).toEqual({
        index: 12,
        weighting: 5,
      });
    });

    it('getRpmTable reads sixteen entries in reverse column order', async () => {
      const { transport, ecu } = await connected();

      for (let column = 0; column < 16; column++) {
        const pulseWidth = 7500 / (column + 1);

        transport.memory.set(
          [pulseWidth >> 8, pulseWidth & 0xff],
          0xc800 + column * 4,
        );
      }

      const table = await ecu.getRpmTable();

      expect(table).toHaveLength(16);
      expect(table[15]).toBe(1 * 1000);
      expect(table[0]).toBe(Math.trunc(7500000 / Math.trunc(7500 / 16)));
    });

    it('getRpmTable fails if any read fails', async () => {
      const { ecu } = await connected();

      await expect(ecu.getRpmTable()).rejects.toThrow(InvalidReadingError);
    });
  });

  describe('faults and state', () => {
    it('getFaultCodes decodes the block at 0x0049', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x01, 0x80, 0, 0, 0, 0x40], 0x0049);

      const codes = await ecu.getFaultCodes();

      expect(codes.romChecksumFailure).toBe(true);
      expect(codes.purgeValveLeak).toBe(true);
      expect(codes.batteryDisconnected).toBe(true);
      expect(codes.airflowMeter).toBe(false);
    });

    it('clearFaultCodes writes zero to all six bytes only', async () => {
      const { transport, ecu } = await connected();

      transport.memory.fill(0xff, 0x0048, 0x0050);
      await ecu.clearFaultCodes();

      expect([...transport.memory.slice(0x0048, 0x0050)]).toEqual([
        0xff, 0, 0, 0, 0, 0, 0, 0xff,
      ]);
    });

    it('clearFaultCodes stops at the first failed write', async () => {
      const { transport, ecu } = await connected();
      const write = transport.write.bind(transport);
      let valueWrites = 0;

      transport.write = (data) => {
        // Fail the third value byte (data byte 0x00 following a 0x8_ command).
        if (data[0] === 0x00 && (transport.written.at(-1) ?? 0) >= 0x80) {
          valueWrites += 1;

          if (valueWrites === 3) {
            return Promise.reject(new Error('stop'));
          }
        }

        return write(data);
      };

      transport.memory.fill(0xff, 0x0049, 0x004f);

      await expect(ecu.clearFaultCodes()).rejects.toThrow('stop');
      expect([...transport.memory.slice(0x0049, 0x004f)]).toEqual([
        0, 0, 0xff, 0xff, 0xff, 0xff,
      ]);
    });

    it('port 1 flags: fuel pump relay and MIL (both active low)', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x0002] = 0x00;
      expect(await ecu.getFuelPumpRelayState()).toBe(true);
      expect(await ecu.isMILOn()).toBe(true);

      transport.memory[0x0002] = 0x41;
      expect(await ecu.getFuelPumpRelayState()).toBe(false);
      expect(await ecu.isMILOn()).toBe(false);
    });

    it('getIdleMode, getScreenHeaterState and getACCompressorState read their bits', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x2047] = 0x01;
      transport.memory[0x00dd] = 0x00;
      transport.memory[0x008a] = 0x00;

      expect(await ecu.getIdleMode()).toBe(true);
      expect(await ecu.getScreenHeaterState()).toBe(true);
      expect(await ecu.getACCompressorState()).toBe(true);

      transport.memory[0x2047] = 0x00;
      transport.memory[0x00dd] = 0x04;
      transport.memory[0x008a] = 0x08;

      expect(await ecu.getIdleMode()).toBe(false);
      expect(await ecu.getScreenHeaterState()).toBe(false);
      expect(await ecu.getACCompressorState()).toBe(false);
    });

    it('getPurgeValveState reads the word at 0x0096', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x00, 0x00], 0x0096);
      expect(await ecu.getPurgeValveState()).toBe(PurgeValveState.Closed);

      transport.memory.set([0x27, 0x10], 0x0096);
      expect(await ecu.getPurgeValveState()).toBe(PurgeValveState.Toggling);

      transport.memory.set([0x80, 0x00], 0x0096);
      expect(await ecu.getPurgeValveState()).toBe(PurgeValveState.Open);
    });

    it('getTuneRevision reads five bytes at 0xFFE9', async () => {
      const { transport, ecu } = await connected();

      transport.memory.set([0x36, 0x52, 0xa5, 0x12, 0x34], 0xffe9);

      expect(await ecu.getTuneRevision()).toEqual({
        tuneNumber: 3652,
        checksumFixer: 0xa5,
        tuneIdent: 0x1234,
      });
    });
  });

  describe('actuators', () => {
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
    });

    describe('driveIdleAirControlMotor', () => {
      it('direction 0 clears bit 0 of 0x008A, then writes the step count', async () => {
        const { transport, ecu } = await connected();

        transport.memory[0x008a] = 0xff;
        await ecu.driveIdleAirControlMotor(0, 12);

        expect(transport.memory[0x008a]).toBe(0xfe);
        expect(transport.memory[0x0075]).toBe(12);
      });

      it('any other direction sets bit 0 and preserves the other bits', async () => {
        const { transport, ecu } = await connected();

        transport.memory[0x008a] = 0x10;
        await ecu.driveIdleAirControlMotor(1, 3);

        expect(transport.memory[0x008a]).toBe(0x11);
        expect(transport.memory[0x0075]).toBe(3);
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

        transport.memory[0x008a] = 0x01;
        transport.corruptNextEcho = false;

        const write = transport.write.bind(transport);
        let writes = 0;

        transport.write = (data) => {
          writes += 1;

          // Writes 1-3 are the read; corrupt the echo of the first write.
          if (writes === 4) {
            transport.corruptNextEcho = true;
          }

          return write(data);
        };

        await expect(ecu.driveIdleAirControlMotor(0, 5)).rejects.toThrow();
      });
    });
  });

  describe('serialisation', () => {
    it('runs concurrent operations one at a time, never interleaving wire bytes', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x2003] = 100;
      transport.memory[0x006a] = 0;
      transport.memory[0x2006] = 255;

      const results = await Promise.all([
        ecu.getRoadSpeed(),
        ecu.getCoolantTemp(),
        ecu.getFuelTemp(),
      ]);

      expect(results).toEqual([62, 266, -13]);
      // Each read is [coarse1, coarse2, command] with the first byte < 0x80.
      expect(transport.written).toHaveLength(9);
    });

    it('a failing operation does not prevent later ones', async () => {
      const { transport, ecu } = await connected();

      transport.memory[0x2003] = 100;
      transport.memory.set([0x04, 0x00], 0x0057);

      const failing = ecu.getMAFReading(AirflowType.Direct);
      const next = ecu.getRoadSpeed();

      await expect(failing).rejects.toThrow(InvalidReadingError);
      await expect(next).resolves.toBe(62);
    });
  });
});
