// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Helpers shared by the test files. Everything here goes through the
// package entry point, as a user of the library would.
import {
  DataOffsetRev,
  Ecu,
  SimulatedTransport,
  type EcuOptions,
} from '../index.js';

/**
 * Creates an `Ecu` over a fresh `SimulatedTransport` and connects it.
 *
 * @param options - Extra `Ecu` options, such as `onTrace`.
 * @returns The connected `Ecu` and the simulated ECU behind it.
 */
export async function connected(options: EcuOptions = {}): Promise<{
  transport: SimulatedTransport;
  ecu: Ecu;
}> {
  const transport = new SimulatedTransport();
  const ecu = new Ecu(transport, { readTimeoutMs: 5, ...options });

  await ecu.connect();

  return { transport, ecu };
}

/**
 * Fills the simulated memory with a non-repeating pattern, so a read from
 * the wrong address cannot pass by accident.
 *
 * @param transport - The simulated ECU.
 */
export function fillPattern(transport: SimulatedTransport): void {
  transport.memory.forEach((_, i) => {
    transport.memory[i] = (i * 7 + (i >> 8)) & 0xff;
  });
}

/**
 * Sets memory so that the ROM looks like the given data layout.
 *
 * @param transport - The simulated ECU.
 * @param rev - The layout to imitate.
 */
export function setRevision(
  transport: SimulatedTransport,
  rev: DataOffsetRev,
): void {
  if (rev === DataOffsetRev.RevC) {
    transport.memory[0xc23f] = 0x40;
  } else {
    transport.memory.fill(0x10, 0xc23f, 0xc23f + 16);
    transport.memory[0xc79b] = rev === DataOffsetRev.RevA ? 0xff : 0x64;
  }
}

/** One command sent to the ECU, decoded from the transport's write log. */
export type WireCommand =
  | { kind: 'coarse'; lengthCode: number; address: number }
  | { kind: 'read'; low: number }
  | { kind: 'write'; low: number; value: number };

/**
 * Splits the bytes written to the ECU back into commands.
 *
 * @param written - `SimulatedTransport.written`.
 * @returns The commands, in order.
 */
export function parseWire(written: readonly number[]): WireCommand[] {
  const commands: WireCommand[] = [];

  for (let i = 0; i < written.length; i++) {
    const byte = written[i] ?? 0;

    if (byte < 0x80) {
      const second = written[++i] ?? 0;

      commands.push({
        kind: 'coarse',
        lengthCode: byte >> 2,
        address: ((byte & 0x03) << 14) | (second << 6),
      });
    } else if (byte >= 0xc0) {
      commands.push({ kind: 'read', low: byte & 0x3f });
    } else {
      commands.push({
        kind: 'write',
        low: byte & 0x3f,
        value: written[++i] ?? 0,
      });
    }
  }

  return commands;
}

const PRESET_LENGTHS: Record<number, number> = {
  0x10: 80,
  0x11: 100,
  0x12: 400,
  0x13: 512,
};

/**
 * Gives the size of each read chunk the ECU was asked for.
 *
 * @param written - `SimulatedTransport.written`.
 * @returns One length per read command, in order.
 */
export function readChunkLengths(written: readonly number[]): number[] {
  const lengths: number[] = [];
  let current = 0;

  for (const command of parseWire(written)) {
    if (command.kind === 'coarse') {
      current =
        command.lengthCode <= 0x0f
          ? command.lengthCode + 1
          : (PRESET_LENGTHS[command.lengthCode] ?? -1);
    } else if (command.kind === 'read') {
      lengths.push(current);
    }
  }

  return lengths;
}
