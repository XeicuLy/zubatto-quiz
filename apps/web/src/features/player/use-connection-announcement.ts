import { useState } from 'react';

import { useAnnouncement } from '../../components/a11y/announce';
import type { ConnectionStatus } from '../../realtime/client';

interface ConnectionAnnouncement {
  connection: ConnectionStatus;
  /** つなぎ直しているあいだに読む文 */
  reconnecting: string;
  /** つなぎ直さずに閉じたときに出す知らせ。出さないなら null */
  closed: { title: string; body: string } | null;
}

/**
 * 接続の変化を読み上げる（A1）。回答者の ConnectionNotice とホストの HostConnectionNotice が使う。
 * - つなぎ直している / つなぎ直せた: polite。最初につながったときは、画面が替わるので言わない
 * - 閉じた（部屋が終わった・別のタブで開いた など）: assertive。続けて遊べないので、読み上げ中の文より先に伝える
 */
export function useConnectionAnnouncement({ connection, reconnecting, closed }: ConnectionAnnouncement) {
  // 一度でも切れたか。描画の中で合わせるので、StrictMode の2回の描画でも同じ値になる
  const [dropped, setDropped] = useState(false);
  if (connection === 'reconnecting' && !dropped) {
    setDropped(true);
  }

  useAnnouncement(politeMessageOf(connection, dropped, reconnecting));
  useAnnouncement(closed === null ? null : `${closed.title}。${closed.body}`, 'assertive');
}

function politeMessageOf(connection: ConnectionStatus, dropped: boolean, reconnecting: string): string | null {
  if (connection === 'reconnecting') {
    return reconnecting;
  }
  return connection === 'open' && dropped ? 'つながりました' : null;
}
