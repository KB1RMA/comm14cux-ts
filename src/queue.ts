// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors
import { QueueClosedError } from './errors.js';

/**
 * Runs asynchronous tasks one at a time, in submission order. Replaces the
 * per-connection mutex that libcomm14cux holds around each operation.
 */
export class CommandQueue {
  #tail: Promise<unknown> = Promise.resolve();
  #closed = false;

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#closed) {
      return Promise.reject(new QueueClosedError('Queue is closed'));
    }

    const result = this.#tail.then(() => {
      if (this.#closed) {
        throw new QueueClosedError('Queue is closed');
      }

      return task();
    });

    this.#tail = result.catch(() => undefined);

    return result;
  }

  /** Rejects tasks that have not started; a running task is left to finish. */
  close(): void {
    this.#closed = true;
  }
}
