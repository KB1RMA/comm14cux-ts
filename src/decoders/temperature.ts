// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.
import { InvalidReadingError } from '../errors.js';

/** ADC count to degrees Fahrenheit (`temperature_adc_to_degrees_f`). */
export const TEMPERATURE_ADC_TO_DEGREES_F: readonly number[] = [
  266, 264, 260, 258, 255, 253, 249, 248, 244, 242, 239, 237, 233, 231, 228,
  226, 222, 221, 219, 217, 215, 213, 212, 210, 208, 206, 204, 203, 201, 199,
  197, 195, 194, 192, 190, 188, 186, 185, 183, 181, 179, 177, 176, 174, 172,
  170, 168, 167, 165, 163, 161, 159, 158, 158, 156, 154, 152, 150, 149, 147,
  145, 145, 143, 141, 140, 138, 138, 136, 136, 134, 132, 132, 131, 131, 129,
  129, 127, 125, 125, 123, 123, 122, 122, 120, 120, 118, 118, 116, 116, 114,
  114, 113, 113, 111, 111, 109, 109, 107, 107, 105, 105, 104, 104, 102, 102,
  100, 100, 98, 98, 96, 96, 95, 95, 95, 93, 93, 91, 91, 89, 89, 87, 87, 86, 86,
  84, 84, 82, 82, 82, 82, 80, 80, 78, 78, 78, 77, 77, 75, 75, 73, 73, 73, 71,
  71, 71, 69, 69, 68, 68, 66, 66, 64, 64, 62, 62, 60, 60, 59, 59, 57, 57, 57,
  55, 55, 53, 53, 51, 51, 50, 50, 48, 48, 46, 46, 44, 44, 44, 44, 42, 42, 42,
  41, 41, 41, 39, 39, 37, 37, 37, 35, 35, 35, 35, 33, 33, 32, 32, 31, 31, 29,
  29, 27, 27, 25, 25, 23, 23, 22, 22, 22, 20, 20, 18, 18, 18, 16, 16, 14, 14,
  13, 13, 13, 11, 11, 11, 9, 9, 7, 7, 5, 5, 4, 4, 2, 2, 0, 0, -2, -2, -4, -4,
  -4, -5, -5, -7, -7, -7, -9, -9, -9, -11, -11, -11, -13, -13, -13,
];

/** Converts a coolant or fuel temperature sensor ADC count to °F. */
export function decodeTemperatureF(adcCount: number): number {
  const degrees = TEMPERATURE_ADC_TO_DEGREES_F[adcCount];

  if (degrees === undefined) {
    throw new InvalidReadingError(`Invalid temperature ADC count: ${adcCount}`);
  }

  return degrees;
}
