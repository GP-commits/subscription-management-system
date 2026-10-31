import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { openDatabase } from '../src/db.js';
import { createMailer, queueEmail } from '../src/mail.js';

test('SMTP transport delivers queued mail and persists delivery status', async () => {
  const deliveries = [];
  const sockets = new Set();
  const smtp = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost ESMTP test\r\n');
    let buffer = '',
      inData = false,
      message = [],
      recipient = '';
    socket.on('data', (bytes) => {
      buffer += bytes.toString();
      while (buffer.includes('\r\n')) {
        const offset = buffer.indexOf('\r\n');
        const line = buffer.slice(0, offset);
        buffer = buffer.slice(offset + 2);
        if (inData) {
          if (line === '.') {
            deliveries.push({ recipient, message: message.join('\r\n') });
            message = [];
            inData = false;
            socket.write('250 accepted\r\n');
          } else message.push(line);
        } else if (/^(EHLO|HELO)/.test(line)) socket.write('250 localhost\r\n');
        else if (/^RCPT TO:/i.test(line)) {
          recipient = line;
          socket.write('250 recipient accepted\r\n');
        } else if (/^DATA/.test(line)) {
          inData = true;
          socket.write('354 send message\r\n');
        } else if (/^QUIT/.test(line)) socket.end('221 goodbye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  smtp.listen(0, '127.0.0.1');
  await once(smtp, 'listening');
  const db = openDatabase(':memory:');
  const mailer = createMailer(db, {
    production: false,
    smtp: { host: '127.0.0.1', port: smtp.address().port },
    from: 'billing@example.test',
  });
  try {
    queueEmail(
      db,
      'customer@example.test',
      'Invoice INV-000001',
      '<p>Your invoice is ready.</p>',
      new Date(),
    );
    await mailer.flush();
    assert.equal(deliveries.length, 1);
    assert.match(deliveries[0].recipient, /customer@example.test/);
    assert.match(deliveries[0].message, /Invoice INV-000001/);
    const result = db.prepare('SELECT status, attempts FROM outbox').get();
    assert.equal(result.status, 'Sent');
    assert.equal(result.attempts, 1);
    await mailer.flush();
    assert.equal(deliveries.length, 1, 'sent messages are not delivered again');
  } finally {
    mailer.close();
    db.close();
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => smtp.close(resolve));
  }
});

test('production rejects absent SMTP and development retains local outbox', async () => {
  const db = openDatabase(':memory:');
  try {
    assert.throws(() => createMailer(db, { production: true }), /SMTP/);
    const mailer = createMailer(db);
    queueEmail(db, 'customer@example.test', 'Reset password', '<p>Local only</p>', new Date());
    await mailer.flush();
    assert.equal(db.prepare('SELECT status FROM outbox').get().status, 'Pending');
    assert.equal(mailer.configured, false);
    mailer.close();
  } finally {
    db.close();
  }
});
