#!/usr/bin/env node
/**
 * FluxVita Feedback MCP Server
 *
 * 提供工具让 Claude Code 直接读取 App 内的精准标注反馈。
 * 无额外依赖，纯 Node.js stdio JSON-RPC。
 *
 * 数据来源：data/feedback/annotations.json（由 /api/feedback/batch 写入）
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// gateway 用 tsx 运行时 __dirname = packages/core/src/gateway/routes，
// 往上3级存到 packages/core/data/；用 node dist/ 时同理。
// MCP 优先读 packages/core/data/，回退到项目根 data/。
function findFeedbackDir() {
  const candidates = [
    resolve(PROJECT_ROOT, 'packages/core/data/feedback'),
    resolve(PROJECT_ROOT, 'data/feedback'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0]; // 默认
}

const FEEDBACK_DIR     = findFeedbackDir();
const ANNOTATIONS_FILE = resolve(FEEDBACK_DIR, 'annotations.json');
const AGENT_FILE       = resolve(FEEDBACK_DIR, 'agent_feedback.md');

// ─── 工具定义 ───────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'read_annotations',
    description: [
      'Read pending feedback annotations from the FluxVita/Jowork app.',
      'Each annotation contains: appId (fluxvita|jowork), pageFile (HTML file path),',
      'CSS selector, element info (tag/text/attributes/nearestId), and feedback comment.',
      'Use pageFile to locate the source file, CSS selector to find the exact element.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'Filter by app: "fluxvita", "jowork", or omit for all',
        },
        include_done: {
          type: 'boolean',
          description: 'Include already-processed annotations (default: false)',
        },
      },
    },
  },
  {
    name: 'mark_done',
    description: 'Mark one or all annotations as processed after you have fixed the issues.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: 'Annotation id to mark done. Omit to mark ALL as done.',
        },
      },
    },
  },
  {
    name: 'clear_annotations',
    description: 'Permanently delete all annotations (use after all issues are resolved).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_agent_feedback',
    description: 'Read the accumulated agent_feedback.md which contains task descriptions for each feedback batch.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_feedback_files',
    description: 'List all saved feedback files (timestamped markdown reports).',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── 数据操作 ────────────────────────────────────────────────────────────────

function loadAnnotations() {
  if (!existsSync(ANNOTATIONS_FILE)) return [];
  try { return JSON.parse(readFileSync(ANNOTATIONS_FILE, 'utf-8')); } catch { return []; }
}

function saveAnnotations(data) {
  writeFileSync(ANNOTATIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── 工具执行 ────────────────────────────────────────────────────────────────

function executeTool(name, args) {
  if (name === 'read_annotations') {
    const all = loadAnnotations();
    let items = args?.include_done ? all : all.filter(a => !a._done);
    if (args?.app_id) items = items.filter(a => a.appId === args.app_id);

    if (items.length === 0) {
      const hint = args?.app_id ? ` for app "${args.app_id}"` : '';
      return `# No pending annotations${hint}\n\nNo feedback exported from the app yet.\n` +
             'In the app: double-click pencil → annotate → click "导出给 AI".';
    }

    // 按 appId 分组
    const groups = {};
    items.forEach(a => { const k = a.appId || 'unknown'; (groups[k] ??= []).push(a); });

    let out = `# App Feedback Annotations (${items.length} pending)\n\n`;
    out += `> Source: \`${ANNOTATIONS_FILE}\`\n\n`;

    for (const [appId, group] of Object.entries(groups)) {
      out += `## App: ${appId} (${group.length} annotations)\n\n`;
      group.forEach((ann, i) => {
        const ei = ann.elementInfo || {};
        out += `### #${ann.id ?? (i + 1)} · ${ann.pageFile || ann.page || '?'}\n\n`;
        if (ei.selector)  out += `**CSS Selector**: \`${ei.selector}\`\n`;
        if (ei.nearestId) out += `**Nearest ID**: \`#${ei.nearestId}\`\n`;
        if (ei.tag)       out += `**Element**: \`<${ei.tag}>\`\n`;
        if (ei.text)      out += `**Element text**: "${ei.text}"\n`;
        const attrs = ei.attrs ? Object.entries(ei.attrs) : [];
        if (attrs.length) out += `**Attrs**: ${attrs.map(([k, v]) => `\`${k}="${v}"\``).join(' ')}\n`;
        out += `\n**Feedback**:\n${ann.comment}\n\n_${ann.time || ''}_\n\n---\n\n`;
      });
    }

    return out;
  }

  if (name === 'mark_done') {
    const all = loadAnnotations();
    if (args?.id != null) {
      const idx = all.findIndex(a => a.id === args.id);
      if (idx === -1) return `Annotation #${args.id} not found.`;
      all[idx]._done = true;
      saveAnnotations(all);
      return `Annotation #${args.id} marked as done.`;
    } else {
      all.forEach(a => { a._done = true; });
      saveAnnotations(all);
      return `All ${all.length} annotations marked as done.`;
    }
  }

  if (name === 'clear_annotations') {
    saveAnnotations([]);
    return 'All annotations cleared.';
  }

  if (name === 'read_agent_feedback') {
    if (!existsSync(AGENT_FILE)) return 'No agent_feedback.md found yet.';
    return readFileSync(AGENT_FILE, 'utf-8');
  }

  if (name === 'list_feedback_files') {
    if (!existsSync(FEEDBACK_DIR)) return 'No feedback directory found.';
    const files = readdirSync(FEEDBACK_DIR).filter(f => f.endsWith('.md') || f.endsWith('.json'));
    if (!files.length) return 'No feedback files found.';
    return 'Feedback files:\n' + files.map(f => `- ${f}`).join('\n');
  }

  return `Unknown tool: ${name}`;
}

// ─── JSON-RPC stdio (NDJSON — Claude Code MCP 标准格式) ──────────────────────

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

let lineBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  lineBuf += chunk;
  const lines = lineBuf.split('\n');
  lineBuf = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { handle(JSON.parse(trimmed)); } catch {}
  }
});

function handle(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'fluxvita-feedback', version: '1.0.0' },
        capabilities: { tools: {} },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    const text = executeTool(params?.name, params?.arguments ?? {});
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    return;
  }

  if (id != null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

// ─── HTTP Relay Server（接收 App 反馈副本，无需本地跑 Gateway）──────────────

const RELAY_PORT = parseInt(process.env['FEEDBACK_RELAY_PORT'] || '18801', 10);

function ensureFeedbackDir() {
  if (!existsSync(FEEDBACK_DIR)) mkdirSync(FEEDBACK_DIR, { recursive: true });
}

createServer((req, res) => {
  // CORS — 允许来自任意本地源（Tauri proxy / localhost gateway 等）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/api/feedback/batch') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { annotations } = JSON.parse(body);
        if (Array.isArray(annotations) && annotations.length > 0) {
          ensureFeedbackDir();
          let existing = [];
          try { existing = JSON.parse(readFileSync(ANNOTATIONS_FILE, 'utf-8')); } catch {}
          const withMeta = annotations.map(a => ({ ...a, _savedAt: new Date().toISOString(), _done: false }));
          saveAnnotations([...existing, ...withMeta]);
          process.stderr.write(`[feedback-relay] saved ${annotations.length} annotations\n`);
        }
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  res.writeHead(404); res.end();
}).listen(RELAY_PORT, '127.0.0.1', () => {
  process.stderr.write(`[feedback-relay] listening on http://127.0.0.1:${RELAY_PORT}\n`);
});

process.stderr.write('[fluxvita-feedback MCP] started\n');
