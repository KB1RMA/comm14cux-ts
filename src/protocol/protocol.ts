// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.
import {
  DEFAULT_COMMAND_RESET_MS,
  DEFAULT_READ_TIMEOUT_MS,
} from '../constants.js';
import { ProtocolError, ReadCancelledError, TimeoutError } from '../errors.js';
import type { Transport } from '../transport/types.js';
import { nextRead } from './readCount.js';

const ADDRESS_SPACE = 0x10000;
const COARSE_WINDOW = 64;
// Writes use the coarse-address command with a length code of 0.
const WRITE_LENGTH_CODE = 0;
// The longest the ECU can keep talking after a failed command: a whole
// 512-byte read reply, plus a few echoes.
const MAX_LATE_BYTES = 0x200 + 4;

/**
 * Memory read and write commands over a `Transport`
 * (`protocol.c`: `c14cux_readMem`, `c14cux_writeMem`).
 *
 * This class is not re-entrant: callers must serialise operations (the
 * `Ecu` class does so with a `CommandQueue`). Cancellation is decided by the
 * caller, through the `isCancelled` callback given to `readMem`.
 */
export class Protocol {
  readonly #transport: Transport;
  readonly #timeoutMs: number;
  readonly #commandResetMs: number;
  #resyncNeeded = false;
  #lastReadCoarseAddress = 0;
  #lastReadQuantity = 0;

  /**
   * Creates a protocol handler.
   *
   * @param transport - The link to the ECU.
   * @param timeoutMs - Silence timeout for each read, in milliseconds.
   * @param commandResetMs - Quiet time to wait for after a failed command,
   * in milliseconds.
   */
  constructor(
    transport: Transport,
    timeoutMs = DEFAULT_READ_TIMEOUT_MS,
    commandResetMs = DEFAULT_COMMAND_RESET_MS,
  ) {
    this.#transport = transport;
    this.#timeoutMs = timeoutMs;
    this.#commandResetMs = commandResetMs;
  }

  /** Forgets the last coarse address, forcing the next read to set it. */
  resetCache(): void {
    this.#lastReadCoarseAddress = 0;
    this.#lastReadQuantity = 0;
  }

  /**
   * Reads `length` bytes starting at `addr`, splitting long reads into chunks
   * (`c14cux_readMem`).
   *
   * @param addr - First address to read, 0 to 0xFFFF.
   * @param length - Number of bytes to read. `addr + length` must not exceed 0x10000.
   * @param isCancelled - Checked before each chunk of a multi-chunk read; a
   * read that fits in one chunk is never cancelled.
   * @returns The bytes read.
   * @throws {@link RangeError} if the address or length is out of range.
   * @throws {@link ReadCancelledError} if `isCancelled` returns `true`.
   * @throws {@link ProtocolError} if an echo is wrong.
   * @throws {@link TimeoutError} if the ECU stops responding.
   */
  async readMem(
    addr: number,
    length: number,
    isCancelled: () => boolean,
  ): Promise<Uint8Array> {
    assertUint16(addr, 'address');
    assertUint16(length, 'length');

    if (addr + length > ADDRESS_SPACE) {
      throw new RangeError('Read extends past the end of the address space');
    }

    const result = new Uint8Array(length);
    const multiChunk = nextRead(length, 0).count < length;
    let totalRead = 0;

    try {
      await this.#resync();

      while (totalRead < length) {
        if (multiChunk && isCancelled()) {
          throw new ReadCancelledError('Read cancelled');
        }

        const { count: quantity, code } = nextRead(length, totalRead);
        const chunkAddr = addr + totalRead;

        // The ECU latches only the 64-byte-aligned block (addr >> 6), so the
        // final command byte alone is enough only within that same block.
        const lastByteOnly =
          quantity === this.#lastReadQuantity &&
          Math.trunc(chunkAddr / COARSE_WINDOW) ===
            Math.trunc(this.#lastReadCoarseAddress / COARSE_WINDOW);

        if (!lastByteOnly) {
          await this.setCoarseAddr(chunkAddr, code);
          this.#lastReadCoarseAddress = chunkAddr;
        }

        // The ECU does not echo the read command; it starts sending data.
        await this.#transport.write(Uint8Array.of(0xc0 | (chunkAddr & 0x3f)));
        result.set(
          await this.#transport.read(quantity, this.#timeoutMs),
          totalRead,
        );
        totalRead += quantity;
        this.#lastReadQuantity = quantity;
      }
    } catch (error) {
      this.resetCache();
      // Cancellation happens between chunks, when the ECU is idle.
      this.#resyncNeeded ||= !(error instanceof ReadCancelledError);
      throw error;
    }

    return result;
  }

  /**
   * Writes one byte to ECU memory (`c14cux_writeMem`).
   *
   * @param addr - Address to write, 0 to 0xFFFF.
   * @param value - Byte to write, 0 to 255.
   * @throws {@link RangeError} if the address or value is out of range.
   * @throws {@link ProtocolError} if an echo is wrong.
   * @throws {@link TimeoutError} if the ECU stops responding.
   */
  async writeMem(addr: number, value: number): Promise<void> {
    assertUint16(addr, 'address');

    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new RangeError(`Invalid value: ${value}`);
    }

    this.resetCache();

    try {
      await this.#resync();
      await this.setCoarseAddr(addr, WRITE_LENGTH_CODE);
      await this.#sendEchoed(0x80 | (addr & 0x3f));
      await this.#sendEchoed(value);
    } catch (error) {
      this.#resyncNeeded = true;
      throw error;
    }
  }

  /**
   * Sets the coarse address and length code for the next command
   * (`c14cux_setCoarseAddr`).
   *
   * @param addr - Address of the read or write, 0 to 0xFFFF.
   * @param code - Length code of the following read, or 0 for a write.
   * @throws {@link ProtocolError} if an echo is wrong.
   * @throws {@link TimeoutError} if the ECU stops responding.
   */
  async setCoarseAddr(addr: number, code: number): Promise<void> {
    await this.#sendEchoed(((code << 2) | (addr >> 14)) & 0xff);
    await this.#sendEchoed((addr >> 6) & 0xff);
  }

  /**
   * After a failed command the ECU may still be waiting for the rest of it,
   * and would take the next byte sent as that rest: for a write, as the value
   * to store. Waits until the line has been quiet long enough for the ECU to
   * drop the half-received command, discarding any late bytes.
   *
   * @throws {@link ProtocolError} if the ECU never goes quiet.
   */
  async #resync(): Promise<void> {
    if (!this.#resyncNeeded) {
      return;
    }

    for (let i = 0; i <= MAX_LATE_BYTES; i++) {
      try {
        await this.#transport.read(1, this.#commandResetMs);
      } catch (error) {
        if (!(error instanceof TimeoutError)) {
          throw error;
        }

        this.#resyncNeeded = false;

        return;
      }
    }

    throw new ProtocolError('ECU did not go quiet after a failed command');
  }

  async #sendEchoed(byte: number): Promise<void> {
    await this.#transport.write(Uint8Array.of(byte));

    const [echo] = await this.#transport.read(1, this.#timeoutMs);

    if (echo !== byte) {
      throw new ProtocolError(
        `Echo mismatch: sent 0x${byte.toString(16)}, received 0x${(echo ?? 0).toString(16)}`,
      );
    }
  }
}

function assertUint16(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= ADDRESS_SPACE) {
    throw new RangeError(`Invalid ${name}: ${value}`);
  }
}
