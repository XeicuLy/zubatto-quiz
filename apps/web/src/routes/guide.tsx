import { createFileRoute } from '@tanstack/react-router';

import { GuidePage } from '@/features/guide/GuidePage';
import { pageTitle } from '@/lib/page-title';

/** 使い方（#285）。ログインせずに開ける。API を読まないので、loader も beforeLoad も持たない */
export const Route = createFileRoute('/guide')({
  head: () => pageTitle('使い方'),
  component: GuideRoute,
});

function GuideRoute() {
  return (
    <div className="min-h-dvh bg-background font-sans text-foreground antialiased">
      <GuidePage />
    </div>
  );
}
