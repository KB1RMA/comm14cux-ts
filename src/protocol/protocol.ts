// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.
import { DEFAULT_READ_TIMEOUT_MS } from '../constants.js';
import { ProtocolError, ReadCancelledError, TimeoutError } from '../errors.js';
import type { Transport } from '../transport/types.js';
import { nextRead } from './readCount.js';

const ADDRESS_SPACE = 0x10000;
const COARSE_WINDOW = 64;
// Writes use the coarse-address command with a length code of 0.
const WRITE_LENGTH_CODE = 0;
// Most stale bytes to discard while resynchronising: more than the longest
// reply (512 bytes) plus its command echoes. A line that is still talking
// after this many is not going to fall quiet, so stop waiting for it.
const RESYNC_BYTE_LIMIT = 1024;

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
  #lastReadCoarseAddress = 0;
  #lastReadQuantity = 0;
  #outOfStep = false;

  /**
   * Creates a protocol handler.
   *
   * @param transport - The link to the ECU.
   * @param timeoutMs - Silence timeout for each read, in milliseconds.
   */
  constructor(transport: Transport, timeoutMs = DEFAULT_READ_TIMEOUT_MS) {
    this.#transport = transport;
    this.#timeoutMs = timeoutMs;
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

    await this.#resyncIfOutOfStep();

    const result = new Uint8Array(length);
    const multiChunk = nextRead(length, 0).count < length;
    let totalRead = 0;

    try {
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
      this.#noteFailure(error);
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

    await this.#resyncIfOutOfStep();
    this.resetCache();

    try {
      await this.setCoarseAddr(addr, WRITE_LENGTH_CODE);
      await this.#sendEchoed(0x80 | (addr & 0x3f));
      await this.#sendEchoed(value);
    } catch (error) {
      this.#noteFailure(error);
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

  // After a timeout or a wrong echo the host and the ECU may be out of step:
  // a late reply can still be on its way, and the ECU may be part-way through
  // a command. The next operation resynchronises before it sends anything.
  #noteFailure(error: unknown): void {
    if (error instanceof TimeoutError || error instanceof ProtocolError) {
      this.#outOfStep = true;
    }
  }

  // Discards everything that arrives until the line has been quiet for twice
  // the read timeout. By then the ECU has also been sent nothing for that
  // long, so its own command timeout has dropped any half-received command
  // (it keeps the latched address, but the coarse-address cache is already
  // reset). libcomm14cux flushes the port only when connecting.
  async #resyncIfOutOfStep(): Promise<void> {
    if (!this.#outOfStep) {
      return;
    }

    this.#outOfStep = false;

    try {
      for (let i = 0; i < RESYNC_BYTE_LIMIT; i++) {
        await this.#transport.read(1, this.#timeoutMs * 2);
      }
    } catch {
      // Quiet at last, or the link has gone; either way, carry on. A link
      // error will surface again on the command that follows.
    }
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
