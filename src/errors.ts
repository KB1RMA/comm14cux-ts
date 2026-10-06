// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

/** Base class for every error thrown by this library. */
export class Comm14cuxError extends Error {
  /** The name of this error class. */
  override name = 'Comm14cuxError';
}

/** Details of a {@link TimeoutError}. Every field is optional. */
export interface TimeoutErrorDetails {
  /** The silence limit that expired, in milliseconds. */
  timeoutMs?: number | undefined;
  /** Number of bytes that were being waited for. */
  requestedBytes?: number | undefined;
  /** Number of those bytes that arrived before the timeout. */
  receivedBytes?: number | undefined;
  /** The bytes of the command that was awaiting a reply. */
  command?: readonly number[] | undefined;
}

/** The ECU (or serial port) did not deliver the expected bytes in time. */
export class TimeoutError extends Comm14cuxError {
  /** The name of this error class. */
  override name = 'TimeoutError';
  /** The silence limit that expired, in milliseconds. */
  readonly timeoutMs: number | undefined;
  /** Number of bytes that were being waited for. */
  readonly requestedBytes: number | undefined;
  /** Number of those bytes that arrived before the timeout. */
  readonly receivedBytes: number | undefined;
  /** The bytes of the command that was awaiting a reply. */
  readonly command: readonly number[] | undefined;

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param details - Structured details, where known.
   */
  constructor(message: string, details: TimeoutErrorDetails = {}) {
    super(message);
    this.timeoutMs = details.timeoutMs;
    this.requestedBytes = details.requestedBytes;
    this.receivedBytes = details.receivedBytes;
    this.command = details.command;
  }
}

/** Details of a {@link ProtocolError}. Every field is optional. */
export interface ProtocolErrorDetails {
  /** The byte that was sent, and so should have been echoed. */
  expected?: number | undefined;
  /** The byte the ECU sent back. */
  actual?: number | undefined;
  /** Index of the mismatched byte within `command`. */
  position?: number | undefined;
  /** All the bytes of the command being sent. */
  command?: readonly number[] | undefined;
}

/** The ECU's reply did not match the protocol (for example a wrong echo). */
export class ProtocolError extends Comm14cuxError {
  /** The name of this error class. */
  override name = 'ProtocolError';
  /** The byte that was sent, and so should have been echoed. */
  readonly expected: number | undefined;
  /** The byte the ECU sent back. */
  readonly actual: number | undefined;
  /** Index of the mismatched byte within `command`. */
  readonly position: number | undefined;
  /** All the bytes of the command being sent. */
  readonly command: readonly number[] | undefined;

  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   * @param details - Structured details, where known.
   */
  constructor(message: string, details: ProtocolErrorDetails = {}) {
    super(message);
    this.expected = details.expected;
    this.actual = details.actual;
    this.position = details.position;
    this.command = details.command;
  }
}

/** An operation was attempted while the transport was not open. */
export class NotConnectedError extends Comm14cuxError {
  /** The name of this error class. */
  override name = 'NotConnectedError';
}

/** A multi-chunk read was stopped by `cancelRead()`. */
export class ReadCancelledError extends Comm14cuxError {
  /** The name of this error class. */
  override name = 'ReadCancelledError';
}

/** The ECU returned data that is outside the range the firmware can produce. */
export class InvalidReadingError extends Comm14cuxError {
  /** The name of this error class. */
  override name = 'InvalidReadingError';
}
