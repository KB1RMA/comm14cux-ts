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

  /**
   * Queues a task and runs it once all earlier tasks have settled.
   *
   * @param task - Function that performs the work.
   * @returns The task's result. If the task rejects, only this call rejects.
   * @throws {@link QueueClosedError} if the queue is closed before the task starts.
   */
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

  /**
   * Closes the queue. Tasks that have not started are rejected; a task already
   * running is left to finish.
   */
  close(): void {
    this.#closed = true;
  }
}
