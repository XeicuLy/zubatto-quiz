// @vitest-environment node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { apiWorker } from '../api-worker.ts';

const API_CONFIG_PATH = '../api/wrangler.jsonc';
const DEV_ENTRY = fileURLToPath(new URL('../../api/test/dev-entry.ts', import.meta.url));

describe('Vite が作る API の Worker（auxiliaryWorkers）', () => {
  it('vite dev では、Swagger UI を足した開発の入口で動かす', () => {
    const worker = apiWorker({ command: 'serve', isPreview: false });

    expect(worker).toEqual({ configPath: API_CONFIG_PATH, config: { main: DEV_ENTRY } });
    expect(existsSync(DEV_ENTRY)).toBe(true);
  });

  // ビルドの API の Worker はデプロイには使わない（本番は apps/api の wrangler deploy --env="" で作る）が、
  // 本番と同じ入口にそろえ、開発の入口が dist に出ないようにする
  it('vite build では、wrangler.jsonc の main（本番の入口）のまま', () => {
    expect(apiWorker({ command: 'build', isPreview: false })).toEqual({ configPath: API_CONFIG_PATH });
  });

  // e2e:serve の vite preview は、ビルドした Worker（env.e2e の入口）を動かす
  it('vite preview では入口を替えない', () => {
    expect(apiWorker({ command: 'serve', isPreview: true })).toEqual({ configPath: API_CONFIG_PATH });
  });
});
