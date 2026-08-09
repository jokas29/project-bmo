export interface MemoryRecord {
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
}

/**
 * Persistence boundary for explicit memories.
 *
 * `load` returns `unknown` intentionally: data read from disk must be validated
 * by the domain service before it can become a `MemoryRecord`.
 */
export interface MemoryStore {
  load(): Promise<unknown>;
  save(memories: readonly MemoryRecord[]): Promise<void>;
}
