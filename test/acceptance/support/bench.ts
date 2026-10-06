// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// The test bench: an application's `Ecu`, talking through the real
// `WebSerialTransport` to a `VirtualSerialPort` with a simulated ECU behind it.
import {
  Ecu,
  type EcuOptions,
  SimulatedTransport,
  WebSerialTransport,
  type WebSerialTransportOptions,
} from '@kb1rma/libcomm14cux-ts';
import { type CableOptions, VirtualSerialPort } from './virtualSerialPort.js';

/** Everything on the bench. */
export interface Bench {
  /** The object an application would use. */
  ecu: Ecu;
  /** The fake serial port, for unplugging and inspecting opens. */
  port: VirtualSerialPort;
  /** The simulated ECU, for planting memory and injecting faults. */
  simulator: SimulatedTransport;
}

/** How to set up the bench. */
export interface BenchOptions {
  simulator?: SimulatedTransport;
  cable?: CableOptions;
  transport?: WebSerialTransportOptions;
  ecu?: EcuOptions;
}

/**
 * Wires an `Ecu` to a simulated ECU through the Web Serial transport. Nothing
 * is opened until the test calls `ecu.connect()`.
 *
 * @param options - Bench set-up.
 * @returns The bench.
 */
export function bench(options: BenchOptions = {}): Bench {
  const simulator = options.simulator ?? new SimulatedTransport();
  const port = new VirtualSerialPort(simulator, options.cable);
  const ecu = new Ecu(
    new WebSerialTransport(port.asSerialPort(), options.transport),
    options.ecu,
  );

  return { ecu, port, simulator };
}
