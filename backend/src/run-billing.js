import { createApp } from './app.js';
const app = await createApp();
try {
  const result = app.locals.runBilling();
  await app.locals.flushEmails();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
} finally {
  app.locals.close();
}
