// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// Journey: a live-data dashboard. Connect over Web Serial, poll every
// reading at once, watch the values follow the engine, disconnect.
import {
  allEngineStates,
  cruising,
  plantState,
  revCRom,
  virtualEcu,
  warmIdle,
} from './fixtures/index.js';
import { bench } from './support/bench.js';
import { settle, timed, useVirtualClock } from './support/clock.js';
import { approximately, readDashboard } from './support/dashboard.js';

useVirtualClock();

describe('live-data dashboard', () => {
  it.each(allEngineStates)('shows every reading for $name', async (state) => {
    const { ecu } = bench({ simulator: virtualEcu({ rom: revCRom, state }) });

    await settle(ecu.connect());

    expect(await settle(readDashboard(ecu))).toEqual(
      approximately(state.expected),
    );
  });

  it('follows the engine from idle to cruising between polls', async () => {
    const { ecu, simulator } = bench({
      simulator: virtualEcu({ rom: revCRom, state: warmIdle }),
    });

    await settle(ecu.connect());
    const atIdle = await settle(readDashboard(ecu));

    plantState(simulator, cruising);
    const atSpeed = await settle(readDashboard(ecu));

    expect(atIdle).toEqual(approximately(warmIdle.expected));
    expect(atSpeed).toEqual(approximately(cruising.expected));
  });

  it('refreshes the whole dashboard several times a second at 7812 baud', async () => {
    const { ecu } = bench({
      simulator: virtualEcu({ rom: revCRom, state: warmIdle }),
    });

    await settle(ecu.connect());
    const { elapsedMs } = await timed(() => readDashboard(ecu));

    // 27 readings, each a coarse address (two echoed bytes), a read command
    // and one or two bytes of data. The USB latency timer dominates.
    expect(elapsedMs).toBeLessThan(2000);
  });
});
