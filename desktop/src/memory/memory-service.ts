import type { MemoryRecord, MemoryStore } from "./memory-store";

export const MAX_MEMORY_RECORDS = 32;
export const MAX_MEMORY_TEXT_CODE_POINTS = 240;

export type MemoryServiceErrorCode =
  | "empty-memory"
  | "memory-too-long"
  | "memory-limit-reached"
  | "storage-error";

export class MemoryServiceError extends Error {
  readonly code: MemoryServiceErrorCode;

  constructor(code: MemoryServiceErrorCode, message: string) {
    super(message);
    this.name = "MemoryServiceError";
    this.code = code;
  }
}

export type RememberMemoryResult =
  | { readonly kind: "stored"; readonly memory: MemoryRecord }
  | { readonly kind: "duplicate"; readonly memory: MemoryRecord };

export type MemoryListener = (
  memories: readonly MemoryRecord[],
) => void;

export interface MemoryService {
  initialize(): Promise<void>;
  getMemories(): readonly MemoryRecord[];
  remember(text: string): Promise<RememberMemoryResult>;
  removeMemory(id: string): Promise<boolean>;
  subscribe(listener: MemoryListener): () => void;
}

export interface MemoryServiceOptions {
  store: MemoryStore;
  createId?: () => string;
  now?: () => Date;
  logger?: Pick<Console, "warn">;
}

function cloneMemory(memory: MemoryRecord): MemoryRecord {
  return { ...memory };
}

function cloneMemories(
  memories: readonly MemoryRecord[],
): readonly MemoryRecord[] {
  return memories.map(cloneMemory);
}

function countCodePoints(text: string): number {
  return Array.from(text).length;
}

function duplicateKey(text: string): string {
  return text.trim().toLowerCase();
}

function readStoredMemory(value: unknown): MemoryRecord | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const id = Reflect.get(value, "id");
  const text = Reflect.get(value, "text");
  const createdAt = Reflect.get(value, "createdAt");

  if (
    typeof id !== "string" ||
    id.trim().length === 0 ||
    typeof text !== "string" ||
    typeof createdAt !== "string"
  ) {
    return undefined;
  }

  const trimmedText = text.trim();
  const createdAtTime = Date.parse(createdAt);

  if (
    trimmedText.length === 0 ||
    countCodePoints(trimmedText) > MAX_MEMORY_TEXT_CODE_POINTS ||
    !Number.isFinite(createdAtTime)
  ) {
    return undefined;
  }

  return {
    id: id.trim(),
    text: trimmedText,
    createdAt: new Date(createdAtTime).toISOString(),
  };
}

function sanitizeStoredMemories(raw: unknown): {
  memories: MemoryRecord[];
  recovered: boolean;
} {
  if (raw === undefined) {
    return { memories: [], recovered: false };
  }

  if (!Array.isArray(raw)) {
    return { memories: [], recovered: true };
  }

  const memories: MemoryRecord[] = [];
  const ids = new Set<string>();
  const texts = new Set<string>();
  let recovered = false;

  for (const value of raw) {
    const memory = readStoredMemory(value);

    if (memory === undefined) {
      recovered = true;
      continue;
    }

    const textKey = duplicateKey(memory.text);

    if (ids.has(memory.id) || texts.has(textKey)) {
      recovered = true;
      continue;
    }

    if (memories.length === MAX_MEMORY_RECORDS) {
      recovered = true;
      continue;
    }

    ids.add(memory.id);
    texts.add(textKey);
    memories.push(memory);
  }

  return { memories, recovered };
}

