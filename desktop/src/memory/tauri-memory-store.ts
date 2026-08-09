import { load, type Store } from "@tauri-apps/plugin-store";

import type { MemoryStore } from "./memory-store";

const MEMORY_STORE_PATH = "bmo-memory.json";
const MEMORY_RECORDS_KEY = "records";

let memoryStorePromise: Promise<Store> | undefined;

function getMemoryStore(): Promise<Store> {
  if (!memoryStorePromise) {
    memoryStorePromise = load(MEMORY_STORE_PATH, { autoSave: false }).catch(
      (error: unknown) => {
        memoryStorePromise = undefined;
        throw error;
      },
    );
  }

  return memoryStorePromise;
}

export function createTauriMemoryStore(): MemoryStore {
  return {
    async load(): Promise<unknown> {
      const store = await getMemoryStore();
      return store.get<unknown>(MEMORY_RECORDS_KEY);
    },

    async save(records): Promise<void> {
      const store = await getMemoryStore();
      const previousRecords = await store.get<unknown>(MEMORY_RECORDS_KEY);
      await store.set(MEMORY_RECORDS_KEY, [...records]);

      try {
        await store.save();
      } catch (error) {
        try {
          await store.set(MEMORY_RECORDS_KEY, previousRecords ?? []);
        } catch {
          // Preserve the original disk error if the in-memory rollback fails.
        }

        throw error;
      }
    },
  };
}
