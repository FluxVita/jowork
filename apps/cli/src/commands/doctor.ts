import type { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { dbPath, joworkDir, configPath } from '../utils/paths.js';
import { join } from 'node:path';

export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run diagnostic checks')
    .action(async () => {
      console.log('JoWork Doctor');
      console.log('\u2500'.repeat(40));
      let ok = true;

      // Node.js version
      const nodeVersion = process.versions.node;
      const major = parseInt(nodeVersion.split('.')[0]);
      if (major >= 20) {
        console.log(`  \u2713 Node.js ${nodeVersion}`);
      } else {
        console.log(`  \u2717 Node.js ${nodeVersion} (requires >= 20)`);
        ok = false;
      }

      // Data directory
      if (existsSync(joworkDir())) {
        console.log(`  \u2713 Data directory exists: ${joworkDir()}`);
      } else {
        console.log(`  \u2717 Data directory missing: ${joworkDir()}`);
        ok = false;
      }

      // Database
      if (existsSync(dbPath())) {
        try {
          const Database = (await import('better-sqlite3')).default;
          const db = new Database(dbPath());
          db.pragma('integrity_check');
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
          console.log(`  \u2713 Database OK (${tables.length} tables)`);
          db.close();
        } catch (err) {
          console.log(`  \u2717 Database error: ${err}`);
          ok = false;
        }
      } else {
        console.log(`  \u2717 Database not found. Run \`jowork init\``);
        ok = false;
      }

      // Config
      if (existsSync(configPath())) {
        console.log(`  \u2713 Config file exists`);
      } else {
        console.log(`  \u2717 Config file missing`);
        ok = false;
      }

      // Claude Code registration
      const claudeConfigPath = join(process.env['HOME'] ?? '', '.claude.json');
      if (existsSync(claudeConfigPath)) {
        try {
          const config = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
          if (config.mcpServers?.jowork) {
            console.log(`  \u2713 Registered with Claude Code`);
          } else {
            console.log(`  \u25CB Not registered with Claude Code (run \`jowork register claude-code\`)`);
          }
        } catch {
          console.log(`  \u25CB Cannot read Claude Code config`);
        }
      } else {
        console.log(`  \u25CB Claude Code config not found`);
      }

      console.log('');
      console.log(ok ? '\u2713 All checks passed' : '\u2717 Some checks failed');
    });
}
