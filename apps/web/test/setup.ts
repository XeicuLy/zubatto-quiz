import '@testing-library/jest-dom/vitest';
import { act, cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { clearAnnouncements } from '@/components/a11y/announce';
import { toastManager } from '@/components/ui/toast';

// globals を使わないので、Testing Library は描いたものを自動では片付けない。
// toast の manager はモジュールに1つなので、片付ける前に全部閉じ、消えるまでの timer を次のテストに残さない
afterEach(() => {
  act(() => {
    toastManager.close();
  });
  cleanup();
});

// 読み上げの文は画面の外の store にあるので、次のテストに持ち越さない
afterEach(() => {
  clearAnnouncements();
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
