import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: TopPage,
});

function TopPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="font-display text-4xl">ズバクイ</h1>
    </main>
  );
}
