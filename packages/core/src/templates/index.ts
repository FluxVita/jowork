// @jowork/core/templates — Conversation template management
//
// Templates let users pre-define system prompts and first messages
// for common conversation patterns (code review, brainstorm, etc.)

import { randomUUID } from 'node:crypto';
import { getDb } from '../datamap/db.js';

export interface ConversationTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  firstMessage: string;
  icon: string;
  ownerId: string;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  systemPrompt?: string;
  firstMessage?: string;
  icon?: string;
  ownerId: string;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  firstMessage?: string;
  icon?: string;
}

interface DbRow {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  first_message: string;
  icon: string;
  owner_id: string;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(row: DbRow): ConversationTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    firstMessage: row.first_message,
    icon: row.icon,
    ownerId: row.owner_id,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTemplate(input: CreateTemplateInput): ConversationTemplate {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO conversation_templates (id, name, description, system_prompt, first_message, icon, owner_id, is_builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, input.name, input.description ?? '', input.systemPrompt ?? '', input.firstMessage ?? '', input.icon ?? '', input.ownerId, now, now);

  return {
    id, name: input.name, description: input.description ?? '', systemPrompt: input.systemPrompt ?? '',
    firstMessage: input.firstMessage ?? '', icon: input.icon ?? '', ownerId: input.ownerId,
    isBuiltin: false, createdAt: now, updatedAt: now,
  };
}

export function listTemplates(ownerId: string): ConversationTemplate[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM conversation_templates WHERE owner_id = ? OR is_builtin = 1 ORDER BY is_builtin DESC, name ASC`).all(ownerId) as DbRow[];
  return rows.map(rowToTemplate);
}

export function getTemplate(id: string): ConversationTemplate | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM conversation_templates WHERE id = ?`).get(id) as DbRow | undefined;
  return row ? rowToTemplate(row) : undefined;
}

export function updateTemplate(id: string, ownerId: string, input: UpdateTemplateInput): ConversationTemplate | undefined {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM conversation_templates WHERE id = ? AND owner_id = ? AND is_builtin = 0`).get(id, ownerId) as DbRow | undefined;
  if (!existing) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
  if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description); }
  if (input.systemPrompt !== undefined) { fields.push('system_prompt = ?'); values.push(input.systemPrompt); }
  if (input.firstMessage !== undefined) { fields.push('first_message = ?'); values.push(input.firstMessage); }
  if (input.icon !== undefined) { fields.push('icon = ?'); values.push(input.icon); }

  if (fields.length === 0) return rowToTemplate(existing);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE conversation_templates SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return getTemplate(id);
}

export function deleteTemplate(id: string, ownerId: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM conversation_templates WHERE id = ? AND owner_id = ? AND is_builtin = 0`).run(id, ownerId);
  return result.changes > 0;
}

/** Seed built-in templates (idempotent). */
export function seedBuiltinTemplates(): void {
  const db = getDb();
  const existing = db.prepare(`SELECT COUNT(*) AS cnt FROM conversation_templates WHERE is_builtin = 1`).get() as { cnt: number };
  if (existing.cnt > 0) return;

  const now = new Date().toISOString();
  const builtins = [
    { id: 'tpl-code-review', name: 'Code Review', description: 'Review code changes for quality, bugs, and style', systemPrompt: 'You are a senior code reviewer. Analyze the code for bugs, performance issues, security vulnerabilities, and style. Be specific and constructive.', firstMessage: '', icon: 'magnifying-glass' },
    { id: 'tpl-brainstorm', name: 'Brainstorm', description: 'Generate ideas and explore solutions', systemPrompt: 'You are a creative brainstorming partner. Help explore ideas broadly before narrowing down. Ask clarifying questions and build on ideas.', firstMessage: '', icon: 'lightbulb' },
    { id: 'tpl-debug', name: 'Debug Helper', description: 'Diagnose and fix bugs systematically', systemPrompt: 'You are a debugging expert. Help diagnose the root cause of bugs systematically. Ask for error messages, logs, and reproduction steps. Suggest targeted fixes.', firstMessage: '', icon: 'wrench' },
    { id: 'tpl-summarize', name: 'Summarize', description: 'Summarize documents, meetings, or discussions', systemPrompt: 'You are a summarization assistant. Produce clear, concise summaries that capture key points, action items, and decisions. Use bullet points when helpful.', firstMessage: '', icon: 'document' },
  ];

  const stmt = db.prepare(`INSERT OR IGNORE INTO conversation_templates (id, name, description, system_prompt, first_message, icon, owner_id, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'system', 1, ?, ?)`);
  for (const t of builtins) {
    stmt.run(t.id, t.name, t.description, t.systemPrompt, t.firstMessage, t.icon, now, now);
  }
}
