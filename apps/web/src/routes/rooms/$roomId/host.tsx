import { createFileRoute } from '@tanstack/react-router';

// ホストの待機と進行（T31・T32）
export const Route = createFileRoute('/rooms/$roomId/host')({
  component: HostPage,
});

function HostPage() {
  return (
    <main className="min-h-dvh bg-stage p-stage text-on-stage">
      <h1 className="text-stage-title font-bold">進行画面</h1>
    </main>
  );
}
