/**
 * memory/embedding.ts — Free tier: no-op stubs
 * Premium 通过 registerEmbeddingFunctions() 注入真实实现
 */

type EmbedFn = (text: string) => Promise<Float32Array | null>;
type SimilarityFn = (a: Float32Array, b: Float32Array) => number;
type PackFn = (vec: Float32Array) => Buffer;
type UnpackFn = (buf: Buffer) => Float32Array;
type StoreFn = (memoryId: string, vec: Float32Array) => void;
type LoadFn = (userId: string) => Map<string, Float32Array>;
type ScheduleFn = (memoryId: string, text: string) => void;

let _computeEmbedding: EmbedFn = async () => null;
let _cosineSimilarity: SimilarityFn = () => 0;
let _packEmbedding: PackFn = () => Buffer.alloc(0);
let _unpackEmbedding: UnpackFn = () => new Float32Array(0);
let _storeMemoryEmbedding: StoreFn = () => {};
let _loadMemoryEmbeddings: LoadFn = () => new Map();
let _scheduleEmbedding: ScheduleFn = () => {};

/** Premium 调用此函数注入真实实现 */
export function registerEmbeddingFunctions(fns: {
  computeEmbedding: EmbedFn;
  cosineSimilarity: SimilarityFn;
  packEmbedding: PackFn;
  unpackEmbedding: UnpackFn;
  storeMemoryEmbedding: StoreFn;
  loadMemoryEmbeddings: LoadFn;
  scheduleEmbedding: ScheduleFn;
}) {
  _computeEmbedding = fns.computeEmbedding;
  _cosineSimilarity = fns.cosineSimilarity;
  _packEmbedding = fns.packEmbedding;
  _unpackEmbedding = fns.unpackEmbedding;
  _storeMemoryEmbedding = fns.storeMemoryEmbedding;
  _loadMemoryEmbeddings = fns.loadMemoryEmbeddings;
  _scheduleEmbedding = fns.scheduleEmbedding;
}

export const computeEmbedding: EmbedFn = (text) => _computeEmbedding(text);
export const cosineSimilarity: SimilarityFn = (a, b) => _cosineSimilarity(a, b);
export const packEmbedding: PackFn = (vec) => _packEmbedding(vec);
export const unpackEmbedding: UnpackFn = (buf) => _unpackEmbedding(buf);
export const storeMemoryEmbedding: StoreFn = (id, vec) => _storeMemoryEmbedding(id, vec);
export const loadMemoryEmbeddings: LoadFn = (uid) => _loadMemoryEmbeddings(uid);
export const scheduleEmbedding: ScheduleFn = (id, text) => _scheduleEmbedding(id, text);
