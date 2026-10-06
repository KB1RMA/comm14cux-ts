// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.
import { DEFAULT_READ_TIMEOUT_MS } from '../constants.js';
import { ProtocolError, ReadCancelledError, TimeoutError } from '../errors.js';
import type { ProtocolTraceEvent } from '../trace.js';
import type { Transport } from '../transport/types.js';
import { nextRead } from './readCount.js';

const ADDRESS_SPACE = 0x10000;
const COARSE_WINDOW = 64;
// Writes use the coarse-address command with a length code of 0.
const WRITE_LENGTH_CODE = 0;

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
  readonly #emit: ((event: ProtocolTraceEvent) => void) | undefined;
  #lastReadCoarseAddress = 0;
  #lastReadQuantity = 0;

  /**
   * Creates a protocol handler.
   *
   * @param transport - The link to the ECU.
   * @param timeoutMs - Silence timeout for each read, in milliseconds.
   * @param emit - Receives trace events. When omitted, nothing is built or reported.
   */
  constructor(
    transport: Transport,
    timeoutMs = DEFAULT_READ_TIMEOUT_MS,
    emit?: (event: ProtocolTraceEvent) => void,
  ) {
    this.#transport = transport;
    this.#timeoutMs = timeoutMs;
    this.#emit = emit;
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
    const emit = multiChunk ? this.#emit : undefined;
    const chunkCount = emit ? countChunks(length) : 0;
    let totalRead = 0;
    let chunkIndex = 0;

    try {
      while (totalRead < length) {
        if (multiChunk && isCancelled()) {
          this.#emit?.({
            type: 'read-cancelled',
            address: addr,
            length,
            bytesRead: totalRead,
          });
          throw new ReadCancelledError('Read cancelled');
        }

        const { count: quantity, code } = nextRead(length, totalRead);
        const chunkAddr = addr + totalRead;

        emit?.({
          type: 'read-chunk',
          address: chunkAddr,
          length: quantity,
          chunkIndex: chunkIndex++,
          chunkCount,
        });

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
        const readCommand = 0xc0 | (chunkAddr & 0x3f);

        await this.#transport.write(Uint8Array.of(readCommand));
        result.set(await this.#receive(quantity, [readCommand]), totalRead);
        totalRead += quantity;
        this.#lastReadQuantity = quantity;
      }
    } catch (error) {
      this.resetCache();
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

    const command = [0x80 | (addr & 0x3f), value];

    this.resetCache();
    await this.setCoarseAddr(addr, WRITE_LENGTH_CODE);
    await this.#sendEchoed(command, 0);
    await this.#sendEchoed(command, 1);
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
    const command = [((code << 2) | (addr >> 14)) & 0xff, (addr >> 6) & 0xff];

    await this.#sendEchoed(command, 0);
    await this.#sendEchoed(command, 1);
  }

  /**
   * Sends one byte of a command and checks that the ECU echoes it.
   *
   * @param command - Every byte of the command, for diagnostics.
   * @param position - Index in `command` of the byte to send.
   */
  async #sendEchoed(
    command: readonly number[],
    position: number,
  ): Promise<void> {
    const byte = command[position] ?? 0;

    await this.#transport.write(Uint8Array.of(byte));

    const [echo] = await this.#receive(1, command);

    if (echo !== byte) {
      const actual = echo ?? 0;

      this.#emit?.({
        type: 'echo-mismatch',
        expected: byte,
        received: actual,
        position,
        command,
      });
      throw new ProtocolError(
        `Echo mismatch: sent 0x${byte.toString(16)}, received 0x${actual.toString(16)}`,
        { expected: byte, actual, position, command },
      );
    }
  }

  /**
   * Reads from the transport, and adds the command that was awaiting a reply
   * to any timeout.
   *
   * @param length - Number of bytes wanted.
   * @param command - The command bytes just sent.
   * @returns Exactly `length` bytes.
   */
  async #receive(
    length: number,
    command: readonly number[],
  ): Promise<Uint8Array> {
    try {
      return await this.#transport.read(length, this.#timeoutMs);
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new TimeoutError(error.message, {
          timeoutMs: error.timeoutMs ?? this.#timeoutMs,
          requestedBytes: error.requestedBytes ?? length,
          receivedBytes: error.receivedBytes,
          command,
        });
      }

      throw error;
    }
  }
}

function countChunks(length: number): number {
  let count = 0;

  for (let read = 0; read < length; read += nextRead(length, read).count) {
    count++;
  }

  return count;
}

function assertUint16(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= ADDRESS_SPACE) {
    throw new RangeError(`Invalid ${name}: ${value}`);
  }
}
