// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { InvalidReadingError } from '../errors.js';

const DIRECT_MAX = 1023;
const LINEAR_MAX = 17290;

/**
 * Decodes the "direct" mass airflow reading, which changes linearly with
 * sensor voltage but logarithmically with airflow.
 *
 * @param raw - The 10-bit reading, 0 to 1023.
 * @returns Airflow as a fraction from 0 to 1 of the highest measurement.
 * @throws {@link InvalidReadingError} if `raw` is above 1023.
 */
export function decodeMafDirect(raw: number): number {
  if (raw > DIRECT_MAX) {
    throw new InvalidReadingError(`MAF direct reading out of range: ${raw}`);
  }

  return raw / DIRECT_MAX;
}

/**
 * Decodes the "linearized" mass airflow reading, which changes linearly with
 * airflow.
 *
 * @param raw - The reading, 0 to 17290.
 * @returns Airflow as a fraction from 0 to 1 of the highest measurement.
 * @throws {@link InvalidReadingError} if `raw` is above 17290.
 */
export function decodeMafLinear(raw: number): number {
  if (raw > LINEAR_MAX) {
    throw new InvalidReadingError(`MAF linear reading out of range: ${raw}`);
  }

  return raw / LINEAR_MAX;
}
