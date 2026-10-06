// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// Spec: docs/test-specification.md §6.1 (trace hook, structured errors)
import {
  Ecu,
  NotConnectedError,
  ProtocolError,
  ReadCancelledError,
  SimulatedTransport,
  TimeoutError,
  type TraceEvent,
} from './index.js';
import { connected, fillPattern } from './test-support/ecu.js';

async function traced() {
  const events: TraceEvent[] = [];
  const setup = await connected({ onTrace: (e) => events.push(e) });

  fillPattern(setup.transport);

  return { ...setup, events };
}

function ofType<T extends TraceEvent['type']>(
  events: readonly TraceEvent[],
  type: T,
): Extract<TraceEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<TraceEvent, { type: T }> => e.type === type,
  );
}

describe('Ecu trace hook', () => {
  describe('operations', () => {
    it('reports the start and end of a successful operation', async () => {
      const { ecu, events } = await traced();
      const before = Date.now();

      events.length = 0;
      await ecu.getEngineRPM();

      expect(events.map((e) => e.type)).toEqual([
        'operation-start',
        'operation-end',
      ]);

      const [start, end] = events as [
        TraceEvent & { type: 'operation-start' },
        TraceEvent & { type: 'operation-end' },
      ];

      expect(start.operation).toBe('getEngineRPM');
      expect(end.operation).toBe('getEngineRPM');
      expect(end.operationId).toBe(start.operationId);
      expect(start.timestamp).toBeGreaterThanOrEqual(before);
      expect(end.ok).toBe(true);
      expect(end.error).toBeUndefined();
      expect(end.durationMs).toBeGreaterThanOrEqual(0);
      expect(start.address).toBeUndefined();
    });

    it('numbers operations in call order', async () => {
      const { ecu, events } = await traced();

      events.length = 0;
      await ecu.getRoadSpeed();
      await ecu.getCoolantTemp();

      expect(
        ofType(events, 'operation-start').map((e) => [
          e.operationId,
          e.operation,
        ]),
      ).toEqual([
        [2, 'getRoadSpeed'],
        [3, 'getCoolantTemp'],
      ]);
    });

    it('includes the address and length of readMem and dumpROM', async () => {
      const { ecu, events } = await traced();

      events.length = 0;
      await ecu.readMem(0x1234, 5);
      await ecu.dumpROM();

      const starts = ofType(events, 'operation-start');
      const ends = ofType(events, 'operation-end');

      expect(starts.map((e) => [e.operation, e.address, e.length])).toEqual([
        ['readMem', 0x1234, 5],
        ['dumpROM', 0xc000, 0x4000],
      ]);
      expect(ends.map((e) => [e.operation, e.address, e.length])).toEqual([
        ['readMem', 0x1234, 5],
        ['dumpROM', 0xc000, 0x4000],
      ]);
    });

    it('reports the error an operation rejects with', async () => {
      const { transport, ecu, events } = await traced();

      transport.silent = true;
      events.length = 0;

      const error = await ecu.getRoadSpeed().catch((e: unknown) => e);
      const [end] = ofType(events, 'operation-end');

      expect(error).toBeInstanceOf(TimeoutError);
      expect(end).toMatchObject({ ok: false, error });
    });

    it('reports a write that the transport rejects', async () => {
      const { transport, ecu, events } = await traced();

      transport.failWrites = true;
      events.length = 0;

      await expect(ecu.writeMem(0x10, 1)).rejects.toThrow(
        'Simulated write failure',
      );
      expect(ofType(events, 'operation-end')[0]).toMatchObject({
        operation: 'writeMem',
        ok: false,
      });
    });

    it('reports an operation rejected because the ECU is not connected', async () => {
      const events: TraceEvent[] = [];
      const ecu = new Ecu(new SimulatedTransport(), {
        onTrace: (e) => events.push(e),
      });

      await expect(ecu.getGearSelection()).rejects.toThrow(NotConnectedError);
      expect(events.map((e) => e.type)).toEqual([
        'operation-start',
        'operation-end',
      ]);
      expect(ofType(events, 'operation-end')[0]?.error).toBeInstanceOf(
        NotConnectedError,
      );
    });

    it('reports connect and disconnect as operations', async () => {
      const { ecu, events } = await traced();

      await ecu.disconnect();

      expect(ofType(events, 'operation-start').map((e) => e.operation)).toEqual(
        ['connect', 'disconnect'],
      );
    });
  });

  describe('queue waits', () => {
    it('reports how long an operation waited behind another', async () => {
      const { ecu, events } = await traced();

      events.length = 0;
      await Promise.all([ecu.getRoadSpeed(), ecu.getCoolantTemp()]);

      const waits = ofType(events, 'queue-wait');

      expect(waits).toHaveLength(1);
      expect(waits[0]).toMatchObject({ operation: 'getCoolantTemp', ahead: 1 });
      expect(waits[0]?.waitMs).toBeGreaterThanOrEqual(0);

      const types = events.map((e) => `${e.type}`);

      expect(types).toEqual([
        'operation-start',
        'operation-end',
        'queue-wait',
        'operation-start',
        'operation-end',
      ]);
    });

    it('counts every operation ahead', async () => {
      const { ecu, events } = await traced();

      events.length = 0;
      await Promise.all([
        ecu.getRoadSpeed(),
        ecu.getCoolantTemp(),
        ecu.getFuelTemp(),
      ]);

      expect(ofType(events, 'queue-wait').map((e) => e.ahead)).toEqual([1, 2]);
    });

    it('does not report a wait when the queue was idle', async () => {
      const { ecu, events } = await traced();

      await ecu.getRoadSpeed();
      await ecu.getRoadSpeed();

      expect(ofType(events, 'queue-wait')).toEqual([]);
    });
  });

  describe('split reads', () => {
    it('reports each chunk with its address, length and index', async () => {
      const { ecu, events } = await traced();

      events.length = 0;
      await ecu.readMem(0x1000, 600);

      expect(
        ofType(events, 'read-chunk').map((e) => [
          e.operation,
          e.address,
          e.length,
          e.chunkIndex,
          e.chunkCount,
        ]),
      ).toEqual([
        ['readMem', 0x1000, 512, 0, 3],
        ['readMem', 0x1200, 80, 1, 3],
        ['readMem', 0x1250, 8, 2, 3],
      ]);
    });

    it('reports the chunks between the start and end of the operation', async () => {
      const { ecu, events } = await traced();

      events.length = 0;
      await ecu.readMem(0x1000, 20);

      expect(events.map((e) => e.type)).toEqual([
        'operation-start',
        'read-chunk',
        'read-chunk',
        'operation-end',
      ]);
    });

    it('does not report a read that fits in one chunk', async () => {
      const { ecu, events } = await traced();

      await ecu.readMem(0x1000, 16);
      await ecu.getEngineRPM();

      expect(ofType(events, 'read-chunk')).toEqual([]);
    });

    it('attributes chunks to the operation that reads them', async () => {
      const { transport, ecu, events } = await traced();

      transport.memory[0xc23f] = 0x40;
      events.length = 0;
      await ecu.getFuelMap(1);

      const chunks = ofType(events, 'read-chunk');

      expect(chunks.length).toBeGreaterThan(0);
      expect(new Set(chunks.map((e) => e.operation))).toEqual(
        new Set(['getFuelMap']),
      );
    });
  });

  describe('echo mismatches', () => {
    it('reports a bad coarse-address echo before the ProtocolError', async () => {
      const { transport, ecu, events } = await traced();

      transport.corruptNextEcho = true;
      events.length = 0;

      const error = await ecu.readMem(0x2003, 1).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ProtocolError);
      expect(events.map((e) => e.type)).toEqual([
        'operation-start',
        'echo-mismatch',
        'operation-end',
      ]);
      expect(ofType(events, 'echo-mismatch')[0]).toMatchObject({
        operation: 'readMem',
        expected: 0x00,
        received: 0xff,
        position: 0,
        command: [0x00, (0x2003 >> 6) & 0xff],
      });
    });

    it('reports the position of the bad byte within a write command', async () => {
      const { transport, ecu, events } = await traced();
      const write = transport.write.bind(transport);

      // Corrupt the echo of the value byte: the fourth byte of a write.
      transport.write = (data) => {
        if (transport.written.length === 3) {
          transport.corruptNextEcho = true;
        }

        return write(data);
      };

      events.length = 0;

      await expect(ecu.writeMem(0x1234, 0x56)).rejects.toThrow(ProtocolError);
      expect(ofType(events, 'echo-mismatch')[0]).toMatchObject({
        operation: 'writeMem',
        expected: 0x56,
        received: 0x56 ^ 0xff,
        position: 1,
        command: [0x80 | (0x1234 & 0x3f), 0x56],
      });
    });
  });

  describe('cancelRead', () => {
    it('reports the call, and the read it stopped', async () => {
      const { transport, ecu, events } = await traced();
      const read = transport.read.bind(transport);
      let calls = 0;

      transport.read = async (length, timeout) => {
        if (++calls === 3) {
          ecu.cancelRead();
        }

        return read(length, timeout);
      };

      events.length = 0;

      await expect(ecu.dumpROM()).rejects.toThrow(ReadCancelledError);

      expect(ofType(events, 'cancel-read')).toMatchObject([{ outstanding: 1 }]);
      expect(ofType(events, 'read-cancelled')).toMatchObject([
        {
          operation: 'dumpROM',
          address: 0xc000,
          length: 0x4000,
          bytesRead: 512,
        },
      ]);
      expect(events.at(-1)).toMatchObject({
        type: 'operation-end',
        ok: false,
      });
    });

    it('reports reads cancelled while still queued, with nothing read', async () => {
      const { ecu, events } = await traced();

      events.length = 0;

      const first = ecu.readMem(0x1000, 32);
      const second = ecu.readMem(0x2000, 32);

      ecu.cancelRead();
      await expect(first).rejects.toThrow(ReadCancelledError);
      await expect(second).rejects.toThrow(ReadCancelledError);

      expect(events[0]).toMatchObject({ type: 'cancel-read', outstanding: 2 });
      expect(
        ofType(events, 'read-cancelled').map((e) => [e.address, e.bytesRead]),
      ).toEqual([
        [0x1000, 0],
        [0x2000, 0],
      ]);
    });

    it('is reported even when nothing is running', async () => {
      const { ecu, events } = await traced();

      events.length = 0;
      ecu.cancelRead();

      expect(events).toMatchObject([{ type: 'cancel-read', outstanding: 0 }]);
    });
  });

  describe('structured errors', () => {
    it('gives ProtocolError the echo bytes and the command', async () => {
      const { transport, ecu } = await connected();

      transport.corruptNextEcho = true;

      const error = (await ecu.writeMem(0x1234, 1).catch((e: unknown) => e)) as
        ProtocolError | undefined;

      expect(error).toBeInstanceOf(ProtocolError);
      expect(error?.expected).toBe(0x00 | (0x1234 >> 14));
      expect(error?.actual).toBe(0x00 ^ 0xff);
      expect(error?.position).toBe(0);
      expect(error?.command).toEqual([
        0x00 | (0x1234 >> 14),
        (0x1234 >> 6) & 0xff,
      ]);
    });

    it('gives TimeoutError the wait, the byte counts and the command', async () => {
      const { transport, ecu } = await connected();

      transport.silent = true;

      const error = (await ecu.readMem(0x1000, 1).catch((e: unknown) => e)) as
        TimeoutError | undefined;

      expect(error).toBeInstanceOf(TimeoutError);
      expect(error).toMatchObject({
        timeoutMs: 5,
        requestedBytes: 1,
        receivedBytes: 0,
        command: [0x00, 0x40],
      });
    });

    it('reports a short stream as a timeout with the bytes that arrived', async () => {
      const { transport, ecu } = await connected();

      transport.streamLimit = 4;

      const error = (await ecu.readMem(0x1000, 10).catch((e: unknown) => e)) as
        TimeoutError | undefined;

      expect(error).toMatchObject({
        requestedBytes: 10,
        receivedBytes: 4,
        command: [0xc0],
      });
    });
  });

  describe('other transport failures', () => {
    it('passes a non-timeout read failure through unchanged', async () => {
      const { transport, ecu } = await connected();
      const failure = new Error('adapter unplugged');

      vi.spyOn(transport, 'read').mockRejectedValueOnce(failure);

      await expect(ecu.readMem(0x1000, 1)).rejects.toBe(failure);
    });
  });

  describe('hook safety', () => {
    it('is unaffected by a hook that throws', async () => {
      const transport = new SimulatedTransport();
      const hook = vi.fn(() => {
        throw new Error('logger broke');
      });
      const ecu = new Ecu(transport, { readTimeoutMs: 5, onTrace: hook });

      fillPattern(transport);
      await ecu.connect();

      expect([...(await ecu.readMem(0x1000, 600))]).toEqual([
        ...transport.memory.slice(0x1000, 0x1000 + 600),
      ]);
      expect(hook).toHaveBeenCalled();
    });

    it('sends the same bytes with and without a hook', async () => {
      const plain = await connected();
      const withHook = await traced();

      for (const { ecu } of [plain, withHook]) {
        await ecu.readMem(0x1000, 600);
        await ecu.writeMem(0x2000, 7);
      }

      expect(withHook.transport.written).toEqual(plain.transport.written);
    });
  });
});
