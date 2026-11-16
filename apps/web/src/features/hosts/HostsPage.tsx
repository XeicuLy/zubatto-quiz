import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';

import { hostsQueryOptions } from '@/api/hosts';
import { LoadErrorCard } from '@/shared/feedback/LoadErrorCard';

import { AddHostForm } from './AddHostForm';
import { HostRow } from './HostRow';

/**
 * ホストの管理（ADR 0013）。許可リストの一覧、GitHub のユーザー名での追加、外す操作を並べる。
 * 管理者の付け外しと、管理者のホストを外すことは、ここではできない（runbook のコマンドだけ）
 */
export function HostsPage() {
  const hosts = useQuery(hostsQueryOptions);
  // 外した行が消えたときのフォーカスの行き先。tabIndex={-1} で Tab の順番には入れず、スクリプトからだけ受ける
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <h1 ref={heading} tabIndex={-1} className="text-title font-bold focus-target">
        ホストの管理
      </h1>
      <p className="mt-3 text-note text-muted-foreground">
        ここにいる人だけが、GitHub でログインして問題セットを作り、部屋を開けます。
      </p>

      <AddHostForm />

      {hosts.isPending ? (
        <p className="mt-8 text-muted-foreground">読み込んでいます…</p>
      ) : hosts.isError ? (
        <LoadErrorCard
          error={hosts.error}
          failed="ホストの一覧を読めませんでした"
          retry={() => void hosts.refetch()}
          titleAs="p"
          className="mt-8"
        />
      ) : (
        <ul aria-label="ホスト" className="mt-8 divide-y divide-border rounded-panel border border-border bg-card">
          {hosts.data.map((host) => (
            <HostRow key={host.githubUserId} host={host} onRemoved={() => heading.current?.focus()} />
          ))}
        </ul>
      )}
    </main>
  );
}
