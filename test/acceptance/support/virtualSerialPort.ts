// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// A stand-in for a Web Serial `SerialPort` with a USB serial cable and an ECU
// on the other end. The ECU is a `SimulatedTransport` from the public API; the
// cable adds what a real link adds: time on the wire at the ECU's baud rate,
// the ECU's response delay, and a USB adapter that hands bytes to the host in
// packets after a latency timer. Everything is scheduled with `setTimeout`, so
// tests run it under Vitest's fake timers (see `clock.ts`).
import { BAUD, type SimulatedTransport } from '@kb1rma/libcomm14cux-ts';

/** How the cable and ECU behave. */
export interface CableOptions {
  /** Baud rate the ECU's serial port runs at. Defaults to 7812. */
  ecuBaudRate?: number;
  /**
   * How long the adapter holds received bytes before passing them on, in ms.
   * FTDI adapters default to 16.
   */
  latencyMs?: number;
  /** Most bytes the adapter passes on in one packet. 62 for a full-speed FTDI chip. */
  packetSize?: number;
  /** Time the ECU takes to notice a byte and start its reply, in ms. */
  ecuResponseMs?: number;
}

interface Packet {
  bytes: number[];
  flushAt: number;
  timer: ReturnType<typeof setTimeout>;
}

// 8N1: a start bit, eight data bits and a stop bit.
const BITS_PER_BYTE = 10;

/**
 * Builds a `DOMException`-like error with the given name, as the Web Serial
 * API rejects with.
 *
 * @param message - Error message.
 * @param name - The `DOMException` name.
 * @returns The error.
 */
function serialError(message: string, name: string): DOMException {
  return new DOMException(message, name);
}

/** A fake `SerialPort` wired to a simulated ECU through a simulated cable. */
export class VirtualSerialPort {
  /** The ECU on the far end of the cable. */
  readonly ecu: SimulatedTransport;
  /** Options passed to each successful `open()`, in order. */
  readonly opens: SerialOptions[] = [];

  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;

  readonly #ecuBaudRate: number;
  readonly #latencyMs: number;
  readonly #packetSize: number;
  readonly #ecuResponseMs: number;
  #controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  #hostBaudRate = 0;
  #pluggedIn = true;
  #powered = true;
  #extraDelayMs = 0;
  #hostLineFreeAt = 0;
  #ecuLineFreeAt = 0;
  #packet: Packet | undefined;
  #timers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Connects a cable to a simulated ECU.
   *
   * @param ecu - The simulated ECU. Its memory and fault-injection switches
   * stay available to the test.
   * @param options - Cable and ECU timing.
   */
  constructor(ecu: SimulatedTransport, options: CableOptions = {}) {
    this.ecu = ecu;
    this.#ecuBaudRate = options.ecuBaudRate ?? BAUD;
    this.#latencyMs = options.latencyMs ?? 16;
    this.#packetSize = options.packetSize ?? 62;
    this.#ecuResponseMs = options.ecuResponseMs ?? 1;
  }

  /**
   * Time one byte spends on the wire, in ms.
   *
   * @returns Milliseconds per byte at the ECU's baud rate.
   */
  get byteTimeMs(): number {
    return (BITS_PER_BYTE * 1000) / this.#ecuBaudRate;
  }

  /**
   * Whether the port is open.
   *
   * @returns `true` between a successful `open()` and `close()`.
   */
  get isOpen(): boolean {
    return this.readable !== null;
  }

  /**
   * Returns this object typed as the `SerialPort` the library expects.
   *
   * @returns This port.
   */
  asSerialPort(): SerialPort {
    return this as unknown as SerialPort;
  }

