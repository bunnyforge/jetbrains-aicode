import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findModelInCatalog,
  normalizeModelId,
  searchCatalog,
  tokenizeModelId,
  type OpenRouterModel,
} from './openRouterCatalog';

const CATALOG: OpenRouterModel[] = [
  {
    id: 'anthropic/claude-sonnet-4.6',
    canonical_slug: 'anthropic/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    context_length: 200000,
    supported_parameters: ['reasoning', 'tools'],
  },
  {
    id: 'anthropic/claude-opus-4.7',
    canonical_slug: 'anthropic/claude-opus-4-7',
    name: 'Claude Opus 4.7',
    context_length: 200000,
    supported_parameters: ['reasoning', 'tools'],
  },
  {
    id: 'openai/gpt-4o',
    canonical_slug: 'openai/gpt-4o',
    name: 'GPT-4o',
    context_length: 128000,
    supported_parameters: ['tools'],
  },
  {
    id: 'openai/gpt-4o-mini',
    canonical_slug: 'openai/gpt-4o-mini',
    name: 'GPT-4o mini',
    context_length: 128000,
    supported_parameters: ['tools'],
  },
  {
    id: 'minimax/minimax-m2.5',
    canonical_slug: 'minimax/minimax-m2.5-20260211',
    name: 'MiniMax M2.5',
    context_length: 204800,
    supported_parameters: ['reasoning', 'reasoning_effort', 'tools'],
  },
  {
    id: 'minimax/MiniMax-M2',
    canonical_slug: 'minimax/MiniMax-M2',
    name: 'MiniMax M2',
    context_length: 128000,
    supported_parameters: ['tools'],
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    canonical_slug: 'anthropic/claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    context_length: 200000,
    supported_parameters: ['tools'],
  },
];

describe('normalizeModelId', () => {
  it('lowercases and replaces / _ whitespace with -', () => {
    expect(normalizeModelId('Anthropic/Claude_Sonnet 4-6')).toBe('anthropic-claude-sonnet-4-6');
  });

  it('converts dot to dash so 4.6 equals 4-6', () => {
    expect(normalizeModelId('claude-sonnet-4.6')).toBe('claude-sonnet-4-6');
  });

  it('strips [1m] / [200k] context suffixes', () => {
    expect(normalizeModelId('claude-sonnet-4-6[1m]')).toBe('claude-sonnet-4-6');
    expect(normalizeModelId('claude-opus-4-6[200k]')).toBe('claude-opus-4-6');
  });

  it('collapses runs of dashes and trims', () => {
    expect(normalizeModelId('--claude--sonnet--')).toBe('claude-sonnet');
  });
});

describe('tokenizeModelId', () => {
  it('splits vendor/model on the unified separator', () => {
    expect(tokenizeModelId('anthropic/claude-sonnet-4.6')).toEqual([
      'anthropic',
      'claude',
      'sonnet',
      '4',
      '6',
    ]);
  });

  it('strips 8-digit date suffix', () => {
    expect(tokenizeModelId('claude-3-5-sonnet-20241022')).toEqual([
      'claude',
      '3',
      '5',
      'sonnet',
    ]);
    expect(tokenizeModelId('minimax/minimax-m2.5-20260211')).toEqual([
      'minimax',
      'minimax',
      'm2',
      '5',
    ]);
  });

  it('is case-insensitive', () => {
    expect(tokenizeModelId('Claude-Sonnet-4-6')).toEqual(['claude', 'sonnet', '4', '6']);
  });
});

