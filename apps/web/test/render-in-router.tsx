import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';

/** <Link> を含む部品を、根のルートだけの router の中で描く。部品のテストで、画面の経路を用意しないため */
export async function renderInRouter(ui: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory(),
  });
  const result = render(<RouterProvider router={router} />);
  await act(() => router.load());
  return result;
}
