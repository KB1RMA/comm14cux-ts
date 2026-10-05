// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// Spec: docs/test-specification.md §3 (replaces libcomm14cux's per-connection mutex)
import { QueueClosedError } from './errors.js';
import { CommandQueue } from './queue.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('CommandQueue', () => {
  it('runs a task and resolves with its result', async () => {
    const queue = new CommandQueue();

    await expect(queue.run(() => Promise.resolve(42))).resolves.toBe(42);
  });

  it('runs tasks one at a time, in submission order', async () => {
    const queue = new CommandQueue();
    const log: string[] = [];
    const gate = deferred();

    const first = queue.run(async () => {
      log.push('first:start');
      await gate.promise;
      log.push('first:end');
    });
    const second = queue.run(() => {
      log.push('second');

      return Promise.resolve();
    });

    await Promise.resolve();
    expect(log).toEqual(['first:start']);

    gate.resolve();
    await Promise.all([first, second]);

    expect(log).toEqual(['first:start', 'first:end', 'second']);
  });

  it('propagates a rejection to its caller only', async () => {
    const queue = new CommandQueue();
    const failing = queue.run(() => Promise.reject(new Error('boom')));
    const next = queue.run(() => Promise.resolve('ok'));

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('rejects not-yet-started tasks when closed, and lets the running one finish', async () => {
    const queue = new CommandQueue();
    const gate = deferred<string>();
    const running = queue.run(() => gate.promise);
    const pending = queue.run(() => Promise.resolve('never'));

    await new Promise((resolve) => setTimeout(resolve, 0));
    queue.close();
    gate.resolve('done');

    await expect(running).resolves.toBe('done');
    await expect(pending).rejects.toThrow(QueueClosedError);
  });

  it('rejects new tasks after close', async () => {
    const queue = new CommandQueue();

    queue.close();

    await expect(queue.run(() => Promise.resolve(1))).rejects.toThrow(
      QueueClosedError,
    );
  });
});
