import { getConfig } from '../plugins/progress-target/core/config.js';
import { ensureDashboard } from '../plugins/progress-target/server/dashboard.js';
try { console.log(JSON.stringify(await ensureDashboard(await getConfig()))); }
catch(error){console.error(error.message);process.exitCode=1;}
