# libcomm14cux-ts

TypeScript library for communicating with the Lucas 14CUX engine ECU over its serial diagnostic port, using the Web Serial API.

> **Status:** pre-release. The v1 goal is to mirror the public surface of libcomm14cux as closely as possible; every function of the C library has a corresponding method on `Ecu`.

## Purpose

The Lucas 14CUX was fitted to Rover V8 engines in Land Rover vehicles from 1990 to 1995, and to low-volume sports cars (TVR, Morgan, etc.) through the 1990s. Its diagnostic serial port gives direct access to the ECU's memory, which exposes live engine data, fault codes, fuel maps and the firmware ROM.

The existing tool for this is [RoverGauge](https://github.com/colinbourassa/rovergauge), a Qt desktop app built on the C library [libcomm14cux](https://github.com/colinbourassa/libcomm14cux), both by Colin Bourassa. This project ports the library's protocol and data-decoding logic to TypeScript.

This project is not affiliated with or endorsed by the author of libcomm14cux or RoverGauge.

## Installation

```sh
npm install @kb1rma/libcomm14cux-ts
```

## Usage

```ts
import { Ecu, WebSerialTransport, AirflowType } from '@kb1rma/libcomm14cux-ts';

const port = await navigator.serial.requestPort();
const ecu = new Ecu(new WebSerialTransport(port));

await ecu.connect();
console.log(await ecu.getEngineRPM());
console.log(await ecu.getMAFReading(AirflowType.Linearized));
await ecu.disconnect();
```

Methods are named after the `c14cux_*` functions (`getCoolantTemp`, `getFuelMap`, `clearFaultCodes`, …). Where the C functions return `false`, these methods reject with an error from the `Comm14cuxError` family.

## Diagnostics

To see what the library is doing, for example to log a remote user's session, pass an `onTrace` handler. Each event has a `type` and a `timestamp`; switch on `type`.

```ts
import { Ecu, WebSerialTransport, type TraceEvent } from '@kb1rma/libcomm14cux-ts';

// An Error's message and stack are not enumerable, so copy them for JSON.
const onTrace = (event: TraceEvent) =>
  console.debug(
    JSON.stringify(event, (_key, value: unknown) =>
      value instanceof Error
        ? { ...value, name: value.name, message: value.message }
        : value,
    ),
  );
const ecu = new Ecu(new WebSerialTransport(port, { onTrace }), { onTrace });
```

| `type` | Emitted | Main fields |
|---|---|---|
| `operation-start` / `operation-end` | around every public call, including `connect` and `disconnect` | `operation` (method name, e.g. `getEngineRPM`), `operationId`, `address` and `length` (`readMem`, `dumpROM`); `durationMs`, `ok`, `error` |
| `queue-wait` | when a call had to wait behind earlier calls | `waitMs`, `ahead` |
| `read-chunk` | for each chunk of a read split into several commands | `address`, `length`, `chunkIndex`, `chunkCount` |
| `echo-mismatch` | just before a `ProtocolError` for a wrong echo | `expected`, `received`, `position`, `command` |
| `cancel-read` | when `cancelRead()` is called | `outstanding` (calls running or queued) |
| `read-cancelled` | for each read that `cancelRead()` stopped | `address`, `length`, `bytesRead` |
| `serial-chunk` | `WebSerialTransport` only: each chunk the port delivered | `size`, `sinceLastChunkMs`, `waitedMs` |

Events other than `cancel-read` and `serial-chunk` carry the `operation` and `operationId` they belong to, so a log can be grouped by call.

- **Chunks from the adapter.** `serial-chunk` shows how the USB adapter splits the ECU's reply (its latency timer and packet size), which the `Ecu` never sees because `WebSerialTransport` joins chunks into the reads it is asked for. The timestamp is when the transport took the chunk from the port; a chunk that arrives while no read is waiting is taken on the next read.
- **Errors carry the same detail.** `ProtocolError` has `expected`, `actual`, `position` and `command`; `TimeoutError` has `timeoutMs`, `requestedBytes`, `receivedBytes` and `command`. They are set whether or not a handler is passed.
- **Cost.** Without a handler no event objects are built and no clocks are read. A handler runs synchronously, so keep it quick; an exception it throws is ignored.
- **Not traced.** Calls rejected for invalid arguments before any I/O (for example `getFuelMap(9)`) emit nothing.

## Scope

Capabilities, matching what libcomm14cux provides:

- **Live data:** engine RPM, road speed, coolant and fuel temperature, MAF reading, throttle position, short- and long-term lambda trims, main voltage, idle bypass motor position, target idle, injector pulse width, gear selection, CO trim voltage, MIL, fuel pump relay, purge valve and other output states
- **Fault codes:** read and clear
- **Fuel maps:** read any of the maps, the RPM table and the current map row/column indices
- **ROM:** dump the 16 KB firmware image, read tune revision and ident
- **Tests:** run the fuel pump; drive the idle air control motor
- **Raw access:** read and write arbitrary memory addresses

## Hardware

The library needs the same interface cable as RoverGauge: a 5 V FTDI USB-to-serial cable with its Rx line inverted in the FTDI EEPROM and a ~390 Ω resistor between Rx and GND. See the [RoverGauge README](https://github.com/colinbourassa/rovergauge#building-interface-cable) for build instructions.

**Recommended:** while programming the Rx inversion with FT_PROG (or `ft232r_prog` on Linux), also set the FTDI **latency timer to 1–2 ms**. The protocol waits for an echo of almost every command byte, and the default 16 ms latency timer delays each one. Web Serial cannot change this setting, so it has to be stored in the cable's EEPROM.

## Design

```
┌─────────────────────────────────────────────┐
│ Ecu            high-level, typed readings   │  getEngineRpm(), getFaultCodes(), dumpRom() …
├─────────────────────────────────────────────┤
│ Decoders       pure functions, no I/O       │  raw bytes → engineering units
├─────────────────────────────────────────────┤
│ Protocol       readMem / writeMem           │  command framing, echo checks, coarse-address cache
├─────────────────────────────────────────────┤
│ CommandQueue   one operation at a time      │  replaces libcomm14cux's mutex
├─────────────────────────────────────────────┤
│ Transport      bytes in / bytes out         │  WebSerialTransport │ SimulatedTransport
└─────────────────────────────────────────────┘
```

### Transport

A minimal interface so the protocol code never touches a platform API directly:

```ts
interface Transport {
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  /** Resolves with exactly `length` bytes, or rejects with a TimeoutError. */
  read(length: number, timeoutMs: number): Promise<Uint8Array>;
}
```

- **`WebSerialTransport`** wraps a `SerialPort` and opens it at **7812 baud, 8N1, no flow control**. An option allows 15625 baud for ECUs running modified double-speed firmware. The default read timeout is 100 ms of silence, matching libcomm14cux.
- **`SimulatedTransport`** emulates the ECU's side of the protocol over an in-memory address space. It is used for tests and for developing the UI without a car.

Electron apps use `WebSerialTransport` as-is. Other transports (for example Node's `serialport`) can be added without changing the layers above.

### Protocol

All ECU access is memory reads and writes:

| Step | Bytes sent | ECU response |
|---|---|---|
| Set coarse address | `(lenCode << 2) \| (addr >> 14)`, then `(addr >> 6) & 0xFF` | Echoes each byte |
| Read | `0xC0 \| (addr & 0x3F)` | Streams the requested bytes (no echo) |
| Write | `0x80 \| (addr & 0x3F)`, then the value | Echoes each byte |

- A single read returns 1–16, 80, 100, 400 or 512 bytes. Longer reads are split into chunks.
- When the next read uses the same length and falls in the same 64-byte block as the last coarse address, the coarse-address step is skipped. libcomm14cux compares a 64-byte window starting at the last (unaligned) address instead, which can read from the wrong block; this library deliberately does not.
- Any echo mismatch or timeout fails the operation and clears the coarse-address cache.
- Long reads (such as a ROM dump) can be stopped with `ecu.cancelRead()`, as in libcomm14cux.

### CommandQueue

The ECU can only handle one command sequence at a time. The queue serialises every public `Ecu` call, so a UI can poll live data and request a fuel map without interleaving bytes on the wire.

### Decoders and Ecu

Decoders are pure functions that turn raw memory into values (°F/°C, mph/kph, volts, percentages). They include the ROM revision detection that selects memory offsets for older and newer firmware. `Ecu` combines the queue, protocol and decoders into the public API.

### Layout

```
src/
  transport/        Transport interface, WebSerialTransport, SimulatedTransport
  protocol/         Protocol (readMem / writeMem), read chunking
  queue.ts          CommandQueue
  trace.ts          TraceEvent types for the onTrace hook
  decoders/         per-reading conversion functions (pure)
  constants.ts      memory addresses, enums, ROM-revision tables
  ecu.ts            public API
  index.ts
  ecu.*.test.ts     tests, by feature, through the public API
  test-support/     shared test helpers (not published)
```

Tests import only from `src/index.ts`, as a user of the library would, and drive the `Ecu` against `SimulatedTransport` (or `WebSerialTransport` against a fake `SerialPort`). Wire-level behaviour is checked through `SimulatedTransport.written`.

## Platform support

Web Serial works in Chromium-based desktop browsers (Chrome, Edge, Opera), Firefox 151+ on desktop, and Chrome 148+ on Android. It does **not** work in Safari or any browser on iOS/iPadOS. The page must be served over HTTPS or from `localhost`.

On Linux, the user needs permission to access the serial device (usually membership in the `dialout` group).

## Safety

Writing to ECU memory, running the fuel pump or driving the idle air control motor can affect a running engine. These functions are exposed deliberately and should be used with care. This software is provided with absolutely no warranty.

## Credits and licence

The protocol and decoding logic are derived from [libcomm14cux](https://github.com/colinbourassa/libcomm14cux) © Colin Bourassa, licensed under the GNU GPL v3.

This project is therefore licensed under the **GNU General Public License v3.0 only** (`GPL-3.0-only`). Any application that includes this library must also be distributed under GPL-3.0-compatible terms, with its source code available.

Parts of this project were written with the help of an AI assistant. The original libcomm14cux and RoverGauge projects do not accept AI-generated contributions, so nothing from this repository will be submitted to them.

## Verifying a release

Every version is published from GitHub Actions with npm trusted publishing, and npm records a signed [SLSA provenance](https://slsa.dev/) statement for it (the "Built and signed on GitHub Actions" badge on the package page). In a project that depends on the package, `npm audit signatures` checks the registry signatures and the provenance.

Each stable release also has three attestations signed with Sigstore and stored on this repository, all about the exact tarball published to npm:

- SLSA build provenance: which workflow, commit and runner built it
- a CycloneDX SBOM of its runtime dependencies
- an in-toto test result listing the unit and acceptance tests that passed against it

Download the tarball from the [release](https://github.com/KB1RMA/libcomm14cux-ts/releases) (or with `npm pack @kb1rma/libcomm14cux-ts@<version>`) and verify it with the [GitHub CLI](https://cli.github.com/):

```sh
gh attestation verify kb1rma-libcomm14cux-ts-<version>.tgz --repo KB1RMA/libcomm14cux-ts
gh attestation verify kb1rma-libcomm14cux-ts-<version>.tgz --repo KB1RMA/libcomm14cux-ts \
  --predicate-type https://in-toto.io/attestation/test-result/v0.1 --format json
```

The release also carries each attestation as a `.sigstore.json` bundle, so it can be checked offline with `--bundle`. Beta versions published under the `next` dist-tag have the npm provenance only.

## Development

Requires Node.js (see `.nvmrc`).

```sh
npm ci
npm run lint          # ESLint + Prettier
npm run type:check    # tsc --noEmit, strict
npm test              # Vitest watch mode
npm run test:coverage # enforces the coverage thresholds in vitest.config.ts
npm run build         # emits dist/ with declarations and source maps
```

The behavioural specification, derived from libcomm14cux, is in [docs/test-specification.md](docs/test-specification.md).
