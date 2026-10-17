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

/**
 * 回答者に共有する参加用の URL（F1・F2）。画面と API は同じオリジンなので（ADR 0006）、
 * POST /api/rooms が返す joinUrl と同じ値になる。進行画面を読み込み直しても、部屋の ID から作り直せる
 */
export function roomJoinUrl(roomId: string, page: Pick<URL, 'origin'>): string {
  return `${page.origin}/r/${roomId}`;
}
