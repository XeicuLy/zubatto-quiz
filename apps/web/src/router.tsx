import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';

import { ErrorScreen } from './components/error-screen';
import { NotFoundScreen } from './components/not-found-screen';
import { routeTree } from './routeTree.gen';

export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * 画面の router を作る。テストでは history に createMemoryHistory を渡して、開く経路を決める。
 * ルートの loader からも TanStack Query を使えるよう、QueryClient を router の context に入れる。
 */
export function createAppRouter({ history }: { history?: RouterHistory } = {}) {
  const queryClient = new QueryClient();

  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    // 既定の画面は英語なので、日本語の画面に替える（SC3）
    defaultNotFoundComponent: NotFoundScreen,
    defaultErrorComponent: ErrorScreen,
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
