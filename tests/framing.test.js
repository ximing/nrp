const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const {
  Frame,
  FrameFlag,
  FrameReassembler,
  FrameTooLargeError,
  FrameType,
  HandleStream,
  MAX_FRAME_PAYLOAD_LENGTH,
} = require('@nrpjs/shared');
const { NrpServer } = require('@nrpjs/server');

const FRAME_HEADER_LENGTH = 9;

function encodedFrame(payload, streamId) {
  return new Frame(
    FrameType.DATA,
    FrameFlag.END_STREAM,
    streamId,
    Buffer.from(payload),
  ).encode();
}

function headerWithDeclaredLength(length) {
  const header = new Frame(FrameType.DATA, FrameFlag.END_DATA, 1, Buffer.alloc(0)).encode();
  header.writeUInt32BE((length & 0x00ffffff) << 8, 0);
  header.writeUInt8(FrameType.DATA, 3);
  header.writeUInt8(FrameFlag.END_DATA, 4);
  header.writeUInt32BE(1, 5);
  return header;
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: '127.0.0.1' }, () => resolve(socket));
    socket.once('error', reject);
  });
}

function waitFor(fn, ms = 1500) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const value = fn();
        if (value) {
          resolve(value);
          return;
        }
      } catch (err) {
        reject(err);
        return;
      }
      if (Date.now() - start > ms) {
        reject(new Error('timed out waiting for condition'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

test('split chunks reassemble to the same frame as one buffer', () => {
  const payload = Buffer.from('split-payload-frame');
  const encoded = encodedFrame(payload, 11);
  const whole = new FrameReassembler().push(encoded);
  const split = new FrameReassembler();
  const frames = [];
  for (let offset = 0; offset < encoded.length; offset += 1) {
    frames.push(...split.push(encoded.subarray(offset, offset + 1)));
  }
  assert.equal(whole.length, 1);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, FrameType.DATA);
  assert.equal(frames[0].flag, FrameFlag.END_STREAM);
  assert.equal(frames[0].streamId, 11);
  assert.equal(frames[0].payload.equals(payload), true);
  assert.equal(frames[0].payload.equals(whole[0].payload), true);
  assert.equal(split.bufferedBytes, 0);
});

test('coalesced chunks reassemble to the same frames as separate buffers', () => {
  const first = Buffer.from('alpha');
  const second = Buffer.from('beta-coalesced');
  const encoded = Buffer.concat([encodedFrame(first, 3), encodedFrame(second, 5)]);
  const frames = new FrameReassembler().push(encoded);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].streamId, 3);
  assert.equal(frames[0].payload.equals(first), true);
  assert.equal(frames[1].streamId, 5);
  assert.equal(frames[1].payload.equals(second), true);
});

test('reassembly state is per socket', () => {
  const stream = new HandleStream();
  const socketA = new net.Socket();
  const socketB = new net.Socket();
  const seen = [];
  stream.register((frame, socket) => {
    seen.push({ payload: frame.payload.toString('utf8'), socket });
  });
  const frameA = encodedFrame('from-a', 2);
  const frameB = encodedFrame('from-b', 4);
  stream.parse(frameA.subarray(0, 4), socketA);
  stream.parse(frameB.subarray(0, 7), socketB);
  assert.equal(seen.length, 0);
  stream.parse(frameA.subarray(4), socketA);
  stream.parse(frameB.subarray(7), socketB);
  assert.deepEqual(
    seen.map((entry) => entry.payload),
    ['from-a', 'from-b'],
  );
  assert.equal(seen[0].socket, socketA);
  assert.equal(seen[1].socket, socketB);
  assert.equal(stream.bufferedBytes(socketA), 0);
  assert.equal(stream.bufferedBytes(socketB), 0);
});

