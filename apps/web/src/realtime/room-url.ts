/** 部屋の WebSocket の入口。回答者用（play）とホスト用（host）は分かれている（ADR 0003・0004） */
export type RoomEntry = 'play' | 'host';

/**
 * 部屋の WebSocket の URL を、開いているページと同じオリジンで作る（ADR 0006）。
 * ページのクエリやハッシュは持ち込まない。再接続用の秘密は URL に入れず、最初のメッセージで送る（ADR 0004）
 */
export function roomSocketUrl(roomId: string, entry: RoomEntry, page: Pick<URL, 'protocol' | 'host'>): string {
  const protocol = page.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${page.host}/api/rooms/${roomId}/ws/${entry}`;
}
