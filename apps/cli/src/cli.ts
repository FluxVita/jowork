import { Command } from 'commander';

const program = new Command();

program
  .name('jowork')
  .description('AI Agent Infrastructure — connect data sources, give agents awareness and goals')
  .version('0.1.0');

// Commands will be added in Step 1.4
program.command('init').description('Initialize JoWork (create local DB and config)').action(async () => {
  console.log('jowork init — not yet implemented');
});

program.command('serve').description('Start MCP server').action(async () => {
  console.log('jowork serve — not yet implemented');
});

program.command('status').description('Show system status').action(async () => {
  console.log('jowork status — not yet implemented');
});

program.parse();