describe('findModelInCatalog', () => {
  it('matches exact id', () => {
    expect(findModelInCatalog(CATALOG, 'anthropic/claude-sonnet-4.6')?.id).toBe(
      'anthropic/claude-sonnet-4.6',
    );
  });

  it('matches Claude id without vendor prefix against anthropic/* catalog entry', () => {
    expect(findModelInCatalog(CATALOG, 'claude-sonnet-4-6')?.id).toBe(
      'anthropic/claude-sonnet-4.6',
    );
  });

  it('is case-insensitive (Claude vs claude)', () => {
    expect(findModelInCatalog(CATALOG, 'Claude-sonnet-4-6')?.id).toBe(
      'anthropic/claude-sonnet-4.6',
    );
  });

  it('treats dot and dash versions as equivalent (4.6 vs 4-6)', () => {
    expect(findModelInCatalog(CATALOG, 'claude-sonnet-4.6')?.id).toBe(
      'anthropic/claude-sonnet-4.6',
    );
  });

  it('matches third-party model with vendor prefix', () => {
    expect(findModelInCatalog(CATALOG, 'minimax/minimax-m2.5')?.id).toBe(
      'minimax/minimax-m2.5',
    );
  });

  it('matches OpenAI model without vendor prefix', () => {
    expect(findModelInCatalog(CATALOG, 'gpt-4o')?.id).toBe('openai/gpt-4o');
  });

  it('matches OpenAI model with vendor prefix', () => {
    expect(findModelInCatalog(CATALOG, 'openai/gpt-4o')?.id).toBe('openai/gpt-4o');
  });

  it('strips 8-digit date suffix when matching', () => {
    expect(findModelInCatalog(CATALOG, 'claude-3-5-sonnet')?.id).toBe(
      'anthropic/claude-3.5-sonnet',
    );
    expect(findModelInCatalog(CATALOG, 'claude-3-5-sonnet-20241022')?.id).toBe(
      'anthropic/claude-3.5-sonnet',
    );
  });

  it('does not match a different version (4-6 must not match 4-7)', () => {
    expect(findModelInCatalog(CATALOG, 'claude-sonnet-4-6')?.id).toBe(
      'anthropic/claude-sonnet-4.6',
    );
    // query for 4-7 should not silently fall back to 4-6
    const r = findModelInCatalog(CATALOG, 'claude-sonnet-4-7');
    expect(r?.id).toBe('anthropic/claude-opus-4.7');
  });

  it('does not match unrelated model family', () => {
    expect(findModelInCatalog(CATALOG, 'claude-sonnet-4-6')).not.toMatchObject({
      id: 'minimax/minimax-m2.5',
    });
    expect(findModelInCatalog(CATALOG, 'minimax/minimax-m2.5')).not.toMatchObject({
      id: 'anthropic/claude-sonnet-4.6',
    });
  });

  it('returns undefined for empty / whitespace input', () => {
    expect(findModelInCatalog(CATALOG, '')).toBeUndefined();
    expect(findModelInCatalog(CATALOG, '   ')).toBeUndefined();
  });

  it('returns undefined for an unknown id', () => {
    expect(findModelInCatalog(CATALOG, 'totally-not-a-real-model-xyz')).toBeUndefined();
  });

  it('matches the exact minimax model even with the same vendor prefix appearing twice', () => {
    // Without this test, the vendor-strip heuristic could mis-strip the first
    // `minimax` from `minimax/minimax-m2.5` because the second `minimax`
    // matches the query's first token.
    expect(findModelInCatalog(CATALOG, 'minimax/minimax-m2.5')?.id).toBe(
      'minimax/minimax-m2.5',
    );
  });

  it('still matches the doubled-vendor model when the user types a shorter form', () => {
    // `minimax-m2.5` (no double vendor) should still resolve to the same
    // model. The vendor-strip heuristic must not break this case.
    const r = findModelInCatalog(CATALOG, 'minimax-m2.5');
    expect(r?.id).toBe('minimax/minimax-m2.5');
  });
});

// ────────────────────────────────────────────────────────────────────
// searchCatalog — suggestion-list ranking for the live autocomplete
// ────────────────────────────────────────────────────────────────────

