import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Host } from '@zubatto-quiz/protocol';
import { useRef } from 'react';

import { hostsQueryOptions, removeHost } from '@/api/hosts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import { ActionError } from '@/shared/feedback/ActionError';
import { describeApiError } from '@/shared/feedback/api-error';
import { notify } from '@/shared/feedback/notify';

/** 足した日。管理者は日本にいるので、端末の時刻の設定によらず日本の時刻で出す。年をまたいで残るので、年も出す */
const addedDate = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'long', timeZone: 'Asia/Tokyo' });

/**
 * 許可リストの1行。見出しは名前のメモ（足したときの GitHub の名前）で、コマンドで足してメモがなければ「メモなし」。
 * GitHub の名前は変えられるので、どの行にも GitHub ID を添えて見分けられるようにする。
 * 管理者の行には印を出し、外すボタンは出さない（API も 409 admin_host で断る）
 */
export function HostRow({ host }: { host: Host }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm<'remove'>();
  const removeButton = useRef<HTMLButtonElement>(null);
  const remove = useMutation({
    mutationFn: () => removeHost(host.githubUserId),
    // 行ごと消えるので、行の中では知らせられない。画面の隅に出す
    onSuccess: () =>
      notify(
        host.note === null
          ? `GitHub ID ${host.githubUserId} の人をホストから外しました`
          : `「${host.note}」をホストから外しました`,
      ),
    onSettled: async (_, error) => {
      // 外せたときと、別のタブで先に外していた（404）ときだけ読み直し、一覧から消す（404 は知らせない）。
      // ほかの失敗では読み直さない。401 で読み直すと一覧ごと誤りに替わり、この行の誤りが消える
      if (error === null || describeApiError(error) === 'notFound') {
        await queryClient.invalidateQueries({ queryKey: hostsQueryOptions.queryKey });
      }
    },
  });

  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* メモがないことは、名前と見分けられるよう薄い色で出す */}
          <h2
            className={
              host.note === null
                ? 'text-heading font-bold text-muted-foreground'
                : 'text-heading font-bold wrap-anywhere'
            }
          >
            {host.note ?? 'メモなし'}
          </h2>
          {host.isAdmin && (
            <span className="rounded-chip border-2 border-foreground px-2 text-note font-bold">管理者</span>
          )}
        </div>
        <p className="mt-1 text-note text-muted-foreground">
          GitHub ID {host.githubUserId} / {addedDate.format(new Date(host.createdAt))}に追加
        </p>
      </div>
      {host.isAdmin ? null : confirm.confirming === 'remove' ? (
        // 外すと何が起きるか（ログインが切れる）と、何が残るか（問題セット）を添える
        <ConfirmDialog
          title="本当に外しますか？"
          detail="その人のログインも切れます。作った問題セットは残り、追加し直せばまた使えます。"
          confirmLabel="本当に外す"
          onConfirm={() => remove.mutate()}
          onCancel={confirm.close}
          size="sm"
          pending={remove.isPending}
          className="w-full"
        />
      ) : (
        <Button
          ref={removeButton}
          variant="link"
          size="sm"
          onClick={() => confirm.open('remove', removeButton)}
          className="text-destructive"
        >
          外す
        </Button>
      )}
      {remove.isError && describeApiError(remove.error) !== 'notFound' && (
        <ActionError error={remove.error} failed="外せませんでした。もう一度押してください。" className="w-full" />
      )}
    </li>
  );
}
