import type { Command } from 'commander';
import { DbManager } from '../db/manager.js';
import { GoalManager } from '../goals/manager.js';
import { dbPath } from '../utils/paths.js';

export function goalCommand(program: Command): void {
  const goal = program.command('goal').description('Manage goals (Goal-Signal-Measure system)');

  goal.command('add')
    .description('Add a new goal')
    .argument('<title>', 'Goal title')
    .option('--description <desc>', 'Goal description')
    .option('--parent <id>', 'Parent goal ID')
    .action(async (title: string, opts: { description?: string; parent?: string }) => {
      const db = new DbManager(dbPath());
      db.ensureTables();
      const gm = new GoalManager(db.getSqlite());
      const g = gm.createGoal({ title, description: opts.description, parentId: opts.parent });
      console.log(`✓ Goal created: "${g.title}" (${g.id})`);
      db.close();
    });

  goal.command('list')
    .description('List goals')
    .option('--status <status>', 'Filter by status: active, paused, completed')
    .action(async (opts: { status?: string }) => {
      const db = new DbManager(dbPath());
      db.ensureTables();
      const gm = new GoalManager(db.getSqlite());
      const goals = gm.listGoals({ status: opts.status });
      if (goals.length === 0) {
        console.log('No goals found.');
        db.close();
        return;
      }
      for (const g of goals) {
        const signalCount = g.signals?.length ?? 0;
        const metCount = g.signals?.reduce((acc, s) => acc + (s.measures?.filter(m => m.met).length ?? 0), 0) ?? 0;
        const totalMeasures = g.signals?.reduce((acc, s) => acc + (s.measures?.length ?? 0), 0) ?? 0;
        const progress = totalMeasures > 0 ? `${metCount}/${totalMeasures} measures met` : 'no measures';
        console.log(`[${g.status}] ${g.title} (${g.id})`);
        console.log(`  ${signalCount} signals, ${progress}`);
        if (g.description) console.log(`  ${g.description}`);
        console.log('');
      }
      db.close();
    });

  goal.command('status')
    .description('Show detailed goal status')
    .argument('[id]', 'Goal ID (shows all if omitted)')
    .action(async (id: string | undefined) => {
      const db = new DbManager(dbPath());
      db.ensureTables();
      const gm = new GoalManager(db.getSqlite());

      const goals = id ? [gm.getGoal(id)].filter(Boolean) as Goal[] : gm.listGoals({ status: 'active' });

      for (const g of goals) {
        console.log(`Goal: ${g.title} [${g.status}]`);
        console.log(`  ID: ${g.id}`);
        console.log(`  Autonomy: ${g.autonomyLevel}`);
        if (g.signals && g.signals.length > 0) {
          for (const s of g.signals) {
            const arrow = s.direction === 'maximize' ? '↑' : s.direction === 'minimize' ? '↓' : '→';
            console.log(`  Signal: ${s.title} ${arrow} (${s.source}/${s.metric})`);
            console.log(`    Current: ${s.currentValue ?? 'no data'}, Poll: ${s.pollInterval}s`);
            if (s.measures) {
              for (const m of s.measures) {
                const icon = m.met ? '✓' : '✗';
                console.log(`    ${icon} ${m.comparison} ${m.threshold}${m.upperBound ? `-${m.upperBound}` : ''} (current: ${m.current ?? 'N/A'})`);
              }
            }
          }
        } else {
          console.log('  No signals configured');
        }
        console.log('');
      }
      db.close();
    });

  // Signal sub-commands
  const signal = program.command('signal').description('Manage signals for goals');

  signal.command('add')
    .description('Add a signal to a goal')
    .argument('<goal_id>', 'Goal ID')
    .requiredOption('--source <source>', 'Data source (e.g. posthog, feishu)')
    .requiredOption('--metric <metric>', 'Metric name (e.g. dau, crash_rate)')
    .requiredOption('--direction <dir>', 'Direction: maximize, minimize, maintain')
    .option('--title <title>', 'Signal title (auto-generated if omitted)')
    .option('--interval <seconds>', 'Poll interval in seconds', '3600')
    .option('--config <json>', 'JSON config (e.g. \'{"repo":"owner/name"}\')')
    .action(async (goalId: string, opts: { source: string; metric: string; direction: string; title?: string; interval: string; config?: string }) => {
      const db = new DbManager(dbPath());
      db.ensureTables();
      const gm = new GoalManager(db.getSqlite());
      const goal = gm.getGoal(goalId);
      if (!goal) { console.error(`Goal not found: ${goalId}`); process.exit(1); }
      const title = opts.title ?? `${opts.metric} (${opts.source})`;
      let config: Record<string, unknown> | undefined;
      if (opts.config) {
        try { config = JSON.parse(opts.config) as Record<string, unknown>; }
        catch { console.error('Error: --config must be valid JSON'); process.exit(1); }
      }
      const sig = gm.createSignal({
        goalId, title, source: opts.source, metric: opts.metric,
        direction: opts.direction, pollInterval: parseInt(opts.interval),
        config,
      });
      console.log(`✓ Signal added: "${sig.title}" → ${goal.title} (${sig.id})`);
      db.close();
    });

  // Measure sub-commands
  const measure = program.command('measure').description('Manage measures for signals');

  measure.command('add')
    .description('Add a measure to a signal')
    .argument('<signal_id>', 'Signal ID')
    .requiredOption('--threshold <n>', 'Threshold value')
    .requiredOption('--type <type>', 'Comparison: gte, lte, gt, lt, eq, between')
    .option('--upper <n>', 'Upper bound (for between)')
    .action(async (signalId: string, opts: { threshold: string; type: string; upper?: string }) => {
      const db = new DbManager(dbPath());
      db.ensureTables();
      const gm = new GoalManager(db.getSqlite());
      const sig = gm.getSignal(signalId);
      if (!sig) { console.error(`Signal not found: ${signalId}`); process.exit(1); }
      const m = gm.createMeasure({
        signalId, threshold: parseFloat(opts.threshold),
        comparison: opts.type, upperBound: opts.upper ? parseFloat(opts.upper) : undefined,
      });
      console.log(`✓ Measure added: ${opts.type} ${opts.threshold} (${m.id})`);
      db.close();
    });
}

// Re-export Goal type for use in status command
import type { Goal } from '../goals/manager.js';