test('a declared payload above 1 MiB is rejected at the header without retaining it', () => {
  const declared = MAX_FRAME_PAYLOAD_LENGTH + 1;
  const header = headerWithDeclaredLength(declared);
  const junk = Buffer.alloc(256 * 1024, 0xef);
  const chunk = Buffer.concat([header, junk]);
  const reassembler = new FrameReassembler();
  const stream = new HandleStream();
  const socket = new net.Socket();
  let handled = 0;
  stream.register(() => {
    handled += 1;
  });

  assert.throws(
    () => reassembler.push(chunk),
    (err) => {
      assert.ok(err instanceof FrameTooLargeError);
      assert.equal(err.declaredLength, declared);
      return true;
    },
  );
  assert.equal(reassembler.bufferedBytes, 0);
  assert.ok(reassembler.bufferedBytes <= MAX_FRAME_PAYLOAD_LENGTH + FRAME_HEADER_LENGTH);

  const partial = new FrameReassembler();
  partial.push(header.subarray(0, 4));
  assert.equal(partial.bufferedBytes, 4);
  assert.throws(() => partial.push(Buffer.concat([header.subarray(4), junk])), FrameTooLargeError);
  assert.equal(partial.bufferedBytes, 0);

  assert.throws(() => stream.parse(chunk, socket), FrameTooLargeError);
  assert.equal(handled, 0);
  assert.equal(stream.bufferedBytes(socket), 0);

  const later = new FrameReassembler();
  const payload = Buffer.from('after-reject');
  const frames = later.push(encodedFrame(payload, 9));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.equals(payload), true);
});

test('a 1 MiB payload is accepted and the buffer stays within 1 MiB plus the header', () => {
  const payload = Buffer.alloc(MAX_FRAME_PAYLOAD_LENGTH, 0x61);
  const encoded = new Frame(FrameType.DATA, FrameFlag.END_DATA, 8, payload).encode();
  const reassembler = new FrameReassembler();
  const frames = [];
  const chunkSize = 64 * 1024;
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    frames.push(...reassembler.push(encoded.subarray(offset, offset + chunkSize)));
    assert.ok(reassembler.bufferedBytes <= MAX_FRAME_PAYLOAD_LENGTH + FRAME_HEADER_LENGTH);
  }
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.length, MAX_FRAME_PAYLOAD_LENGTH);
  assert.equal(frames[0].payload[0], 0x61);
  assert.equal(frames[0].payload[MAX_FRAME_PAYLOAD_LENGTH - 1], 0x61);
  assert.equal(reassembler.bufferedBytes, 0);
});

test('an oversized frame does not crash the server and a new buffer still decodes', async (t) => {
  const server = new NrpServer({
    port: 0,
    vhost_http_port: 0,
    secret: 'frame-secret',
    idle_timeout: 5000,
  });
  const address = await server.start();
  t.after(async () => {
    await server.close();
  });

  const bad = connect(address.port);
  const badSocket = await bad;
  badSocket.on('error', () => {});
  const declared = MAX_FRAME_PAYLOAD_LENGTH + 1;
  badSocket.write(Buffer.concat([headerWithDeclaredLength(declared), Buffer.alloc(1024, 1)]));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('oversized connection was not rejected')), 1000);
    badSocket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  const payload = Buffer.from('still-decodes');
  const frames = new FrameReassembler().push(encodedFrame(payload, 15));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.equals(payload), true);

  const good = await connect(address.port);
  t.after(() => good.destroy());
  good.on('error', () => {});
  const settings = encodedSettings({
    secret: 'frame-secret',
    bind_port: address.port,
    bind_host: '127.0.0.1',
    subdomain_host: 'frame.test',
    http: { one: { subdomain: 'alpha', local_port: 9 } },
  });
  const other = encodedSettings({
    secret: 'frame-secret',
    bind_port: address.port,
    bind_host: '127.0.0.1',
    subdomain_host: 'frame.test',
    http: { one: { subdomain: 'beta', local_port: 9 } },
  });
  const beta = await connect(address.port);
  t.after(() => beta.destroy());
  beta.on('error', () => {});
  good.write(settings.subarray(0, 6));
  beta.write(other.subarray(0, 8));
  good.write(settings.subarray(6));
  beta.write(other.subarray(8));

  const alphaOwner = await waitFor(
    () => server.vhostManager.getNFRClient('alpha.frame.test'),
  );
  const betaOwner = await waitFor(
    () => server.vhostManager.getNFRClient('beta.frame.test'),
  );
  assert.equal(alphaOwner.remotePort, good.localPort);
  assert.equal(betaOwner.remotePort, beta.localPort);
  assert.notEqual(alphaOwner, betaOwner);
});

function encodedSettings(settings) {
  return new Frame(
    FrameType.SETTINGS,
    FrameFlag.PADDED,
    1,
    Buffer.from(JSON.stringify(settings), 'utf8'),
  ).encode();
}
