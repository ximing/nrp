const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeClientSettings, normalizeClientSettings } = require('@nrpjs/shared');
const {
  UPSTREAM_BODY,
  delay,
  httpRequest,
  listen,
  openControl,
  settingsFrame,
  startNrp,
  startUpstream,
  waitFor,
} = require('./helpers');

const HOST = 'app.example.test';

function validSettings(extra = {}) {
  return {
    secret: 'test-secret',
    bind_port: 7000,
    bind_host: '127.0.0.1',
    subdomain_host: 'example.test',
    http: {
      app: { subdomain: 'app', local_port: 3000 },
    },
    ...extra,
  };
}

test('omitted timeout, retry, and backoff receive defaults and do not throw', () => {
  const input = validSettings();
  delete input.timeout;
  delete input.retry;
  delete input.backoff;
  let result;
  assert.doesNotThrow(() => {
    result = normalizeClientSettings(input);
  });
  assert.equal(result.ok, true);
  assert.equal(result.settings.timeout, 10000);
  assert.equal(result.settings.retry, 3);
  assert.deepEqual(result.settings.backoff, { min: 100, max: 1000, factor: 2 });
});

test('missing secret, wrong secret, and invalid settings are rejected', () => {
  const serverSecret = 'test-secret';
  const missingSecret = authorizeClientSettings(validSettings({ secret: undefined }), serverSecret);
  const wrongSecret = authorizeClientSettings(validSettings({ secret: 'other' }), serverSecret);
  const missingPort = authorizeClientSettings(validSettings({ bind_port: undefined }), serverSecret);
  const missingHost = authorizeClientSettings(validSettings({ bind_host: undefined }), serverSecret);
  const missingHttp = authorizeClientSettings(validSettings({ http: undefined }), serverSecret);
  const emptyHttp = authorizeClientSettings(validSettings({ http: {} }), serverSecret);
  const missingSubdomain = authorizeClientSettings(
    validSettings({ http: { app: { local_port: 3000 } } }),
    serverSecret,
  );
  const badBindPort = authorizeClientSettings(validSettings({ bind_port: 'abc' }), serverSecret);
  const badLocalPort = authorizeClientSettings(
    validSettings({ http: { app: { subdomain: 'app', local_port: 'nope' } } }),
    serverSecret,
  );
  for (const result of [
    missingSecret,
    wrongSecret,
    missingPort,
    missingHost,
    missingHttp,
    emptyHttp,
    missingSubdomain,
    badBindPort,
    badLocalPort,
  ]) {
    assert.equal(result.ok, false);
  }
  const accepted = authorizeClientSettings(validSettings(), serverSecret);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.settings.timeout, 10000);
});

test('rejected or unregistered hosts create no route and fail closed', async (t) => {
  const { upstream, hits } = startUpstream();
  const upstreamPort = await listen(upstream);
  t.after(() => new Promise((resolve) => upstream.close(() => resolve())));

  const { server, address } = await startNrp();
  t.after(() => server.close());

  const base = {
    bind_port: address.port,
    bind_host: '127.0.0.1',
    subdomain_host: 'example.test',
    http: { app: { subdomain: 'app', local_port: upstreamPort } },
  };
  const rejected = [
    base,
    { ...base, secret: 'wrong-secret' },
    { ...base, secret: 'test-secret', bind_port: 'abc' },
    { ...base, secret: 'test-secret', bind_port: 1.5 },
    { secret: 'test-secret', bind_host: '127.0.0.1', subdomain_host: 'example.test', http: base.http },
    { ...base, secret: 'test-secret', bind_host: '' },
    { secret: 'test-secret', bind_port: address.port, bind_host: '127.0.0.1', subdomain_host: 'example.test' },
    { ...base, secret: 'test-secret', http: {} },
    {
      ...base,
      secret: 'test-secret',
      http: { app: { local_port: upstreamPort } },
    },
    {
      ...base,
      secret: 'test-secret',
      http: { app: { subdomain: 'app', local_port: 'nope' } },
    },
  ];

  const unregistered = await httpRequest(address.vhostHttpPort, HOST);
  assert.ok(unregistered.status >= 400);
  assert.equal(unregistered.body.includes(UPSTREAM_BODY), false);

  for (const settings of rejected) {
    const socket = await openControl(address.port);
    t.after(() => socket.destroy());
    socket.write(settingsFrame(settings));
    await delay(40);
    assert.equal(server.vhostManager.getNFRClient(HOST), undefined);
    const response = await httpRequest(address.vhostHttpPort, HOST);
    assert.ok(response.status >= 400);
    assert.equal(response.body.includes(UPSTREAM_BODY), false);
  }

  const good = await openControl(address.port);
  t.after(() => good.destroy());
  const optionalOmitted = {
    ...base,
    secret: 'test-secret',
  };
  good.write(settingsFrame(optionalOmitted));
  const owner = await waitFor(() => server.vhostManager.getNFRClient(HOST));
  assert.equal(owner.remotePort, good.localPort);
  assert.equal(hits.length, 0);
});

test('a second live connection does not replace a subdomain route', async (t) => {
  const { server, address } = await startNrp();
  t.after(() => server.close());
  const settings = {
    secret: 'test-secret',
    bind_port: address.port,
    bind_host: '127.0.0.1',
    subdomain_host: 'example.test',
    timeout: 50,
    retry: 1,
    http: { app: { subdomain: 'app', local_port: 9 } },
  };
  const first = await openControl(address.port);
  const second = await openControl(address.port);
  t.after(() => first.destroy());
  t.after(() => second.destroy());
  first.write(settingsFrame(settings));
  const owner = await waitFor(() => server.vhostManager.getNFRClient(HOST));
  assert.equal(owner.remotePort, first.localPort);
  second.write(settingsFrame(settings));
  await delay(80);
  const still = server.vhostManager.getNFRClient(HOST);
  assert.equal(still.remotePort, first.localPort);
  assert.notEqual(still.remotePort, second.localPort);
});
