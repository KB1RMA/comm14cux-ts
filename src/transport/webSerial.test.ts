// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

// Spec: docs/test-specification.md §4.2 (against a fake SerialPort)
import {
  NotConnectedError,
  TimeoutError,
  WebSerialTransport,
  type SerialChunkTrace,
} from '../index.js';

function fakePort(options: { noStreams?: boolean } = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const written: number[] = [];
  const port = {
    open: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    readable: options.noStreams
      ? null
      : new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        }),
    writable: options.noStreams
      ? null
      : new WritableStream<Uint8Array>({
          write(chunk) {
            written.push(...chunk);
          },
        }),
  };

  return {
    port,
    written,
    push: (...bytes: number[]) => controller.enqueue(Uint8Array.from(bytes)),
    error: (e: unknown) => controller.error(e),
    end: () => controller.close(),
    asSerialPort: port as unknown as SerialPort,
  };
}

describe('WebSerialTransport', () => {
  describe('open', () => {
    it('opens at 7812 baud, 8N1, no flow control', async () => {
      const fake = fakePort();

      await new WebSerialTransport(fake.asSerialPort).open();

      expect(fake.port.open).toHaveBeenCalledWith({
        baudRate: 7812,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      });
    });

    it('accepts 15625 baud', async () => {
      const fake = fakePort();

      await new WebSerialTransport(fake.asSerialPort, {
        baudRate: 15625,
      }).open();

      expect(fake.port.open).toHaveBeenCalledWith(
        expect.objectContaining({ baudRate: 15625 }),
      );
    });

    it('rejects when the port fails to open', async () => {
      const fake = fakePort();

      fake.port.open.mockRejectedValueOnce(new Error('busy'));

      await expect(
        new WebSerialTransport(fake.asSerialPort).open(),
      ).rejects.toThrow('busy');
    });

    it('is a no-op when already open', async () => {
      const fake = fakePort();
      const transport = new WebSerialTransport(fake.asSerialPort);

      await transport.open();
      await transport.open();

      expect(fake.port.open).toHaveBeenCalledTimes(1);
    });

    it('treats a port without streams as not open', async () => {
      const transport = new WebSerialTransport(
        fakePort({ noStreams: true }).asSerialPort,
      );

      await transport.open();

      await expect(transport.write(Uint8Array.of(1))).rejects.toThrow(
        NotConnectedError,
      );
    });
  });

  describe('write', () => {
    it('writes the bytes to the port', async () => {
      const fake = fakePort();
      const transport = new WebSerialTransport(fake.asSerialPort);

      await transport.open();
      await transport.write(Uint8Array.of(1, 2, 3));

      expect(fake.written).toEqual([1, 2, 3]);
    });

    it('rejects when the port is not open', async () => {
      const transport = new WebSerialTransport(fakePort().asSerialPort);

      await expect(transport.write(Uint8Array.of(1))).rejects.toThrow(
        NotConnectedError,
      );
    });
  });

  describe('read', () => {
    async function opened() {
      const fake = fakePort();
      const transport = new WebSerialTransport(fake.asSerialPort);

      await transport.open();

      return { fake, transport };
    }

    it('resolves with exactly the requested number of bytes', async () => {
      const { fake, transport } = await opened();

      fake.push(1, 2, 3);

      expect([...(await transport.read(3, 50))]).toEqual([1, 2, 3]);
    });

    it('assembles a result from several chunks', async () => {
      const { fake, transport } = await opened();

      fake.push(1);
      fake.push(2, 3);
      fake.push(4);

      expect([...(await transport.read(4, 50))]).toEqual([1, 2, 3, 4]);
    });

    it('keeps surplus bytes for the next read', async () => {
      const { fake, transport } = await opened();

      fake.push(1, 2, 3, 4);

      expect([...(await transport.read(1, 50))]).toEqual([1]);
      expect([...(await transport.read(3, 50))]).toEqual([2, 3, 4]);
    });

    it('rejects with TimeoutError after silence', async () => {
      const { transport } = await opened();

      await expect(transport.read(1, 5)).rejects.toThrow(TimeoutError);
    });

    it('does not lose data that arrives after a timeout', async () => {
      const { fake, transport } = await opened();

      await expect(transport.read(1, 5)).rejects.toThrow(TimeoutError);
      fake.push(9);

      expect([...(await transport.read(1, 50))]).toEqual([9]);
    });

    it('rejects when the port is not open', async () => {
      const transport = new WebSerialTransport(fakePort().asSerialPort);

      await expect(transport.read(1, 5)).rejects.toThrow(NotConnectedError);
    });

    it('rejects when the stream errors', async () => {
      const { fake, transport } = await opened();

      fake.error(new Error('unplugged'));

      await expect(transport.read(1, 50)).rejects.toThrow('unplugged');
    });

    it('rejects when the stream ends', async () => {
      const { fake, transport } = await opened();

      fake.end();

      await expect(transport.read(1, 50)).rejects.toThrow(NotConnectedError);
    });
  });

  describe('trace hook', () => {
    async function tracedTransport() {
      const fake = fakePort();
      const events: SerialChunkTrace[] = [];
      const transport = new WebSerialTransport(fake.asSerialPort, {
        onTrace: (e) => events.push(e),
      });

      await transport.open();

      return { fake, transport, events };
    }

    it('reports the size of each chunk the port delivers', async () => {
      const { fake, transport, events } = await tracedTransport();

      fake.push(1);
      fake.push(2, 3);
      fake.push(4, 5, 6);
      await transport.read(6, 50);

      expect(events.map((e) => [e.type, e.size])).toEqual([
        ['serial-chunk', 1],
        ['serial-chunk', 2],
        ['serial-chunk', 3],
      ]);
    });

    it('reports a chunk once, however many reads it feeds', async () => {
      const { fake, transport, events } = await tracedTransport();

      fake.push(1, 2, 3, 4);
      await transport.read(1, 50);
      await transport.read(3, 50);

      expect(events).toHaveLength(1);
    });

    it('reports timing: the wait for each chunk and the gap between chunks', async () => {
      const { fake, transport, events } = await tracedTransport();
      const before = Date.now();

      const read = transport.read(2, 200);

      await new Promise((resolve) => setTimeout(resolve, 20));
      fake.push(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      fake.push(2);
      await read;

      expect(events[0]?.timestamp).toBeGreaterThanOrEqual(before);
      expect(events[0]?.sinceLastChunkMs).toBeUndefined();
      expect(events[0]?.waitedMs).toBeGreaterThanOrEqual(15);
      expect(events[1]?.sinceLastChunkMs).toBeGreaterThanOrEqual(15);
      expect(events[1]?.waitedMs).toBeGreaterThanOrEqual(15);
    });

    it('is unaffected by a hook that throws', async () => {
      const fake = fakePort();
      const transport = new WebSerialTransport(fake.asSerialPort, {
        onTrace: () => {
          throw new Error('logger broke');
        },
      });

      await transport.open();
      fake.push(7);

      expect([...(await transport.read(1, 50))]).toEqual([7]);
    });

    it('gives a timeout the wait and how many bytes had arrived', async () => {
      const { fake, transport } = await tracedTransport();

      fake.push(1, 2);

      await expect(transport.read(5, 5)).rejects.toMatchObject({
        name: 'TimeoutError',
        timeoutMs: 5,
        requestedBytes: 5,
        receivedBytes: 2,
      });
    });
  });

  describe('close', () => {
    it('releases the locks and closes the port', async () => {
      const fake = fakePort();
      const transport = new WebSerialTransport(fake.asSerialPort);

      await transport.open();
      await transport.close();

      expect(fake.port.close).toHaveBeenCalledTimes(1);
      expect(fake.port.readable?.locked).toBe(false);
      expect(fake.port.writable?.locked).toBe(false);
    });

    it('is a no-op when already closed', async () => {
      const fake = fakePort();
      const transport = new WebSerialTransport(fake.asSerialPort);

      await transport.close();

      expect(fake.port.close).not.toHaveBeenCalled();
    });

    it('still closes the port after the stream errored', async () => {
      const fake = fakePort();
      const transport = new WebSerialTransport(fake.asSerialPort);

      await transport.open();
      fake.error(new Error('unplugged'));
      await expect(transport.read(1, 50)).rejects.toThrow('unplugged');
      await transport.close();

      expect(fake.port.close).toHaveBeenCalledTimes(1);
    });

    it('discards buffered surplus bytes', async () => {
      const fake = fakePort();
      const transport = new WebSerialTransport(fake.asSerialPort);

      await transport.open();
      fake.push(1, 2);
      await transport.read(1, 50);
      await transport.close();

      await expect(transport.read(1, 5)).rejects.toThrow(NotConnectedError);
    });
  });
});
