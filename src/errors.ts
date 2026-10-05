// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

/** Base class for every error thrown by this library. */
export class Comm14cuxError extends Error {
  /** The name of this error class. */
  override name = 'Comm14cuxError';
}

/** The ECU (or serial port) did not deliver the expected bytes in time. */
export class TimeoutError extends Comm14cuxError {
  /** The name of this error class. */
  override name = 'TimeoutError';
}

/** The ECU's reply did not match the protocol (for example a wrong echo). */
export class ProtocolError extends Comm14cuxError {
  /** The name of this error class. */
  override name = 'ProtocolError';
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
