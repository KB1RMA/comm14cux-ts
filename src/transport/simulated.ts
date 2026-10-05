// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.
import { NotConnectedError, TimeoutError } from '../errors.js';
import { DataSize, MemoryOffset, ReadCountValue } from '../constants.js';
import type { Transport } from './types.js';

const MEMORY_SIZE = 0x10000;
// Silence after which the ECU abandons a half-received command. The firmware
// counts passes of its main loop with no byte received (the $00E7 counter in
// serialPort.asm) and gives up after 256; the length of that in ms is not
// documented, so this value is a choice. It is longer than one echo round
// trip through a slow USB adapter (about 125 ms with a 120 ms latency timer)
// and shorter than the 200 ms of silence the library leaves after a failed
// exchange at the default 100 ms read timeout.
const COMMAND_TIMEOUT_MS = 150;

type State = 'idle' | 'coarse2' | 'writeValue';

function lengthFromCode(code: number): number | undefined {
  if (code <= 0x0f) {
    return code + 1;
  }

  switch (code) {
    case ReadCountValue.Count1:
      return 0x50;
    case ReadCountValue.Count2:
      return 0x64;
    case ReadCountValue.Count3:
      return 0x190;
    case ReadCountValue.Count4:
      return 0x200;
    default:
      return undefined;
  }
}

/**
 * Emulates the ECU's side of the serial protocol over an in-memory 64 KiB
 * address space. Used for tests and for developing a UI without a car.
 *
 * Like the real ECU, it drops a half-received command after 150 ms with no
 * byte received, keeping the latched address. Time is taken from `Date.now()`.
 */
export class SimulatedTransport implements Transport {
  /** The ECU's address space. Tests may read and modify it directly. */
  readonly memory = new Uint8Array(MEMORY_SIZE);
  /** Every byte written to the ECU, in order. */
  readonly written: number[] = [];

  /** Fault injection: invert the next echoed byte. */
  corruptNextEcho = false;
  /** Fault injection: never reply. */
  silent = false;
  /** Fault injection: reject every write. */
  failWrites = false;
  /** Fault injection: stream at most this many bytes per read command. */
  streamLimit: number | undefined = undefined;

  #open = false;
  #state: State = 'idle';
  #output: number[] = [];
  #firstCoarse = 0;
  #coarse = 0;
  #latched = false;
  #lengthCode = 0;
  #writeAddr = 0;
  #lastByteAt = 0;

  /**
   * Whether the transport is open.
   *
   * @returns `true` between {@link SimulatedTransport.open} and {@link SimulatedTransport.close}.
   */
  get isOpen(): boolean {
    return this.#open;
  }

  /**
   * Places a 16 KiB firmware image at 0xC000 to 0xFFFF.
   *
   * @param image - The ROM image, exactly 0x4000 bytes.
   * @throws {@link RangeError} if the image is the wrong size.
   */
  loadRom(image: Uint8Array): void {
    if (image.length !== DataSize.ROM) {
      throw new RangeError(`ROM image must be ${DataSize.ROM} bytes`);
    }

    this.memory.set(image, MemoryOffset.ROMAddress);
  }

  /**
   * Opens the simulated link.
   *
   * @returns A promise that resolves immediately.
   */
  open(): Promise<void> {
    this.#open = true;

    return Promise.resolve();
  }

  /**
   * Closes the simulated link and discards any pending ECU output.
   *
   * @returns A promise that resolves immediately.
   */
  close(): Promise<void> {
    this.#open = false;
    this.#state = 'idle';
    this.#latched = false;
    this.#output = [];

    return Promise.resolve();
  }

  /**
   * Delivers bytes to the simulated ECU, which may queue a reply.
   *
   * @param data - Bytes to send.
   * @returns A promise that resolves once the bytes are delivered.
   * @throws {@link NotConnectedError} if the transport is closed.
   * @throws Error if {@link SimulatedTransport.failWrites} is set.
   */
  write(data: Uint8Array): Promise<void> {
    if (!this.#open) {
      return Promise.reject(new NotConnectedError('Transport is not open'));
    }

    if (this.failWrites) {
      return Promise.reject(new Error('Simulated write failure'));
    }

    for (const byte of data) {
      this.written.push(byte);
      this.#receive(byte);
    }

    return Promise.resolve();
  }

  /**
   * Takes bytes from the simulated ECU's reply.
   *
   * @param length - Number of bytes wanted.
   * @param _timeoutMs - Ignored; the simulation answers immediately.
   * @returns Exactly `length` bytes.
   * @throws {@link TimeoutError} if the ECU has not produced that many bytes.
   * @throws {@link NotConnectedError} if the transport is closed.
   */
  read(length: number, _timeoutMs: number): Promise<Uint8Array> {
    if (!this.#open) {
      return Promise.reject(new NotConnectedError('Transport is not open'));
    }

    if (this.#output.length < length) {
      this.#output = [];

      return Promise.reject(new TimeoutError('Simulated ECU is silent'));
    }

    return Promise.resolve(Uint8Array.from(this.#output.splice(0, length)));
  }

  #echo(byte: number): void {
    if (this.silent) {
      return;
    }

    if (this.corruptNextEcho) {
      this.corruptNextEcho = false;
      this.#output.push(byte ^ 0xff);
    } else {
      this.#output.push(byte);
    }
  }

  #receive(byte: number): void {
    const now = Date.now();

    if (this.#state !== 'idle' && now - this.#lastByteAt > COMMAND_TIMEOUT_MS) {
      // Too long since the last byte: drop the half-received command. The
      // latched address is kept, as in the firmware.
      this.#state = 'idle';
    }

    this.#lastByteAt = now;

    if (this.#state === 'writeValue') {
      this.memory[this.#writeAddr] = byte;
      this.#echo(byte);
      this.#state = 'idle';
      this.#latched = false;

      return;
    }

    if (this.#state === 'coarse2') {
      this.#coarse = ((this.#firstCoarse & 0x03) << 14) | (byte << 6);
      this.#echo(byte);
      this.#state = 'idle';
      this.#latched = true;

      return;
    }

    if (byte < 0x80) {
      // The firmware takes the read length from the latest first byte, even
      // if the second never arrives; the address changes only with both.
      this.#firstCoarse = byte;
      this.#lengthCode = (byte >> 2) & 0x1f;
      this.#echo(byte);
      this.#state = 'coarse2';
    } else if (!this.#latched) {
      // A command byte without a preceding coarse address is ignored.
    } else if ((byte & 0xc0) === 0xc0) {
      this.#streamRead(this.#coarse | (byte & 0x3f));
    } else {
      this.#writeAddr = this.#coarse | (byte & 0x3f);
      this.#echo(byte);
      this.#state = 'writeValue';
    }
  }

  #streamRead(address: number): void {
    if (this.silent) {
      return;
    }

    let length = lengthFromCode(this.#lengthCode) ?? 0;

    if (this.streamLimit !== undefined) {
      length = Math.min(length, this.streamLimit);
    }

    for (let i = 0; i < length; i++) {
      this.#output.push(this.memory[(address + i) % MEMORY_SIZE] ?? 0);
    }
  }
}
