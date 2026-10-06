// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

/**
 * Runs asynchronous tasks one at a time, in submission order. Replaces the
 * per-connection mutex that libcomm14cux holds around each operation.
 */
export class CommandQueue {
  #tail: Promise<unknown> = Promise.resolve();
  #pending = 0;

  /**
   * The number of tasks that have been queued and have not yet settled,
   * including the one running.
   *
   * @returns The count.
   */
  get pending(): number {
    return this.#pending;
  }

  /**
   * Queues a task and runs it once all earlier tasks have settled.
   *
   * @param task - Function that performs the work.
   * @returns The task's result. If the task rejects, only this call rejects.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task);

    const settled = (): undefined => {
      this.#pending--;
    };

    this.#pending++;
    this.#tail = result.then(settled, settled);

    return result;
  }
}
