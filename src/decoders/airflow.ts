// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { InvalidReadingError } from '../errors.js';

const DIRECT_MAX = 1023;
const LINEAR_MAX = 17290;

/** MAF "direct" reading as a fraction (0..1) of the highest measurement. */
export function decodeMafDirect(raw: number): number {
  if (raw > DIRECT_MAX) {
    throw new InvalidReadingError(`MAF direct reading out of range: ${raw}`);
  }

  return raw / DIRECT_MAX;
}

/** MAF "linearized" reading as a fraction (0..1) of the highest measurement. */
export function decodeMafLinear(raw: number): number {
  if (raw > LINEAR_MAX) {
    throw new InvalidReadingError(`MAF linear reading out of range: ${raw}`);
  }

  return raw / LINEAR_MAX;
}
