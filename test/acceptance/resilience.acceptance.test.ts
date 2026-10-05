// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// Journey: things going wrong in the car park. The ignition is switched off,
// the cable is pulled, the line is noisy, the USB adapter is slow. The
// application should get a clear error and be able to carry on.
import { Comm14cuxError, ProtocolError, TimeoutError } from 'comm14cux-ts';
import { revCRom, virtualEcu, warmIdle } from './fixtures/index.js';
import { bench, type BenchOptions } from './support/bench.js';
import { settle, timed, useVirtualClock } from './support/clock.js';
import { approximately, readDashboard } from './support/dashboard.js';

useVirtualClock();

async function running(options: BenchOptions = {}) {
  const rig = bench({
    simulator: virtualEcu({ rom: revCRom, state: warmIdle }),
    ...options,
  });

  await settle(rig.ecu.connect());

  return rig;
}

/**
 * What an application's polling loop does: try a few times before giving up.
 *
 * @param attempt - One poll.
 * @param tries - How many polls to allow.
 * @returns The first successful result.
 */
async function withRetries<T>(
  attempt: () => Promise<T>,
  tries: number,
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < tries; i++) {
    try {
      return await settle(attempt());
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

describe('ignition switched off', () => {
  it('times out after the 100 ms silence timeout, then works when switched back on', async () => {
    const { ecu, port } = await running();

    port.powerOff();
    const outcome = await timed(() =>
      ecu.getEngineRPM().catch((error: unknown) => error),
    );

    expect(outcome.result).toBeInstanceOf(TimeoutError);
    expect(outcome.result).toBeInstanceOf(Comm14cuxError);
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(100);
    expect(outcome.elapsedMs).toBeLessThan(150);
    expect(ecu.isConnected()).toBe(true);

    await settle(port.powerOn());

    expect(await settle(readDashboard(ecu))).toEqual(
      approximately(warmIdle.expected),
    );
  });
});

describe('cable pulled out', () => {
  it('fails the ROM dump with the browser error and every call after it until reconnected', async () => {
    const { ecu, port } = await running();

    const dump = ecu.dumpROM().catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(3000);
    port.unplug();

    // Web Serial's NetworkError is passed through unchanged.
    const error = await settle(dump);

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('NetworkError');
    await expect(settle(ecu.getEngineRPM())).rejects.toThrow(
      'The device has been lost.',
    );
    // The library does not notice the cable is gone until told.
    expect(ecu.isConnected()).toBe(true);

    await settle(ecu.disconnect());
    expect(port.isOpen).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    port.plugIn();
    await settle(ecu.connect());

    expect(await settle(ecu.dumpROM())).toEqual(revCRom.image);
  });
});

describe('noisy line', () => {
  it('reports a garbled echo as a ProtocolError and recovers without reconnecting', async () => {
    const { ecu, simulator } = await running();

    simulator.corruptNextEcho = true;

    await expect(settle(ecu.getEngineRPM())).rejects.toThrow(ProtocolError);
    expect(await withRetries(() => ecu.getEngineRPM(), 3)).toBe(750);
    expect(await settle(readDashboard(ecu))).toEqual(
      approximately(warmIdle.expected),
    );
  });

  it('reports an ECU that stops part-way through a reply as a timeout', async () => {
    const { ecu, simulator } = await running();

    simulator.streamLimit = 100;

    await expect(settle(ecu.dumpROM())).rejects.toThrow(TimeoutError);

    simulator.streamLimit = undefined;
    expect(await withRetries(() => ecu.getCoolantTemp(), 3)).toBe(190);
  });

  // Known issue: after a timeout, the late reply is still in the receive
  // buffer and is read as the answer to the next command. Every later call
  // fails with ProtocolError until the application reconnects. libcomm14cux
  // has the same weakness (it flushes the port only when connecting).
  it.todo('recovers after one reply arrives just too late');
});

describe('USB adapter latency', () => {
  it('works with a 50 ms latency timer under the default timeout', async () => {
    const { ecu } = await running({ cable: { latencyMs: 50 } });

    expect(await settle(readDashboard(ecu))).toEqual(
      approximately(warmIdle.expected),
    );
  });

  it('times out with a latency timer longer than the read timeout', async () => {
    const { ecu } = await running({ cable: { latencyMs: 120 } });

    await expect(settle(ecu.getEngineRPM())).rejects.toThrow(TimeoutError);
  });

  it('works with the same adapter once readTimeoutMs is raised', async () => {
    const { ecu } = await running({
      cable: { latencyMs: 120 },
      ecu: { readTimeoutMs: 250 },
    });

    expect(await settle(readDashboard(ecu))).toEqual(
      approximately(warmIdle.expected),
    );
    expect(await settle(ecu.dumpROM())).toEqual(revCRom.image);
  });
});

describe('a busy application', () => {
  it('keeps a ROM dump and dashboard polls apart when they overlap', async () => {
    const { ecu } = await running();

    const [image, dashboard] = await settle(
      Promise.all([ecu.dumpROM(), readDashboard(ecu)]),
    );

    expect(image).toEqual(revCRom.image);
    expect(dashboard).toEqual(approximately(warmIdle.expected));
  });
});
