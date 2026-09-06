import { getConfig } from '../core/config.js';
import { createDashboard } from './dashboard.js';
createDashboard(await getConfig()).then(server => {
  process.stdout.write(server.url + '\n');
  const stop = () => server.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
