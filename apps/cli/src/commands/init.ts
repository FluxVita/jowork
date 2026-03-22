import type { Command } from 'commander';
import { existsSync, chmodSync } from 'node:fs';
import { DbManager } from '../db/manager.js';
import { readConfig, writeConfig } from '../utils/config.js';
import { dbPath, joworkDir } from '../utils/paths.js';

export function initCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize JoWork — create local database and config')
    .action(async () => {
      const config = readConfig();
      if (config.initialized && existsSync(dbPath())) {
        console.log('✓ JoWork already initialized at', joworkDir());
        return;
      }

      console.log('Initializing JoWork...');

      // Harden directory permissions (owner-only access)
      try {
        chmodSync(joworkDir(), 0o700);
      } catch {
        /* Windows or read-only FS — non-critical */
      }

      // Create and migrate database
      const db = new DbManager(dbPath());
      db.ensureTables();
      db.close();

      // Update config
      writeConfig({ ...config, initialized: true });

      console.log('✓ Database created at', dbPath());
      console.log('✓ Config saved at', joworkDir());
      console.log('');

      // Offer guided setup (only in interactive terminal)
      if (process.stdin.isTTY) {
        const { default: inquirer } = await import('inquirer');
        const { continueSetup } = await inquirer.prompt([{
          type: 'confirm',
          name: 'continueSetup',
          message: 'Continue with guided setup? (connect agent + data sources)',
          default: true,
        }]);

        if (continueSetup) {
          const { runSetupWizard } = await import('./setup.js');
          await runSetupWizard();
        } else {
          console.log('');
          console.log('Next steps:');
          console.log('  jowork register claude-code   # Connect to Claude Code');
          console.log('  jowork connect feishu          # Connect Feishu data source');
        }
      } else {
        console.log('Next steps:');
        console.log('  jowork                         # Run interactive setup wizard');
        console.log('  jowork register claude-code    # Connect to Claude Code');
        console.log('  jowork connect feishu           # Connect Feishu data source');
      }
    });
}