export function createMemoryService({
  store,
  createId = () => crypto.randomUUID(),
  now = () => new Date(),
  logger = console,
}: MemoryServiceOptions): MemoryService {
  let memories: MemoryRecord[] = [];
  let initialized = false;
  let storageLoaded = false;
  let initialization: Promise<void> | undefined;
  let mutationQueue: Promise<void> = Promise.resolve();
  const listeners = new Set<MemoryListener>();

  function notifyListeners(): void {
    for (const listener of listeners) {
      try {
        listener(cloneMemories(memories));
      } catch (error) {
        logger.warn("A BMO memory listener failed.", error);
      }
    }
  }

  async function reloadStorageBeforeMutation(): Promise<void> {
    if (storageLoaded) {
      return;
    }

    try {
      const loaded = sanitizeStoredMemories(await store.load());
      memories = loaded.memories;
      storageLoaded = true;

      if (loaded.recovered) {
        logger.warn(
          "BMO memory contained invalid data during retry; only safe records were loaded.",
        );
      }

      notifyListeners();
    } catch (error) {
      logger.warn(
        "BMO memory could not be reloaded before a persistent change.",
        error,
      );
      throw new MemoryServiceError(
        "storage-error",
        "No pude acceder a la memoria local. Inténtalo de nuevo.",
      );
    }
  }

  async function initialize(): Promise<void> {
    if (initialized) {
      return;
    }

    if (initialization !== undefined) {
      return initialization;
    }

    initialization = (async () => {
      try {
        const raw = await store.load();
        const loaded = sanitizeStoredMemories(raw);
        memories = loaded.memories;
        storageLoaded = true;

        if (loaded.recovered) {
          logger.warn(
            "BMO memory contained invalid data; only safe records were loaded.",
          );
        }

        if (raw === undefined || loaded.recovered) {
          try {
            await store.save(cloneMemories(memories));
          } catch (error) {
            logger.warn(
              "BMO memory could not initialize its safe on-disk snapshot.",
              error,
            );
          }
        }
      } catch (error) {
        memories = [];
        storageLoaded = false;
        logger.warn(
          "BMO memory could not be loaded; continuing with an empty list.",
          error,
        );
      }

      initialized = true;
    })();

    try {
      await initialization;
    } finally {
      initialization = undefined;
    }
  }

  function getMemories(): readonly MemoryRecord[] {
    return cloneMemories(memories);
  }

  function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation);

    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  async function saveCandidate(
    candidate: readonly MemoryRecord[],
  ): Promise<void> {
    try {
      await store.save(cloneMemories(candidate));
    } catch {
      throw new MemoryServiceError(
        "storage-error",
        "No pude guardar la memoria en este momento.",
      );
    }
  }

  async function remember(text: string): Promise<RememberMemoryResult> {
    const trimmedText = text.trim();

    if (trimmedText.length === 0) {
      throw new MemoryServiceError(
        "empty-memory",
        "Dime qué quieres que recuerde después de ‘recuerda que’.",
      );
    }

    if (countCodePoints(trimmedText) > MAX_MEMORY_TEXT_CODE_POINTS) {
      throw new MemoryServiceError(
        "memory-too-long",
        `El recuerdo no puede superar ${MAX_MEMORY_TEXT_CODE_POINTS} caracteres.`,
      );
    }

    await initialize();

    return enqueueMutation(async () => {
      await reloadStorageBeforeMutation();

      const textKey = duplicateKey(trimmedText);
      const duplicate = memories.find(
        (memory) => duplicateKey(memory.text) === textKey,
      );

      if (duplicate !== undefined) {
        return { kind: "duplicate", memory: cloneMemory(duplicate) };
      }

      if (memories.length >= MAX_MEMORY_RECORDS) {
        throw new MemoryServiceError(
          "memory-limit-reached",
          `La memoria ya alcanzó su límite de ${MAX_MEMORY_RECORDS} recuerdos.`,
        );
      }

      const memory: MemoryRecord = {
        id: createId(),
        text: trimmedText,
        createdAt: now().toISOString(),
      };
      const candidate = [...memories, memory];

      await saveCandidate(candidate);
      memories = candidate;
      notifyListeners();

      return { kind: "stored", memory: cloneMemory(memory) };
    });
  }

  async function removeMemory(id: string): Promise<boolean> {
    await initialize();

    return enqueueMutation(async () => {
      await reloadStorageBeforeMutation();

      const candidate = memories.filter((memory) => memory.id !== id);

      if (candidate.length === memories.length) {
        return false;
      }

      await saveCandidate(candidate);
      memories = candidate;
      notifyListeners();

      return true;
    });
  }

  function subscribe(listener: MemoryListener): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
  }

  return {
    initialize,
    getMemories,
    remember,
    removeMemory,
    subscribe,
  };
}
