// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

import { BAUD } from '../constants.js';
import { NotConnectedError, TimeoutError } from '../errors.js';
import type { Transport } from './types.js';

/**
 * Options for {@link WebSerialTransport}.
 */
export interface WebSerialTransportOptions {
  /** 7812 for standard ECUs; 15625 for modified double-speed firmware. */
  baudRate?: number;
}

/** `Transport` over a Web Serial `SerialPort` (8N1, no flow control). */
export class WebSerialTransport implements Transport {
  readonly #port: SerialPort;
  readonly #baudRate: number;
  #reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  #writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  #pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  #leftover: Uint8Array = new Uint8Array(0);

  /**
   * Wraps a serial port. The port is not opened until {@link WebSerialTransport.open}.
   *
   * @param port - A port the user has granted access to, from
   * `navigator.serial.requestPort()`.
   * @param options - Optional settings.
   */
  constructor(port: SerialPort, options: WebSerialTransportOptions = {}) {
    this.#port = port;
    this.#baudRate = options.baudRate ?? BAUD;
  }

  /**
   * Opens the port at the configured baud rate, 8N1 with no flow control.
   * Does nothing if already open.
   */
  async open(): Promise<void> {
    if (this.#reader) {
      return;
    }

    await this.#port.open({
      baudRate: this.#baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    });
    this.#reader = this.#port.readable?.getReader();
    this.#writer = this.#port.writable?.getWriter();
  }

  /**
   * Cancels any pending read, releases the stream locks and closes the port.
   * Does nothing if not open.
   */
  async close(): Promise<void> {
    const reader = this.#reader;
    const writer = this.#writer;

    this.#reader = undefined;
    this.#writer = undefined;
    this.#pending = undefined;
    this.#leftover = new Uint8Array(0);

    if (!reader) {
      return;
    }

    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    writer?.releaseLock();
    await this.#port.close();
  }

  /**
   * Writes bytes to the port.
   *
   * @param data - Bytes to send.
   * @throws {@link NotConnectedError} if the port is not open.
   */
  async write(data: Uint8Array): Promise<void> {
    if (!this.#writer) {
      throw new NotConnectedError('Serial port is not open');
    }

    await this.#writer.write(data);
  }

  /**
   * Reads exactly `length` bytes, assembling them from as many chunks as needed.
   * Surplus bytes are kept for the next call.
   *
   * @param length - Number of bytes wanted.
   * @param timeoutMs - Longest silence to wait for more data, in milliseconds.
   * @returns Exactly `length` bytes.
   * @throws {@link TimeoutError} if no data arrives within `timeoutMs`.
   * @throws {@link NotConnectedError} if the port is not open or the stream ends.
   */
  async read(length: number, timeoutMs: number): Promise<Uint8Array> {
    const reader = this.#reader;

    if (!reader) {
      throw new NotConnectedError('Serial port is not open');
    }

    const result = new Uint8Array(length);
    let filled = 0;

    while (filled < length) {
      if (this.#leftover.length === 0) {
        this.#leftover = await this.#nextChunk(reader, timeoutMs);
      }

      const take = Math.min(length - filled, this.#leftover.length);

      result.set(this.#leftover.subarray(0, take), filled);
      this.#leftover = this.#leftover.subarray(take);
      filled += take;
    }

    return result;
  }

  async #nextChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number,
  ): Promise<Uint8Array> {
    // A read that timed out is still pending; reuse it so no data is lost.
    const pending = (this.#pending ??= reader.read());
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new TimeoutError(`No data from ECU for ${timeoutMs} ms`));
      }, timeoutMs);
    });

    try {
      const chunk = await Promise.race([pending, timeout]);

      this.#pending = undefined;

      if (chunk.done) {
        throw new NotConnectedError('Serial stream ended');
      }

      return chunk.value;
    } catch (error) {
      if (!(error instanceof TimeoutError)) {
        this.#pending = undefined;
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
