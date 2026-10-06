// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// Assembles a simulated ECU from the fixtures in this folder.
import { SimulatedTransport } from '@kb1rma/libcomm14cux-ts';
import type { EngineState } from './engineStates.js';
import type { FaultFixture } from './faults.js';
import type { RomFixture } from './roms.js';

export * from './engineStates.js';
export * from './faults.js';
export * from './roms.js';

/** What to load into a simulated ECU. */
export interface VirtualEcuSpec {
  rom: RomFixture;
  state?: EngineState;
  faults?: FaultFixture;
}

/**
 * Builds a simulated ECU with the given ROM, RAM snapshot and stored faults.
 * The main-voltage reading is set to the ROM fixture's battery value.
 *
 * @param spec - The fixtures to load.
 * @returns The simulated ECU, not yet connected to anything.
 */
export function virtualEcu(spec: VirtualEcuSpec): SimulatedTransport {
  const ecu = new SimulatedTransport();

  ecu.loadRom(spec.rom.image);
  plantState(ecu, spec.state);
  ecu.memory.set(spec.faults?.bytes ?? [0, 0, 0, 0, 0, 0], 0x0049);
  ecu.memory.set(
    [spec.rom.battery.raw >> 8, spec.rom.battery.raw & 0xff],
    0x0055,
  );

  return ecu;
}

/**
 * Writes an engine state's RAM snapshot into a simulated ECU, as the engine
 * changing would.
 *
 * @param ecu - The simulated ECU.
 * @param state - The snapshot, or nothing to leave RAM alone.
 */
export function plantState(
  ecu: SimulatedTransport,
  state: EngineState | undefined,
): void {
  for (const [address, bytes] of state?.memory ?? []) {
    ecu.memory.set(bytes, address);
  }
}
