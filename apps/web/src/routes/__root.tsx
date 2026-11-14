import { createRootRouteWithContext, HeadContent, Outlet } from '@tanstack/react-router';

import { Announcer } from '@/components/a11y/Announcer';
import { Toaster } from '@/components/ui/toast';
import { APP_NAME } from '@/lib/page-title';
import type { RouterContext } from '@/router';

export const Route = createRootRouteWithContext<RouterContext>()({
  // 子のルートが head でタイトルを付ければ、そちらが勝つ。付けない画面（トップ・知らない URL）はこれを出す
  head: () => ({ meta: [{ title: APP_NAME }] }),
  component: RootLayout,
});

/**
 * HeadContent は <title> を React の要素として描き、React 19 がそれを <head> へ移す。
 * index.html の <title> より前に入るので、document.title はルートのタイトルになる。index.html の方は JS が動く前の代わり。
 * 読み上げ領域（Announcer）と toast（Toaster）はどの画面にも1つずつ置く。画面が替わっても作り直さないよう、経路の外側に置く。
 * 保存して一覧へ移るときも、出した toast は移った先に残る
 */
function RootLayout() {
  return (
    <>
      <HeadContent />
      <Outlet />
      <Announcer />
      <Toaster />
    </>
  );
}
