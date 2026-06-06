import { useState, useCallback, useEffect } from 'react';
import type { ModelCapabilities } from '../../../services/openRouterCatalog';

export interface CustomModel {
  id: string;
  label?: string;
  description?: string;
  capabilities?: ModelCapabilities;
}

function readPluginModels(storageKey: string): CustomModel[] {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is CustomModel => !!m && typeof m === 'object' && typeof m.id === 'string' && m.id.trim().length > 0)
      .map(m => ({
        id: m.id,
        label: m.label,
        description: m.description,
        capabilities: m.capabilities && typeof m.capabilities === 'object' ? m.capabilities : undefined,
      }));
  } catch {
    return [];
  }
}

function writePluginModels(storageKey: string, models: CustomModel[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(models));
    window.dispatchEvent(new CustomEvent('localStorageChange', { detail: { key: storageKey } }));
  } catch {
    // localStorage write failure (e.g. quota exceeded)
  }
}

interface LocalStorageChangeDetail {
  key: string;
}

/**
 * Hook to manage plugin-level custom models with localStorage persistence.
 * Listens for both native StorageEvent (cross-tab) and custom localStorageChange (same-tab) events.
 */
export function usePluginModels(storageKey: string) {
  const [models, setModels] = useState<CustomModel[]>(() => readPluginModels(storageKey));

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey) {
        setModels(readPluginModels(storageKey));
      }
    };
    const handleCustomChange = (e: Event) => {
      const detail = (e as CustomEvent<LocalStorageChangeDetail>).detail;
      if (detail?.key === storageKey) {
        setModels(readPluginModels(storageKey));
      }
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('localStorageChange', handleCustomChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('localStorageChange', handleCustomChange);
    };
  }, [storageKey]);

  const updateModels = useCallback((newModels: CustomModel[]) => {
    setModels(newModels);
    writePluginModels(storageKey, newModels);
  }, [storageKey]);

  return { models, updateModels };
}