  /**
   * Opens the port, as `SerialPort.open()` does.
   *
   * @param options - Serial settings.
   * @throws `InvalidStateError` if already open; `NetworkError` if unplugged.
   */
  open(options: SerialOptions): Promise<void> {
    if (this.isOpen) {
      return Promise.reject(
        serialError('The port is already open.', 'InvalidStateError'),
      );
    }

    if (!this.#pluggedIn) {
      return Promise.reject(
        serialError('Failed to open serial port.', 'NetworkError'),
      );
    }

    this.opens.push(options);
    this.#hostBaudRate = options.baudRate;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#controller = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => this.#fromHost(chunk),
    });

    return Promise.resolve();
  }

  /**
   * Closes the port, as `SerialPort.close()` does. Bytes still in the cable
   * are lost.
   *
   * @throws `InvalidStateError` if not open; `TypeError` if a stream is
   * still locked by a reader or writer.
   */
  close(): Promise<void> {
    if (!this.isOpen) {
      return Promise.reject(
        serialError('The port is already closed.', 'InvalidStateError'),
      );
    }

    if (this.readable?.locked || this.writable?.locked) {
      return Promise.reject(
        new TypeError('Cannot close a port whose streams are locked'),
      );
    }

    this.#reset();

    return Promise.resolve();
  }

  /**
   * Pulls the USB cable out. The open stream errors with `NetworkError`, as
   * in a browser, and the port cannot be opened again until
   * {@link VirtualSerialPort.plugIn}.
   */
  unplug(): void {
    this.#pluggedIn = false;
    this.#cancelDeliveries();
    this.#controller?.error(
      serialError('The device has been lost.', 'NetworkError'),
    );
    // The browser drops a lost port's streams; closing it is still allowed.
  }

  /** Plugs the cable back in. The port must be opened again. */
  plugIn(): void {
    this.#pluggedIn = true;
  }

  /**
   * Switches the ECU off (ignition off). It stops listening at once; anything
   * it was already sending still arrives.
   */
  powerOff(): void {
    this.#powered = false;
  }

  /**
   * Switches the ECU back on. It boots with its serial state reset, as after
   * a real power cycle; its memory is left as it was.
   *
   * @returns A promise that resolves once the ECU is listening.
   */
  async powerOn(): Promise<void> {
    await this.ecu.close();
    await this.ecu.open();
    this.#powered = true;
  }

  /**
   * Makes the ECU's next reply late, as when its main loop is busy.
   *
   * @param ms - Extra delay before the next reply starts, in ms.
   */
  delayNextReply(ms: number): void {
    this.#extraDelayMs = ms;
  }

  #reset(): void {
    this.#cancelDeliveries();
    this.readable = null;
    this.writable = null;
    this.#controller = undefined;
  }

  #cancelDeliveries(): void {
    for (const timer of this.#timers) {
      clearTimeout(timer);
    }

    this.#timers.clear();
    this.#packet = undefined;
  }

  #schedule(at: number, task: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(
      () => {
        this.#timers.delete(timer);
        task();
      },
      Math.max(0, at - Date.now()),
    );

    this.#timers.add(timer);

    return timer;
  }

  #fromHost(chunk: Uint8Array): void {
    if (!this.#pluggedIn) {
      throw serialError('The device has been lost.', 'NetworkError');
    }

    const bytes = Uint8Array.from(chunk);
    const sentAt =
      Math.max(Date.now(), this.#hostLineFreeAt) +
      bytes.length * this.byteTimeMs;

    this.#hostLineFreeAt = sentAt;

    // At the wrong baud rate the ECU sees only framing errors.
    if (this.#hostBaudRate !== this.#ecuBaudRate || !this.#powered) {
      return;
    }

    const delay = this.#ecuResponseMs + this.#extraDelayMs;

    this.#extraDelayMs = 0;
    this.#schedule(sentAt + delay, () => {
      // Switched off while the bytes were still on the wire.
      if (!this.#powered) {
        return;
      }

      // An ECU that cannot take the bytes (the simulator's `failWrites`)
      // simply does not answer.
      this.#ecuReceives(bytes).catch(() => undefined);
    });
  }

  async #ecuReceives(bytes: Uint8Array): Promise<void> {
    if (!this.ecu.isOpen) {
      await this.ecu.open();
    }

    await this.ecu.write(bytes);

    // The simulated ECU queues its whole reply at once; take it a byte at a
    // time until it has nothing more to say.
    const reply: number[] = [];

    for (;;) {
      try {
        const [byte = 0] = await this.ecu.read(1, 0);

        reply.push(byte);
      } catch {
        break;
      }
    }

    let arrival = Math.max(Date.now(), this.#ecuLineFreeAt);

    for (const byte of reply) {
      arrival += this.byteTimeMs;
      this.#adapterReceives(byte, arrival);
    }

    this.#ecuLineFreeAt = arrival;
  }

  // The adapter collects bytes into a packet, sent when it is full or when the
  // latency timer runs out after its first byte.
  #adapterReceives(byte: number, at: number): void {
    const packet = this.#packet;

    if (
      packet &&
      at <= packet.flushAt &&
      packet.bytes.length < this.#packetSize
    ) {
      packet.bytes.push(byte);

      if (packet.bytes.length === this.#packetSize) {
        clearTimeout(packet.timer);
        this.#timers.delete(packet.timer);
        packet.flushAt = at;
        packet.timer = this.#schedule(at, () => {
          this.#deliver(packet);
        });
      }

      return;
    }

    const flushAt = at + this.#latencyMs;
    const next: Packet = {
      bytes: [byte],
      flushAt,
      timer: this.#schedule(flushAt, () => {
        this.#deliver(next);
      }),
    };

    this.#packet = next;
  }

  #deliver(packet: Packet): void {
    if (this.#packet === packet) {
      this.#packet = undefined;
    }

    this.#controller?.enqueue(Uint8Array.from(packet.bytes));
  }
}
