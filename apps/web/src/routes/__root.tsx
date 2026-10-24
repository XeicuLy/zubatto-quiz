import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import { Announcer } from '../components/a11y/Announcer';
import type { RouterContext } from '../router';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

/** どの画面にも読み上げ領域を1つずつ置く。画面が替わっても作り直さないよう、経路の外側に置く */
function RootLayout() {
  return (
    <>
      <Outlet />
      <Announcer />
    </>
  );
}