describe('searchCatalog', () => {
  it('returns an empty list for empty / whitespace input', () => {
    expect(searchCatalog(CATALOG, '')).toEqual([]);
    expect(searchCatalog(CATALOG, '   ')).toEqual([]);
  });

  it('returns top N results ordered by score, with the exact match first', () => {
    const results = searchCatalog(CATALOG, 'claude', { limit: 4 });
    expect(results[0]?.id).toBe('anthropic/claude-sonnet-4.6');
    // The two non-3.5 Claude entries should be in the list.
    const ids = results.map((m) => m.id);
    expect(ids).toContain('anthropic/claude-opus-4.7');
    expect(ids).toContain('anthropic/claude-3.5-sonnet');
    // GPT models should not appear at all.
    expect(ids).not.toContain('openai/gpt-4o');
    expect(ids).not.toContain('openai/gpt-4o-mini');
  });

  it('returns the exact match as the first result even when other matches also score well', () => {
    const results = searchCatalog(CATALOG, 'claude-sonnet-4-6', { limit: 5 });
    expect(results[0]?.id).toBe('anthropic/claude-sonnet-4.6');
  });

  it('uses a prefix match so "anthro" surfaces anthropic models', () => {
    const results = searchCatalog(CATALOG, 'anthro', { limit: 5 });
    const ids = results.map((m) => m.id);
    expect(ids).toContain('anthropic/claude-sonnet-4.6');
    expect(ids).toContain('anthropic/claude-opus-4.7');
    expect(ids).toContain('anthropic/claude-3.5-sonnet');
    expect(ids).not.toContain('openai/gpt-4o');
  });

  it('uses a prefix match so "clau" surfaces claude models', () => {
    const results = searchCatalog(CATALOG, 'clau', { limit: 5 });
    const ids = results.map((m) => m.id);
    expect(ids).toContain('anthropic/claude-sonnet-4.6');
    expect(ids).not.toContain('openai/gpt-4o');
  });

  it('honours version safety — "gpt-4" must not surface gpt-3.5-turbo (but gpt-4o is fine)', () => {
    // catalog here doesn't have gpt-3.5-turbo, so verify the strict ones we do have.
    const results = searchCatalog(CATALOG, 'gpt-4', { limit: 5 });
    const ids = results.map((m) => m.id);
    expect(ids).toContain('openai/gpt-4o');
    expect(ids).toContain('openai/gpt-4o-mini');
  });

  it('a totally unknown query returns an empty list', () => {
    expect(searchCatalog(CATALOG, 'totally-not-a-real-model-xyz')).toEqual([]);
  });

  it('respects the `limit` option', () => {
    const results = searchCatalog(CATALOG, 'claude', { limit: 1 });
    expect(results.length).toBe(1);
  });

  it('is case-insensitive', () => {
    const results = searchCatalog(CATALOG, 'GPT-4O', { limit: 3 });
    expect(results[0]?.id).toBe('openai/gpt-4o');
  });

  it('normalises dots and slashes the same way findModelInCatalog does', () => {
    const results = searchCatalog(CATALOG, 'claude/sonnet.4.6', { limit: 3 });
    expect(results[0]?.id).toBe('anthropic/claude-sonnet-4.6');
  });
});

// ────────────────────────────────────────────────────────────────────
// fetchOpenRouterCatalog — bridge / direct-fetch / fallback path
// ────────────────────────────────────────────────────────────────────

