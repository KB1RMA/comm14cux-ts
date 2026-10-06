// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

/** Fields shared by every trace event. */
export interface TraceBase {
  /** Wall-clock time the event was emitted, in milliseconds since the Unix epoch (`Date.now()`). */
  timestamp: number;
}

/** Fields shared by events that belong to one public {@link Ecu} operation. */
export interface OperationTraceBase extends TraceBase {
  /** Sequence number of the operation, starting at 1 for each {@link Ecu}. */
  operationId: number;
  /** Name of the public method, for example `getEngineRPM`. */
  operation: string;
}

/** An operation waited behind earlier operations in the queue. Not emitted if it ran at once. */
export interface QueueWaitTrace extends OperationTraceBase {
  /** Identifies the kind of event. */
  type: 'queue-wait';
  /** Time from the call to the operation starting, in milliseconds. */
  waitMs: number;
  /** Number of operations that were running or queued when this one was called. */
  ahead: number;
}

/** An operation began running (after any queue wait). */
export interface OperationStartTrace extends OperationTraceBase {
  /** Identifies the kind of event. */
  type: 'operation-start';
  /** First address, for `readMem` and `dumpROM`. */
  address?: number;
  /** Number of bytes, for `readMem` and `dumpROM`. */
  length?: number;
}

/** An operation finished, by returning or by rejecting. */
export interface OperationEndTrace extends OperationTraceBase {
  /** Identifies the kind of event. */
  type: 'operation-end';
  /** First address, for `readMem` and `dumpROM`. */
  address?: number;
  /** Number of bytes, for `readMem` and `dumpROM`. */
  length?: number;
  /** Time spent running, excluding any queue wait, in milliseconds. */
  durationMs: number;
  /** `true` if the operation resolved. */
  ok: boolean;
  /** What the operation rejected with, when `ok` is `false`. */
  error?: unknown;
}

/** One chunk of a read that is split into several commands. Not emitted for single-chunk reads. */
export interface ReadChunkTrace extends OperationTraceBase {
  /** Identifies the kind of event. */
  type: 'read-chunk';
  /** Address of this chunk. */
  address: number;
  /** Number of bytes in this chunk. */
  length: number;
  /** Position of this chunk in the read, from 0. */
  chunkIndex: number;
  /** Number of chunks the whole read needs. */
  chunkCount: number;
}

/** The ECU echoed a command byte wrongly. Emitted just before {@link ProtocolError} is thrown. */
export interface EchoMismatchTrace extends OperationTraceBase {
  /** Identifies the kind of event. */
  type: 'echo-mismatch';
  /** The byte that was sent, and so should have been echoed. */
  expected: number;
  /** The byte the ECU sent back. */
  received: number;
  /** Index of the mismatched byte within `command`. */
  position: number;
  /** All the bytes of the command being sent, for example the two bytes of a coarse address. */
  command: readonly number[];
}

/** {@link Ecu.cancelRead} was called. */
export interface CancelReadTrace extends TraceBase {
  /** Identifies the kind of event. */
  type: 'cancel-read';
  /** Number of operations that were running or queued, and so may be cancelled. Single-chunk reads among them are not. */
  outstanding: number;
}

/** A read stopped because of {@link Ecu.cancelRead}. */
export interface ReadCancelledTrace extends OperationTraceBase {
  /** Identifies the kind of event. */
  type: 'read-cancelled';
  /** First address of the read. */
  address: number;
  /** Number of bytes the read was asked for. */
  length: number;
  /** Number of bytes that had been read before it stopped. */
  bytesRead: number;
}

/** A chunk of bytes arrived from the serial port. Emitted by {@link WebSerialTransport}. */
export interface SerialChunkTrace extends TraceBase {
  /** Identifies the kind of event. */
  type: 'serial-chunk';
  /** Number of bytes in the chunk, as the adapter delivered it. */
  size: number;
  /**
   * Time since the previous chunk was taken from the port, in milliseconds;
   * `undefined` for the first chunk after the transport opens.
   */
  sinceLastChunkMs: number | undefined;
  /** How long the read waited for this chunk, in milliseconds. */
  waitedMs: number;
}

/**
 * A diagnostic event. Pass a handler as {@link EcuOptions.onTrace} (and
 * {@link WebSerialTransportOptions.onTrace}) and switch on `type`.
 */
export type TraceEvent =
  | QueueWaitTrace
  | OperationStartTrace
  | OperationEndTrace
  | ReadChunkTrace
  | EchoMismatchTrace
  | CancelReadTrace
  | ReadCancelledTrace
  | SerialChunkTrace;

/** The events that belong to one operation. */
export type OperationTraceEvent = Exclude<
  TraceEvent,
  CancelReadTrace | SerialChunkTrace
>;

/** An operation event without the fields the `Ecu` fills in. */
export type Unstamped<E extends OperationTraceEvent = OperationTraceEvent> =
  E extends unknown ? Omit<E, keyof OperationTraceBase> : never;

/** The events the protocol layer emits, before the `Ecu` adds the operation. */
export type ProtocolTraceEvent = Unstamped<
  ReadChunkTrace | EchoMismatchTrace | ReadCancelledTrace
>;

/**
 * Makes a hook safe to call from library code: an exception thrown by the
 * hook is swallowed, so tracing can never change how an operation ends.
 *
 * @param hook - The application's handler.
 * @returns A function that calls `hook`.
 */
export function guardTrace<E>(hook: (event: E) => void): (event: E) => void {
  return (event) => {
    try {
      hook(event);
    } catch {
      // A broken logger must not break the connection.
    }
  };
}
