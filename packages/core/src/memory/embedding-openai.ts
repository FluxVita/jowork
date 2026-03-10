/**
 * memory/embedding-openai.ts — Phase 6.1: Built-in OpenAI Embedding Provider
 *
 * 开源用户配置 OPENAI_API_KEY 即可使用向量搜索。
 * 调用 initBuiltinEmbeddings() 注册到 embedding.ts 的 DI 系统。
 */
import { getDb } from '../datamap/db.js';
import { config as gatewayConfig } from '../config.js';
import { registerEmbeddingFunctions } from './embedding.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('embedding-openai');

// ─── OpenAI Embedding ───

async function openaiEmbedding(text: string): Promise<Float32Array | null> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) return null;

  const model = gatewayConfig.memoryEmbeddingModel || 'text-embedding-3-small';

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text.slice(0, 8000), // 避免超长
        model,
      }),
    });

    if (!res.ok) {
      log.warn(`OpenAI embedding failed: ${res.status}`);
      return null;
    }

    const data = await res.json() as { data?: Array<{ embedding: number[] }> };
    const vec = data.data?.[0]?.embedding;
    if (!vec) return null;

    return new Float32Array(vec);
  } catch (err) {
    log.warn(`OpenAI embedding error:`, err);
    return null;
  }
}

// ─── 余弦相似度 ───

function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Pack/Unpack ───

function packVec(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function unpackVec(buf: Buffer): Float32Array {
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.length; i++) view[i] = buf[i];
  return new Float32Array(ab);
}

// ─── SQLite 存储 ───

function storeEmbedding(memoryId: string, vec: Float32Array): void {
  const db = getDb();
  const packed = packVec(vec);
  db.prepare('UPDATE user_memories SET embedding = ? WHERE memory_id = ?').run(packed, memoryId);
}

function loadEmbeddings(userId: string): Map<string, Float32Array> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT memory_id, embedding FROM user_memories WHERE user_id = ? AND embedding IS NOT NULL'
  ).all(userId) as Array<{ memory_id: string; embedding: Buffer }>;

  const map = new Map<string, Float32Array>();
  for (const row of rows) {
    try {
      map.set(row.memory_id, unpackVec(row.embedding));
    } catch { /* skip corrupt entries */ }
  }
  return map;
}

// ─── 异步 Embedding 调度 ───

const pendingQueue: Array<{ memoryId: string; text: string }> = [];
let processing = false;

function scheduleEmbedding(memoryId: string, text: string): void {
  pendingQueue.push({ memoryId, text });
  processQueue();
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (pendingQueue.length > 0) {
    const item = pendingQueue.shift()!;
    let retries = 0;
    const MAX_RETRIES = 1;
    while (retries <= MAX_RETRIES) {
      try {
        const vec = await openaiEmbedding(item.text);
        if (vec) {
          storeEmbedding(item.memoryId, vec);
        }
        break; // 成功或返回 null（API key 缺失等）均退出
      } catch (err) {
        retries++;
        if (retries > MAX_RETRIES) {
          log.warn(`Failed to compute embedding for ${item.memoryId} after ${retries} attempts:`, err);
        } else {
          log.info(`Retrying embedding for ${item.memoryId} (attempt ${retries + 1})`);
          await new Promise(r => setTimeout(r, 1000 * retries)); // 简单退避
        }
      }
    }
  }

  processing = false;
}

// ─── 初始化 ───

/**
 * 注册内置 OpenAI embedding provider
 *
 * 调用时机：gateway 启动时，在 config 加载之后
 * 条件：MEMORY_EMBEDDING_PROVIDER !== 'none' && OPENAI_API_KEY 已配置
 */
export function initBuiltinEmbeddings(): boolean {
  const provider = gatewayConfig.memoryEmbeddingProvider;

  if (provider === 'none' || !provider) {
    log.info('Embedding provider: none (vector search disabled)');
    return false;
  }

  if (provider === 'openai') {
    if (!process.env['OPENAI_API_KEY']) {
      log.warn('Embedding provider set to openai but OPENAI_API_KEY not found');
      return false;
    }

    registerEmbeddingFunctions({
      computeEmbedding: openaiEmbedding,
      cosineSimilarity: cosineSim,
      packEmbedding: packVec,
      unpackEmbedding: unpackVec,
      storeMemoryEmbedding: storeEmbedding,
      loadMemoryEmbeddings: loadEmbeddings,
      scheduleEmbedding,
    });

    log.info(`Embedding provider: openai (model: ${gatewayConfig.memoryEmbeddingModel || 'text-embedding-3-small'})`);
    return true;
  }

  log.warn(`Unknown embedding provider: ${provider}`);
  return false;
}
