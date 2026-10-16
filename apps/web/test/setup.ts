import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// globals を使わないので、Testing Library は描いたものを自動では片付けない
afterEach(() => {
  cleanup();
});

// jsdom は window.scrollTo を持たない。TanStack Router が画面を移るたびに呼ぶので、何もしない関数にする。
// 先頭で @vitest-environment node にしたテストには window がない
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}

// stubFakeApi（test/fake-api.ts）が差し替えた fetch を戻す
afterEach(() => {
  vi.unstubAllGlobals();
});
