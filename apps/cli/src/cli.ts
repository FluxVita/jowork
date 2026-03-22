// Suppress i18next promotional banner before any imports that trigger it
process.env['I18NEXT_DISABLE_BANNER'] = '1';

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { serveCommand } from './commands/serve.js';
import { registerCommand } from './commands/register.js';
import { statusCommand } from './commands/status.js';
import { doctorCommand } from './commands/doctor.js';
import { exportCommand } from './commands/export.js';
import { connectCommand } from './commands/connect.js';
import { syncCommand } from './commands/sync.js';
import { searchCommand } from './commands/search.js';
import { goalCommand } from './commands/goal.js';
import { installServiceCommand } from './commands/install-service.js';
import { gcCommand } from './commands/gc.js';
import { deviceSyncCommand } from './commands/device-sync.js';
import { dashboardCommand } from './commands/dashboard.js';
import { logCommand } from './commands/log.js';
import { pushCommand } from './commands/push.js';
import { configCommand } from './commands/config-cmd.js';

const program = new Command();

program
  .name('jowork')
  .description('AI Agent Infrastructure — let AI agents truly understand your work')
  .version('0.1.0');

initCommand(program);
serveCommand(program);
registerCommand(program);
connectCommand(program);
syncCommand(program);
statusCommand(program);
doctorCommand(program);
exportCommand(program);
searchCommand(program);
goalCommand(program);
installServiceCommand(program);
gcCommand(program);
deviceSyncCommand(program);
dashboardCommand(program);
logCommand(program);
pushCommand(program);
configCommand(program);

// Default action: when no subcommand is given, show wizard or quick status
program.action(async () => {
  const { existsSync } = await import('node:fs');
  const { dbPath } = await import('./utils/paths.js');
  const { readConfig } = await import('./utils/config.js');

  const config = readConfig();
  if (!config.initialized || !existsSync(dbPath())) {
    if (process.stdin.isTTY) {
      const { runSetupWizard } = await import('./commands/setup.js');
      await runSetupWizard();
    } else {
      console.log('JoWork is not initialized. Run `jowork init` in an interactive terminal.');
    }
  } else {
    const { listCredentials } = await import('./connectors/credential-store.js');
    const creds = listCredentials();
    console.log(`JoWork v0.1.0 — ${creds.length} data source${creds.length !== 1 ? 's' : ''} connected`);
    console.log('');
    console.log('  jowork status       Show data overview');
    console.log('  jowork dashboard    Open companion panel');
    console.log('  jowork sync         Sync data now');
    console.log('  jowork search <q>   Search across all data');
    console.log('  jowork --help       All commands');
    console.log('');
  }
});

program.parse();
