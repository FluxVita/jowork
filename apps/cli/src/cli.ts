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

program.parse();
