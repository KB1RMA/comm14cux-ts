// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

/** Byte-level link to the ECU. The protocol layer uses nothing else. */
export interface Transport {
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  /** Resolves with exactly `length` bytes, or rejects with a TimeoutError. */
  read(length: number, timeoutMs: number): Promise<Uint8Array>;
}
