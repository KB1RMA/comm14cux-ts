// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// A fake Web Serial port with a simulated ECU wired straight to it, for unit
// tests that need `WebSerialTransport`'s receive buffer. It has no timing of
// its own: the ECU answers as soon as bytes are written, unless replies are
// held back. Everything goes through the package entry point.
import type { SimulatedTransport } from '../index.js';

/** A fake port and the switches that control it. */
export interface WiredPort {
  /** The port, typed as `WebSerialTransport` expects. */
  port: SerialPort;
  /** Keeps the ECU's replies back until {@link WiredPort.releaseReplies}. */
  holdReplies(): void;
  /** Passes on every held reply, as one late chunk, and stops holding. */
  releaseReplies(): void;
  /** Delivers bytes to the host as if the ECU had sent them unasked. */
  inject(...bytes: number[]): void;
}

/**
 * Wires a fake `SerialPort` to a simulated ECU.
 *
 * @param ecu - The simulated ECU. It is opened on the first write.
 * @returns The port and its switches.
 */
export function wiredPort(ecu: SimulatedTransport): WiredPort {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let holding = false;
  const held: number[] = [];

  const deliver = (bytes: number[]) => {
    if (bytes.length > 0) {
      controller.enqueue(Uint8Array.from(bytes));
    }
  };

  const port = {
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream<Uint8Array>({
      async write(chunk) {
        if (!ecu.isOpen) {
          await ecu.open();
        }

        await ecu.write(chunk);

        const reply: number[] = [];

        for (;;) {
          try {
            const [byte = 0] = await ecu.read(1, 0);

            reply.push(byte);
          } catch {
            break;
          }
        }

        if (holding) {
          held.push(...reply);
        } else {
          deliver(reply);
        }
      },
    }),
  };

  return {
    port: port as unknown as SerialPort,
    holdReplies() {
      holding = true;
    },
    releaseReplies() {
      holding = false;
      deliver(held.splice(0));
    },
    inject(...bytes) {
      deliver(bytes);
    },
  };
}
