// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// Virtual time for the acceptance suite. Only `setTimeout` and `Date` are
// faked: the real `setImmediate` is left alone so `settle` can tell when the
// microtask queue has drained.
import { setImmediate as realSetImmediate } from 'node:timers/promises';

/**
 * Installs fake timers around every test in the calling file.
 */
export function useVirtualClock(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}

/**
 * Runs virtual time forward, one timer at a time, until `promise` settles.
 *
 * @param promise - The operation to wait for.
 * @returns What `promise` resolves with.
 * @throws Whatever `promise` rejects with, or an error if it can never settle
 * because nothing is left scheduled.
 */
export async function settle<T>(promise: Promise<T>): Promise<T> {
  // An object, so the type checker does not assume the callbacks never run.
  const state = { settled: false };

  promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    },
  );

  for (;;) {
    // setImmediate runs only once every pending microtask has run.
    await realSetImmediate();

    if (state.settled) {
      return promise;
    }

    if (vi.getTimerCount() === 0) {
      throw new Error('Deadlock: the operation is waiting but no timer is set');
    }

    await vi.advanceTimersToNextTimerAsync();
  }
}

/**
 * Measures how much virtual time an operation takes.
 *
 * @param operation - Starts the operation.
 * @returns The result and the elapsed virtual time in ms.
 */
export async function timed<T>(
  operation: () => Promise<T>,
): Promise<{ result: T; elapsedMs: number }> {
  const start = Date.now();
  const result = await settle(operation());

  return { result, elapsedMs: Date.now() - start };
}
