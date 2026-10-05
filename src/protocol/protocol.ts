// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.
import { DEFAULT_READ_TIMEOUT_MS } from '../constants.js';
import { ProtocolError, ReadCancelledError } from '../errors.js';
import type { Transport } from '../transport/types.js';
import { lengthCode, nextReadCount } from './readCount.js';

const ADDRESS_SPACE = 0x10000;
const COARSE_WINDOW = 64;

/**
 * Memory read and write commands over a `Transport`
 * (`protocol.c`: `c14cux_readMem`, `c14cux_writeMem`).
 *
 * This class is not re-entrant: callers must serialise operations (the
 * `Ecu` class does so with a `CommandQueue`). `cancelRead()` is the one
 * method that is safe to call while a read is in progress.
 */
export class Protocol {
  readonly #transport: Transport;
  readonly #timeoutMs: number;
  #lastReadCoarseAddress = 0;
  #lastReadQuantity = 0;
  #cancelRead = false;

  constructor(transport: Transport, timeoutMs = DEFAULT_READ_TIMEOUT_MS) {
    this.#transport = transport;
    this.#timeoutMs = timeoutMs;
  }

  /** Stops a multi-chunk read after the chunk currently in flight. */
  cancelRead(): void {
    this.#cancelRead = true;
  }

  // A method, so the flag is re-read after each await (TypeScript would
  // otherwise narrow it to its value at the top of readMem).
  #isCancelled(): boolean {
    return this.#cancelRead;
  }

  /** Forgets the last coarse address, forcing the next read to set it. */
  resetCache(): void {
    this.#lastReadCoarseAddress = 0;
    this.#lastReadQuantity = 0;
  }

  /** Reads `length` bytes starting at `addr`. */
  async readMem(addr: number, length: number): Promise<Uint8Array> {
    assertUint16(addr, 'address');
    assertUint16(length, 'length');

    if (addr + length > ADDRESS_SPACE) {
      throw new RangeError('Read extends past the end of the address space');
    }

    this.#cancelRead = false;

    const result = new Uint8Array(length);
    let totalRead = 0;

    try {
      while (totalRead < length) {
        if (this.#isCancelled()) {
          throw new ReadCancelledError('Read cancelled');
        }

        const quantity = nextReadCount(length, totalRead);
        const chunkAddr = addr + totalRead;

        // If the next address is within the 64-byte window created by the
        // last coarse address, only the final command byte is needed.
        const lastByteOnly =
          quantity === this.#lastReadQuantity &&
          chunkAddr < this.#lastReadCoarseAddress + COARSE_WINDOW &&
          this.#lastReadCoarseAddress <= chunkAddr;

        if (!lastByteOnly) {
          await this.setCoarseAddr(chunkAddr, quantity);
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
      throw error;
    }

    return result;
  }

  /** Writes one byte to ECU memory. */
  async writeMem(addr: number, value: number): Promise<void> {
    assertUint16(addr, 'address');

    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new RangeError(`Invalid value: ${value}`);
    }

    this.resetCache();
    await this.setCoarseAddr(addr, 0);
    await this.#sendEchoed(0x80 | (addr & 0x3f));
    await this.#sendEchoed(value);
  }

  /**
   * Sets the coarse address (and, for reads, the length) for the next
   * command. A `length` of 0 selects the write form.
   */
  async setCoarseAddr(addr: number, length: number): Promise<void> {
    const code = lengthCode(length);

    if (code === undefined) {
      throw new RangeError(`Invalid read length: ${length}`);
    }

    await this.#sendEchoed(((code << 2) | (addr >> 14)) & 0xff);
    await this.#sendEchoed((addr >> 6) & 0xff);
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
