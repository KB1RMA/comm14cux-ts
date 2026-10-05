// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

const FULLY_CLOSED = 180;

/**
 * Decodes the idle bypass motor position. 180 counts is fully closed.
 *
 * @param raw - The byte read from 0x006D.
 * @returns Position as a fraction from 0 (closed) to 1 (widest opening).
 */
export function decodeIdleBypassPosition(raw: number): number {
  return (FULLY_CLOSED - Math.min(raw, FULLY_CLOSED)) / FULLY_CLOSED;
}
