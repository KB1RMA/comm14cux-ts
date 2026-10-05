// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// Spec: docs/test-specification.md §2.5 (getting back in step after a failure)
import {
  Ecu,
  MemoryOffset,
  ProtocolError,
  ReadCancelledError,
  SimulatedTransport,
  TimeoutError,
  WebSerialTransport,
} from './index.js';
import { wiredPort } from './test-support/serialPort.js';

const READ_TIMEOUT_MS = 5;
const QUIET_MS = 2 * READ_TIMEOUT_MS;
// Longer than the simulated ECU's 150 ms command timeout.
const LATER_MS = 200;

async function rig() {
  const simulator = new SimulatedTransport();

  // 7500000 / 0x2710 = 750 RPM.
  simulator.memory.set([0x27, 0x10], MemoryOffset.EngineSpeedFiltered);

  const wired = wiredPort(simulator);
  const ecu = new Ecu(new WebSerialTransport(wired.port), {
    readTimeoutMs: READ_TIMEOUT_MS,
  });

  await ecu.connect();

  return { simulator, wired, ecu };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('after a reply arrives too late', () => {
  it('discards the late reply before the next command (deliberate divergence)', async () => {
    const { ecu, simulator, wired } = await rig();

    wired.holdReplies();
    const failed = ecu.getEngineRPM().catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect(await failed).toBeInstanceOf(TimeoutError);

    // The echo turns up after the host gave up on it.
    wired.releaseReplies();
    await vi.advanceTimersByTimeAsync(LATER_MS);

    const next = ecu.getEngineRPM();

    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(await next).toBe(750);
    expect(await ecu.getEngineRPM()).toBe(750);
    // The failed coarse byte, a full read, then a read using the cached
    // coarse address.
    expect(simulator.written).toEqual([0x04, 0x04, 0x01, 0xfc, 0xfc]);
  });

  it('discards a late write echo before the next write (deliberate divergence)', async () => {
    const { ecu, simulator, wired } = await rig();

    wired.holdReplies();
    const failed = ecu.writeMem(0x0100, 0x11).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect(await failed).toBeInstanceOf(TimeoutError);
    wired.releaseReplies();
    await vi.advanceTimersByTimeAsync(LATER_MS);

    const next = ecu.writeMem(0x0100, 0x22);

    await vi.advanceTimersByTimeAsync(QUIET_MS);
    await next;
    expect(simulator.memory[0x0100]).toBe(0x22);
  });
});

describe('waiting for the line to go quiet', () => {
  it('sends nothing until no byte has arrived for twice the read timeout', async () => {
    const { ecu, simulator } = await rig();

    simulator.corruptNextEcho = true;
    await expect(ecu.getEngineRPM()).rejects.toThrow(ProtocolError);
    await vi.advanceTimersByTimeAsync(LATER_MS);

    const sent = simulator.written.length;
    const next = ecu.getEngineRPM();

    await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
    expect(simulator.written).toHaveLength(sent);

    await vi.advanceTimersByTimeAsync(1);
    expect(await next).toBe(750);
  });

  it('keeps discarding while stray bytes are still arriving', async () => {
    const { ecu, simulator, wired } = await rig();

    simulator.corruptNextEcho = true;
    await expect(ecu.getEngineRPM()).rejects.toThrow(ProtocolError);
    await vi.advanceTimersByTimeAsync(LATER_MS);

    const sent = simulator.written.length;
    const next = ecu.getEngineRPM();

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
      wired.inject(0xee);
    }

    expect(simulator.written).toHaveLength(sent);

    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(await next).toBe(750);
  });

  it('gives up on a line that never goes quiet instead of hanging', async () => {
    const { ecu, simulator, wired } = await rig();
    let babbling = true;

    const babble = () => {
      if (babbling) {
        wired.inject(0xee);
        setTimeout(babble, 1);
      }
    };

    simulator.corruptNextEcho = true;
    await expect(ecu.getEngineRPM()).rejects.toThrow(ProtocolError);
    babble();

    const sent = simulator.written.length;
    const next = ecu.getEngineRPM();

    // About one stray byte per ms; the resync gives up after 1024 of them.
    await vi.advanceTimersByTimeAsync(1000);
    expect(simulator.written).toHaveLength(sent);

    await vi.advanceTimersByTimeAsync(100);
    babbling = false;
    expect(await next).toBe(750);
  });

  it('does not wait after a call that failed for another reason', async () => {
    const { ecu } = await rig();

    const dump = ecu.dumpROM();

    ecu.cancelRead();
    await expect(dump).rejects.toThrow(ReadCancelledError);

    // No timer is advanced, so a resync would never finish.
    expect(await ecu.getEngineRPM()).toBe(750);
  });
});
