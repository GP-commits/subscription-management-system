import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('proxy configuration rejects ambiguous trust settings', async () => {
  await assert.rejects(createApp({ dbPath: ':memory:', trustProxy: 'true' }), /TRUST_PROXY/);
  await assert.rejects(createApp({ dbPath: ':memory:', trustProxy: '2' }), /TRUST_PROXY/);
});

for (const trustProxy of [0, 1]) {
  test(`authentication limiter ${trustProxy ? 'uses one trusted proxy hop' : 'ignores spoofed forwarding without trust'}`, async () => {
    const app = await createApp({ dbPath: ':memory:', trustProxy });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/auth/forgot-password`;
    async function attempt(ip) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify({ email: 'invalid' }),
      });
      await response.json();
      return response.status;
    }
    try {
      for (let n = 0; n < 30; n++) assert.equal(await attempt('203.0.113.10'), 400);
      assert.equal(await attempt('203.0.113.10'), 429);
      assert.equal(await attempt('203.0.113.11'), trustProxy ? 400 : 429);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      app.locals.close();
    }
  });
}
