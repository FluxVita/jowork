// @jowork/premium/memory/embedding — vector semantic search
// Uses Moonshot embedding API (configurable via env: MOONSHOT_API_KEY)

export interface EmbeddingResult {
  id: string;
  content: string;
  score: number;
}

/** Get embedding vector for text using configured provider */
async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env['MOONSHOT_API_KEY'];
  if (!apiKey) throw new Error('MOONSHOT_API_KEY is required for vector search');

  const res = await fetch('https://api.moonshot.cn/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'moonshot-v1-embedding', input: text }),
  });

  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0]?.embedding ?? [];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/**
 * Semantic search over memories using embedding similarity.
 * Requires a `memory_embeddings` table (created by premium schema migration).
 */
export async function semanticSearchMemory(
  query: string,
  userId: string,
  limit = 10,
): Promise<EmbeddingResult[]> {
  const { getDb } = await import('@jowork/core');
  const db = getDb();

  // Fetch all embeddings for user (for MVP — replace with vector DB in production)
  const rows = db.prepare(
    `SELECT m.id, m.content, me.vector FROM memories m
     JOIN memory_embeddings me ON m.id = me.memory_id
     WHERE m.user_id = ?`,
  ).all(userId) as Array<{ id: string; content: string; vector: string }>;

  if (rows.length === 0) return [];

  const queryVec = await getEmbedding(query);
  const scored = rows.map(row => ({
    id: row.id,
    content: row.content,
    score: cosineSimilarity(queryVec, JSON.parse(row.vector) as number[]),
  }));

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
