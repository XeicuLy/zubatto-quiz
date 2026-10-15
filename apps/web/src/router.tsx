import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';

import { ErrorScreen } from './components/error-screen';
import { NotFoundScreen } from './components/not-found-screen';
import type { RoomSocket } from './realtime/client';
import { routeTree } from './routeTree.gen';

export interface RouterContext {
  queryClient: QueryClient;
  /** 部屋の WebSocket を開く。省くと本物の WebSocket を使う。テストでは偽のサーバー（test/fake-room-server.ts）を渡す */
  createRoomSocket?: (url: string) => RoomSocket;
}

interface AppRouterOptions {
  history?: RouterHistory;
  createRoomSocket?: (url: string) => RoomSocket;
}

/**
 * 画面の router を作る。テストでは history に createMemoryHistory を渡して、開く経路を決める。
 * ルートの loader からも TanStack Query を使えるよう、QueryClient を router の context に入れる。
 */
export function createAppRouter({ history, createRoomSocket }: AppRouterOptions = {}) {
  const queryClient = new QueryClient();

  return createRouter({
    routeTree,
    history,
    context: { queryClient, createRoomSocket },
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
