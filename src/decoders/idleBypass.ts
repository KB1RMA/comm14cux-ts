// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

const FULLY_CLOSED = 180;

/** Idle bypass motor position as a fraction (0..1) of the widest opening. */
export function decodeIdleBypassPosition(raw: number): number {
  return (FULLY_CLOSED - Math.min(raw, FULLY_CLOSED)) / FULLY_CLOSED;
}
