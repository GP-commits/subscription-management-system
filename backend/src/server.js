import { createApp } from './app.js';

const app = await createApp();
const port = Number(process.env.PORT || 4000),
  host = process.env.BIND_HOST || '127.0.0.1';
const server = app.listen(port, host, () =>
  console.log(`Brightloop API listening at http://${host}:${port}/api`),
);
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    app.locals.maintenance();
    const result = app.locals.runBilling();
    if (result.created || result.activated || result.closed || result.errors.length)
      console.log('Billing run', JSON.stringify(result));
    await app.locals.flushEmails();
  } catch (err) {
    console.error('Background processing failed:', err.message);
  } finally {
    running = false;
  }
}
const timer = setInterval(tick, 60000);
timer.unref();
void tick();
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  server.close(async () => {
    while (running) await new Promise((resolve) => setTimeout(resolve, 50));
    app.locals.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
