import { createFileRoute } from '@tanstack/react-router';

// 回答者の入室・待機・回答（T26・T27）
export const Route = createFileRoute('/r/$roomId')({
  component: PlayerPage,
});

function PlayerPage() {
  return (
    <main className="min-h-dvh bg-stage px-6 py-16 text-on-stage">
      <h1 className="text-xl font-bold">クイズに参加</h1>
    </main>
  );
}
