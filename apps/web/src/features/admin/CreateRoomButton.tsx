import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { questionSetsQueryOptions } from '@/api/question-sets';
import { createRoom } from '@/api/rooms';
import { Button } from '@/components/ui/button';
import { ActionError } from '@/shared/feedback/ActionError';
import { describeApiError } from '@/shared/feedback/api-error';

/**
 * 問題セットの一覧の行の「部屋を作る」（F1）。作ったら、その部屋の進行画面へ移る（応答を待つあいだに一覧を離れていたら移らない）。
 * 一覧の行の、ボタンを並べた箱（flex-wrap）の中に置く。失敗の知らせは order-last と w-full で、ボタンの下に回す
 */
export function CreateRoomButton({ questionSetId }: { questionSetId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => createRoom(questionSetId),
    // 一覧を読み直すのは、部品が消えたあとでもしてよいので、ここ（部品が消えても呼ばれる側）に書く
    onError: async (error) => {
      // 別のタブで消した（404）なら、一覧を読み直して行を消す。消すときの 404 と同じ扱い
      if (describeApiError(error) === 'notFound') {
        await queryClient.invalidateQueries({ queryKey: questionSetsQueryOptions.queryKey });
      }
    },
  });

  /**
   * 進行画面へ移るのは mutate に渡した onSuccess で行う。こちらは部品が消えると呼ばれない（TanStack Query の Mutation Side Effects）。
   * 応答を待つあいだに一覧を離れたら、できた部屋へは移さず、知らせもしない（#328）。自分で離れたのに連れ戻さないため。
   * 部屋の ID は推測できず誰にも届かないので、使われないまま残っても害はない
   */
  function createAndEnter() {
    create.mutate(undefined, {
      onSuccess: ({ roomId }) => navigate({ to: '/rooms/$roomId/host', params: { roomId } }),
    });
  }

  return (
    <>
      <Button size="sm" onClick={createAndEnter} disabled={create.isPending}>
        部屋を作る
      </Button>
      {create.isError && describeApiError(create.error) !== 'notFound' && (
        <ActionError
          error={create.error}
          failed="部屋を作れませんでした。もう一度押してください。"
          className="order-last w-full"
        />
      )}
    </>
  );
}
