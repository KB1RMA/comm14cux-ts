// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

/**
 * Runs asynchronous tasks one at a time, in submission order. Replaces the
 * per-connection mutex that libcomm14cux holds around each operation.
 */
export class CommandQueue {
  #tail: Promise<unknown> = Promise.resolve();

  /**
   * Queues a task and runs it once all earlier tasks have settled.
   *
   * @param task - Function that performs the work.
   * @returns The task's result. If the task rejects, only this call rejects.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task);

    this.#tail = result.catch(() => undefined);

    return result;
  }
}
