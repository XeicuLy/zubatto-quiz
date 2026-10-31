import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';

import { ApiError, createRoom, questionSetsQueryOptions } from '../admin/api';

/**
 * 問題セットの一覧の行の「部屋を作る」（F1）。作ったら、その部屋の進行画面へ移る。
 * 一覧の行の、ボタンを並べた箱（flex-wrap）の中に置く。失敗の知らせは order-last と w-full で、ボタンの下に回す
 */
export function CreateRoomButton({ questionSetId }: { questionSetId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => createRoom(questionSetId),
    onSuccess: ({ roomId }) => navigate({ to: '/rooms/$roomId/host', params: { roomId } }),
    onError: async (error) => {
      // 別のタブで消した（404）なら、一覧を読み直して行を消す。消すときの 404 と同じ扱い
      if (error instanceof ApiError && error.status === 404) {
        await queryClient.invalidateQueries({ queryKey: questionSetsQueryOptions.queryKey });
      }
    },
  });
  const status = create.error instanceof ApiError ? create.error.status : null;

  return (
    <>
      <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
        部屋を作る
      </Button>
      {create.isError && status !== 404 && (
        <p role="alert" className="order-last w-full text-sm font-bold text-alert-strong">
          {status === 401 ? (
            <>
              ログインが切れました。
              <Link to="/login" className="underline">
                ログインし直す
              </Link>
            </>
          ) : (
            '部屋を作れませんでした。もう一度押してください。'
          )}
        </p>
      )}
    </>
  );
}
