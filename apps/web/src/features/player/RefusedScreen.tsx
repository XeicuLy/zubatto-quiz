import { useAnnouncement } from '@/components/a11y/announce';
import { MessageScreen } from '@/shared/status/MessageScreen';

import { TopLink } from './TopLink';

/**
 * 部屋に入れなかったときの画面（満員・部屋がない・入る前に終わっていた）。入れ直しても通らないので、入口へのリンクを置く。
 * 「参加する」を押したあとに画面が替わるので、見出しと本文を急ぎで読み上げる。
 * 画面には role="status" を付けない。箱と中身が同時に現れると読まれないので、__root の Announcer に文を渡す
 */
export function RefusedScreen({ title, body }: { title: string; body: string }) {
  useAnnouncement(`${title}。${body}`, 'assertive');
  return (
    <MessageScreen variant="mobile" title={title} body={body}>
      <TopLink />
    </MessageScreen>
  );
}
