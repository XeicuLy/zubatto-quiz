import { createRootRouteWithContext, HeadContent, Outlet } from '@tanstack/react-router';

import { APP_NAME } from '../lib/page-title';
import type { RouterContext } from '../router';

export const Route = createRootRouteWithContext<RouterContext>()({
  // 子のルートが head でタイトルを付ければ、そちらが勝つ。付けない画面（トップ・知らない URL）はこれを出す
  head: () => ({ meta: [{ title: APP_NAME }] }),
  component: RootLayout,
});

/**
 * HeadContent は <title> を React の要素として描き、React 19 がそれを <head> へ移す。
 * index.html の <title> より前に入るので、document.title はルートのタイトルになる。index.html の方は JS が動く前の代わり
 */
function RootLayout() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  );
}