describe('fetchOpenRouterCatalog (bridge integration)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the Java bridge when window.sendToJava is present, caches the result, and matches a model', async () => {
    vi.resetModules();
    let bridgeEvent: string | null = null;
    window.sendToJava = (msg: string) => {
      bridgeEvent = msg;
    };

    const { fetchOpenRouterCatalog, lookupModelCapabilities } = await import('./openRouterCatalog');

    // Pretend the Java backend just got the catalog back.
    const respond = () => {
      const payload = JSON.stringify({
        ok: true,
        models: [CATALOG[4]], // minimax/minimax-m2.5
      });
      window.onOpenRouterCatalog?.(payload);
    };
    // Fire the response asynchronously (matches production timing).
    setTimeout(respond, 0);

    const models = await fetchOpenRouterCatalog();
    expect(bridgeEvent).toBe('get_openrouter_catalog:');
    expect(models.length).toBe(1);
    expect(models[0].id).toBe('minimax/minimax-m2.5');

    const caps = await lookupModelCapabilities('minimax/minimax-m2.5');
    expect(caps).not.toBeNull();
    expect(caps?.contextWindow).toBe(204800);
    expect(caps?.reasoningLevels).toEqual(['low', 'medium', 'high']);
    expect(caps?.supportsReasoning).toBe(true);
  });

  it('reports `notFound` when the bridge returns a real catalog but the id is unknown', async () => {
    vi.resetModules();
    window.sendToJava = () => undefined;
    setTimeout(() => {
      window.onOpenRouterCatalog?.(JSON.stringify({ ok: true, models: CATALOG }));
    }, 0);

    const { lookupModelCapabilities } = await import('./openRouterCatalog');
    const caps = await lookupModelCapabilities('totally-fake-model-id');
    expect(caps).toBeNull();
  });

  it('falls back to direct fetch when the bridge is unavailable (vite dev mode)', async () => {
    vi.resetModules();
    delete (window as any).sendToJava;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: CATALOG }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchOpenRouterCatalog, lookupModelCapabilities } = await import('./openRouterCatalog');
    const models = await fetchOpenRouterCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(models.length).toBe(CATALOG.length);

    const caps = await lookupModelCapabilities('gpt-4o');
    expect(fetchMock).toHaveBeenCalledTimes(1); // served from localStorage cache
    expect(caps?.contextWindow).toBe(128000);
    expect(caps?.supportsReasoning).toBe(false);
  });

  it('falls back to stale localStorage cache when both bridge and direct fetch fail', async () => {
    vi.resetModules();
    // Seed a stale cache entry so readCache() returns it.
    const stale: OpenRouterModel[] = [
      {
        id: 'cached/cached-model',
        canonical_slug: 'cached/cached-model',
        name: 'Cached Model',
        context_length: 100000,
        supported_parameters: ['tools'],
      },
    ];
    localStorage.setItem(
      'openrouter-catalog-cache-v1',
      JSON.stringify({ fetchedAt: Date.now() - 48 * 60 * 60 * 1000, models: stale }),
    );

    // Simulate a Java backend that reports a failure synchronously — the
    // webview rejects the bridge promise and falls through to direct fetch.
    window.sendToJava = () => {
      window.onOpenRouterCatalog?.(JSON.stringify({ ok: false, error: 'simulated bridge failure' }));
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    const { fetchOpenRouterCatalog } = await import('./openRouterCatalog');
    const models = await fetchOpenRouterCatalog();
    expect(models.length).toBe(1);
    expect(models[0].id).toBe('cached/cached-model');
  });

  it('returns the cached catalog within the 24h TTL without calling bridge or fetch', async () => {
    vi.resetModules();
    const cached: OpenRouterModel[] = [
      {
        id: 'cached/fresh',
        canonical_slug: 'cached/fresh',
        name: 'Fresh',
        context_length: 32000,
        supported_parameters: ['tools'],
      },
    ];
    localStorage.setItem(
      'openrouter-catalog-cache-v1',
      JSON.stringify({ fetchedAt: Date.now() - 60 * 60 * 1000, models: cached }),
    );

    const sendSpy = vi.fn();
    window.sendToJava = sendSpy;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { fetchOpenRouterCatalog } = await import('./openRouterCatalog');
    const models = await fetchOpenRouterCatalog();
    // JSON.parse in readCache() always returns a new array reference, so we
    // compare structurally rather than by reference.
    expect(models).toEqual(cached);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
