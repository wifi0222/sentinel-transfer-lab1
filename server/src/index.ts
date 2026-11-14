import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(config);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void app.close().finally(() => process.exit(0)); });
}

try { await app.listen({ host: config.HOST, port: config.PORT }); }
catch (error) { app.log.error(error); process.exit(1); }

