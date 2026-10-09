# Test specification

This is the behavioural specification for comm14cux-ts, derived from what [libcomm14cux](https://github.com/colinbourassa/libcomm14cux) does today (`protocol.c`, `data.c`, `setup.c`, `comm14cux.h`). Every behaviour below is covered by a test that uses only the library's public API. The v1 goal is to mirror libcomm14cux's public surface: one `Ecu` method per `c14cux_*` function.

Section numbers (§) are referenced from the header comment of each test file.

## Ground rules

- **Coverage:** `vitest.config.ts` enforces statements/lines ≥ 98 %, functions 100 %, branches ≥ 95 %. Do not lower thresholds to land a change; add tests, or remove dead code.
- **No hardware in tests.** Everything runs against `SimulatedTransport` (an in-memory 64 KiB ECU) or a fake `SerialPort`.
- **Public API only.** Tests import from `src/index.ts`, never from internal modules (`protocol/`, `decoders/`, `queue.ts`, `bytes.ts`), and act as a user would: through `Ecu`, `SimulatedTransport` and `WebSerialTransport`. Decoder boundary values are tested through the matching `Ecu` getter by planting bytes in the simulated memory. Shared helpers live in `src/test-support/`. If a branch cannot be reached through the public API, delete it instead of testing it directly.
- **Wire-level assertions** use `SimulatedTransport`'s write log, so tests can assert the exact bytes sent.
- **Surface mapping.** `c14cux_foo(info, &out)` becomes `ecu.foo(): Promise<Out>`; a `false` return becomes a rejected promise (`TimeoutError`, `ProtocolError`, `InvalidReadingError`, `ReadCancelledError`, `NotConnectedError`). The `c14cux_` prefix is dropped and names are camelCase; `c14cux_init`/`cleanup` are the constructor and `disconnect`. `connect` takes no device path or baud rate, because those belong to the `Transport` (`WebSerialTransport` is given the `SerialPort` and optional baud).
- **Divergences from the C library** are deliberate, minimal, and each has a test marked "deliberate divergence". They exist only where C leaves behaviour undefined (division by zero, `NaN` from `sqrt`, a function with no return statement), where C reads the wrong data (the coarse-address cache, §2.3), or to avoid stale state: the ROM revision and voltage coefficients are forgotten on `disconnect`, so reconnecting to a different ECU is safe. v1 adds nothing to the C library's feature set.
- Addresses and constants are taken from `comm14cux.h`. All multi-byte ECU values are big-endian.

## Capability map

| libcomm14cux function | Spec § | Test file |
|---|---|---|
| `c14cux_getByteCountForNextRead` | 2.1 | `src/ecu.readMem.test.ts` |
| `c14cux_setCoarseAddr` (+ read/write variants) | 2.2 | `src/ecu.readMem.test.ts`, `src/ecu.writeMem.test.ts` |
| `c14cux_readMem`, `c14cux_sendReadCmd`, `c14cux_cancelRead`, `c14cux_dumpROM` | 2.3 | `src/ecu.readMem.test.ts` |
| `c14cux_writeMem` | 2.4 | `src/ecu.writeMem.test.ts` |
| mutex around every operation | 3 | `src/ecu.serialisation.test.ts` |
| serial open/close, baud, timeouts | 4 | `src/transport/*.test.ts` |
| `c14cux_getCoolantTemp`, `c14cux_getFuelTemp` | 5.1 | `src/ecu.sensors.test.ts` |
| `c14cux_getRoadSpeed` | 5.2 | `src/ecu.sensors.test.ts` |
| `c14cux_getMAFReading` | 5.3 | `src/ecu.sensors.test.ts` |
| `c14cux_getIdleBypassMotorPosition`, `c14cux_getTargetIdle` | 5.4 | `src/ecu.sensors.test.ts` |
| `c14cux_getEngineRPM`, `c14cux_getRPMLimit` | 5.5 | `src/ecu.sensors.test.ts` |
| `c14cux_getThrottlePosition` | 5.6 | `src/ecu.sensors.test.ts` |
| `c14cux_getGearSelection` | 5.7 | `src/ecu.sensors.test.ts` |
| `c14cux_determineDataOffsets` | 5.8 | `src/ecu.romData.test.ts` |
| `c14cux_getMainVoltage` | 5.9 | `src/ecu.romData.test.ts` |
| `c14cux_getFuelMap`, `getCurrentFuelMap`, `getFuelMapRowIndex`, `getFuelMapColumnIndex`, `getRpmTable` | 5.10 | `src/ecu.romData.test.ts` |
| `c14cux_getLambdaTrimShort/Long`, `c14cux_getCOTrimVoltage` | 5.11 | `src/ecu.sensors.test.ts` |
| `c14cux_getFaultCodes`, `c14cux_clearFaultCodes` | 5.12 | `src/ecu.status.test.ts` |
| `getFuelPumpRelayState`, `isMILOn`, `getIdleMode`, `getScreenHeaterState`, `getACCompressorState`, `getPurgeValveState` | 5.13 | `src/ecu.status.test.ts` |
| `c14cux_getTuneRevision` | 5.14 | `src/ecu.status.test.ts` |
| `c14cux_getInjectorPulseWidth` | 5.15 | `src/ecu.sensors.test.ts` |
| `c14cux_connect/disconnect/isConnected`, `getLibraryVersion` | 6 | `src/ecu.connection.test.ts` |
| `c14cux_runFuelPump`, `c14cux_driveIdleAirControlMotor` | 6 | `src/ecu.actuators.test.ts` |

## 2. Protocol

### 2.1 Read chunking

A single ECU read returns 1–16, 80, 100, 400 or 512 bytes. For a longer read the next chunk size is the largest of 512, 400, 100, 80, 16 that fits in the remaining bytes, or the exact remainder when fewer than 16 remain. Note that 17–79 bytes remaining yields 16, then repeats. Length codes: `n` (1–16) → `n-1`; 80 → `0x10`; 100 → `0x11`; 400 → `0x12`; 512 → `0x13`; anything else is invalid; write commands use code 0.

### 2.2 Coarse address

Two bytes, each echoed by the ECU before the next is sent:

- byte 1 = `(lengthCode << 2) | (addr >> 14)`
- byte 2 = `(addr >> 6) & 0xFF`

Failure cases: wrong echo, no echo, write error. (The library only ever asks for lengths from §2.1, so an invalid length cannot occur.)

### 2.3 Read

After the coarse address, send `0xC0 | (addr & 0x3F)`. The ECU does not echo this byte; it begins streaming data. The coarse address is skipped when the chunk length equals the previous chunk's length and the address is in the same 64-byte block as the last coarse address (`addr >> 6 === lastCoarse >> 6`). **Deliberate divergence:** libcomm14cux stores the full, unaligned address and tests `lastCoarse <= addr < lastCoarse + 64`. The ECU latches only `addr >> 6`, so that window can reach into the next block and read the wrong bytes (for example a word at `0x005F` then one at `0x0082` returns the bytes at `0x0042`). The cache is also cleared on disconnect. The cache is cleared on any failed read and at the start of any write. `cancelRead()` (the one call that bypasses the queue) cancels every multi-chunk read requested before the call: one in progress stops after its in-flight chunk, and one still waiting in the queue is rejected before anything is sent. A cancelled read fails with `ReadCancelledError` and returns no partial data. Reads that fit in one chunk are never cancelled, and reads requested after the call are unaffected. **Deliberate divergence:** libcomm14cux clears the cancel flag when a read starts, so a cancel issued while the read is still waiting for the lock is lost.

### 2.4 Write

Four bytes, each echoed: coarse address (code 0), `0x80 | (addr & 0x3F)`, value.

## 3. CommandQueue

libcomm14cux holds a mutex for the duration of each public call. The queue gives the same guarantee: one task at a time, FIFO, and a rejection affects only its own caller. `disconnect` waits for an operation in progress.

## 4. Transports

### 4.1 SimulatedTransport

A behavioural model of the ECU side of the wire, backed by a 64 KiB image. It must be faithful enough that the protocol tests are meaningful: echoes on coarse-address and write bytes, no echo on the read command, correct streaming for every length code, and fault-injection switches (corrupt echo, go silent, fail write, and fail memory writes after a given number succeed, by dropping or corrupting the write command's echo while reads keep working).

### 4.2 WebSerialTransport

Tested against a fake `SerialPort`. Opens at 7812 baud, 8N1, no flow control (15625 optional). Read resolves with exactly N bytes or rejects with `TimeoutError` after 100 ms of silence (the interval timeout libcomm14cux configures); surplus bytes are retained for the next read.

## 5. Decoders

Each decoder lists the memory it reads, the formula, and boundary values.

| § | Reading | Source | Formula / rule |
|---|---|---|---|
| 5.1 | Coolant temp | `0x006A` (1 B) | 256-entry ADC→°F table, 0→266, 255→-13 |
| 5.1 | Fuel temp | `0x2006` (1 B) | same table |
| 5.2 | Road speed | `0x2003` (1 B km/h) | `trunc(kph × 0.621371192)` mph; 100→62, 255→158 |
| 5.3 | MAF direct | `0x0057` (2 B) | `raw / 1023`; reject > 1023 |
| 5.3 | MAF linearised | `0x204D` (2 B) | `raw / 17290`; reject > 17290 |
| 5.4 | Idle bypass | `0x006D` (1 B) | `(180 − min(raw,180)) / 180` |
| 5.4 | Target idle | `0x2051` (2 B) | raw RPM |
| 5.5 | Engine RPM | `0x007C` (2 B) | `0xFFFF`→0, else `trunc(7500000 / raw)` |
| 5.5 | RPM limit | `0x200C` (2 B) | `trunc(7500000 / raw)` |
| 5.6 | Throttle | `0x005F` (2 B), min `0x0051` | abs: `raw/1023`; corrected: `(raw−min)/(1023−min)`, clamp to 0; reject raw > 1023 |
| 5.7 | Gear | `0x2000` (1 B) | `<0x4D` park/neutral; `>0xB3` drive/reverse; else manual |
| 5.9 | Main voltage | `0x0055` (2 B) + coefficients | see below |
| 5.10 | Current map | `0x202C` (1 B) | reject > 5 |
| 5.10 | Row index | `0x005B` (1 B) | high nibble row (< 8), low nibble weighting |
| 5.10 | Column index | `0x005C` (1 B) | high nibble column (< 16), low nibble weighting |
| 5.11 | Lambda trim short | `0x0065` odd / `0x0067` even | `trunc(raw / 0x80) − 0x100` (−256..255) |
| 5.11 | Lambda trim long | `0x0042` odd / `0x0046` even | same |
| 5.11 | CO trim voltage | `0x0046` (2 B) | `5.0 × (raw >> 7) / 1024` |
| 5.12 | Fault codes | `0x0049`–`0x004E` (6 B) | bitfield, LSB-first within each byte |
| 5.13 | Fuel pump relay | `0x0002` bit 6 | on when **clear** |
| 5.13 | MIL | `0x0002` bit 0 | on when **clear** |
| 5.13 | Idle mode | `0x2047` bit 0 | on when **set** |
| 5.13 | Screen heater | `0x00DD` bit 2 | on when **clear** |
| 5.13 | A/C compressor | `0x008A` bit 3 | on when **clear** |
| 5.13 | Purge valve | `0x0096` (2 B) | `<4000` closed; `<29000` toggling; else open |
| 5.14 | Tune revision | `0xFFE9` (5 B) | 2 B BCD number, 1 B checksum fixer, 2 B ident |
| 5.15 | Injector pulse width | `0x0082` (2 B) | raw µs |

### 5.8 ROM revision detection

Read 16 bytes at `0xC23F`. If any exceeds `0x30` the ROM is **Rev C**. Otherwise read `0xC79B`: `0xFF` means **Rev A**, anything else **Rev B**. The result selects the fuel-map addresses (5.10) and main-voltage coefficient locations (5.9), and is cached until reconnect.

### 5.9 Main voltage

Coefficients A, B, C are fixed for Rev A (`0x64`, `0xBD`, `0x6180`) and read from the ROM for Rev B (`0xC79B/C/D`) and Rev C (`0xC7C3/4/5`; C is two bytes). The ECU computes a stored value from the ADC count with a quadratic; the library inverts it:

```
adc  = -(16 × (sqrt(4·A·stored − A·C + 64·B²) − 8·B)) / A
volts = 0.07 × adc − 0.09
```

Golden samples for each revision should be captured from a real ECU or derived from the C implementation and committed as fixtures.

### 5.10 Fuel maps

Map data is 128 bytes (8 rows × 16 columns), followed by a 2-byte adjustment factor; the row scaler is a separate byte.

| Map | Rev A / B | Rev C |
|---|---|---|
| 0 | `0xC000` (scaler `0xC1C9`) | `0xC000` (scaler `0xC1C9`) |
| 1 | `0xC23F` | `0xC267` |
| 2 | `0xC351` | `0xC379` |
| 3 | `0xC463` | `0xC48B` |
| 4 | `0xC575` | `0xC59D` |
| 5 | `0xC687` | `0xC6AF` |

Row scaler for maps 1–5 is at map offset + `0x10A`. The RPM table is sixteen 2-byte pulse widths at `0xC800 + column × 4`, converted to RPM and stored in reverse column order.

### 5.12 Fault code bytes

| Address | Faults (LSB first; `-` is spare) |
|---|---|
| `0x0049` | ROM checksum, lambda odd, lambda even, -, misfire odd, misfire even, airflow meter, tune resistor |
| `0x004A` | injector odd, -, injector even, coolant temp, throttle pot, pot hi / MAF lo, pot lo / MAF hi, purge leak |
| `0x004B` | -, mixture too lean, -, intake air leak, - (4 spare) |
| `0x004C` | low fuel pressure, - (3 spare), idle stepper, -, road speed, neutral switch |
| `0x004D` | - (4 spare), low pressure or air leak, fuel temp, - (2 spare) |
| `0x004E` | - (6 spare), battery disconnected, RAM checksum |

**Open question:** in `comm14cux.h` the field comments for `Misfire_Odd_Bank`, `Misfire_Even_Bank` and `Airflow_Meter` are shifted by one relative to their names. The TypeScript keys follow the C *field names* (`misfireOddBank`, …), so they match upstream, but the comments suggest the names may be mislabelled. Confirm against the ECU's documented fault code table before v1.

## 6. Ecu

Connection lifecycle (connecting twice is a no-op), raw `readMem`/`writeMem`, `dumpROM` (`0x4000` bytes from `0xC000`, cancellable with `cancelRead()`), and the two actuator commands:

- **Run fuel pump:** read port 1 (`0x0002`); write `0xFF` to the pump timer (`0x00AF`); write port 1 back with bit 6 cleared.
- **Drive idle air control:** read `0x008A`; clear (open, direction 0) or set (close, direction 1) bit 0 and write it back; write the step count to `0x0075`.

As in C, any direction other than 0 closes the valve. The C `c14cux_driveIdleAirControlMotor` ignores the results of its writes and has no return statement on any path, so its result is undefined. The TypeScript version reports failure if any step fails.

Every public `Ecu` call is queued (the C library locks only inside `readMem`/`writeMem`), so compound operations such as `runFuelPump` cannot be interleaved with another call.

## 7. Acceptance suite

`test/acceptance/` checks whole user journeys through the stack a browser application uses: `Ecu` → `WebSerialTransport` → `VirtualSerialPort` → `SimulatedTransport`. The unit tests above check each behaviour in isolation against an instant, in-memory link. This suite checks that the pieces work together over a link that takes time.

- **Runs:** `npm run test:acceptance` (against `src/`) and `npm run test:acceptance:dist` (builds, then runs against `dist/`). CI runs the dist form, so what is tested is what would be published. Tests import `'@kb1rma/libcomm14cux-ts'`. For the source run, `vitest.acceptance.config.ts` aliases that name to `src/index.ts`. For the dist run there is no alias: the name resolves through `package.json` `exports`, and `tsconfig.acceptance.dist.json` type-checks the tests against the published declarations.
- **Virtual cable** (`support/virtualSerialPort.ts`): a fake `SerialPort` that behaves like a USB serial adapter. Each byte takes 10 bit-times on the wire at the ECU's baud rate. The ECU replies after a short delay. The adapter passes bytes to the host in packets of up to 62, after a 16 ms latency timer. It also models the wrong baud rate (the ECU hears nothing), the cable being pulled (`NetworkError`, as in Chrome), the ECU being switched off and on, and one late reply. `SerialPort.close()` rejects while a stream is locked, as in the browser.
- **Virtual time** (`support/clock.ts`): only `setTimeout`, `clearTimeout` and `Date` are faked. `settle()` advances time one timer at a time until the operation finishes, and reports a deadlock if nothing is left scheduled. Durations are asserted in virtual time; a full ROM dump takes about 22 s at 7812 baud.
- **Fixtures** (`fixtures/`): synthetic Rev A, B and C ROM images; RAM snapshots for key-on, warm idle and cruising; fault-code blocks. Each comes with its expected readings, worked out by hand from §5. No real ROM data is included.

| Journey | File |
|---|---|
| Opening, sharing and reopening the port; baud rates | `connection.acceptance.test.ts` |
| Live-data dashboard polling every reading at once | `liveData.acceptance.test.ts` |
| Identifying an ECU, reading its calibration, dumping and cancelling the ROM, swapping ECUs | `romIdentification.acceptance.test.ts` |
| Reading and clearing faults; fuel pump and idle air control | `workshop.acceptance.test.ts` |
| Ignition off, cable pulled, noisy line, slow adapters, overlapping operations | `resilience.acceptance.test.ts` |

### 7.1 Known issues

- **A late reply knocks the link out of step.** If the ECU answers after the read timeout, its late bytes stay in the receive buffer and are read as the answer to the next command. Every later call then fails with `ProtocolError` until the application reconnects. libcomm14cux has the same weakness: it flushes the port only when connecting. Tracked by an `it.todo` in `resilience.acceptance.test.ts`.
- **`SimulatedTransport` has no command timeout.** The real firmware drops a half-received command after a period of silence (the `$00E7` counter in `serialPort.asm`) but keeps the latched address. The simulator waits forever, so after a failed exchange it can take the next command's first byte as the end of the old one. The resilience tests therefore allow a few retries after a fault, as an application would, instead of asserting how many calls fail.

## Not covered

- Real-hardware tests (FTDI cable, timing). These belong in a manual checklist, not CI.
- Platform serial setup in `setup.c` (termios, `ioctl` custom divisors, Win32 `DCB`). The Web Serial API replaces it; only the 7812/15625 baud and 100 ms timeout behaviours carry over.
- The `read14cux`/`write14cux` command-line tools.
- Convenience features beyond libcomm14cux (°C conversion, a live-data snapshot, progress callbacks, `AbortSignal` cancellation). These are candidates for a later release.
