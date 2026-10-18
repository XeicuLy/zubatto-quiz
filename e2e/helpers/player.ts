import { expect, type Page, type WebSocketRoute } from '@playwright/test';

/** 回答者のスマホの大きさ（docs/design/README.md） */
export const PHONE = { width: 390, height: 844 };

/** 回答者の WebSocket の経路（/api/rooms/:roomId/ws/play） */
const PLAY_SOCKET = /\/api\/rooms\/[0-9a-f]{64}\/ws\/play$/;

/** 名前の入力に名前を入れ、「参加する」を押す（F2）。通ったかどうかは呼んだ側が確かめる */
export async function submitName(player: Page, name: string) {
  await player.getByLabel('名前').fill(name);
  await player.getByRole('button', { name: '参加する' }).click();
}

/** 自分の名前の待機画面が出ていることを確かめる（F3） */
export async function expectWaiting(player: Page, name: string) {
  await expect(player.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(player.getByText('ホストが始めるのを待っています')).toBeVisible();
}

/** 参加用の URL を開き、名前を入れて入る（F2） */
export async function joinRoom(player: Page, joinUrl: string, name: string) {
  await player.goto(joinUrl);
  await submitName(player, name);
  await expectWaiting(player, name);
}

/** その画面が開いた WebSocket を数える。返した関数を呼ぶと、そこまでの数を返す */
export function countWebSockets(page: Page): () => number {
  let count = 0;
  page.on('websocket', () => {
    count += 1;
  });
  return () => count;
}

/**
 * 回答者の WebSocket を間に挟み、本物の部屋の DO につなぐ。cut でサーバーの側から切り、restore までつなぎ直しを通さない。
 * 通さないあいだは新しい接続をすぐ閉じるので、画面は「再接続中」のまま残る。
 * そのまま通すと、最初のつなぎ直しは 250〜500ms で済み、表示を確かめる前に消えることがある
 */
export async function relayPlayerSocket(page: Page) {
  let servers: WebSocketRoute[] = [];
  let blocked = false;
  await page.routeWebSocket(PLAY_SOCKET, (socket) => {
    if (blocked) {
      // 1011 はアプリの code ではないので、画面はつなぎ直しを続ける
      socket.close({ code: 1011 });
      return;
    }
    servers.push(socket.connectToServer());
  });
  return {
    /** 部屋の DO の側から閉じる。閉じたことは、間に挟んだ画面の側へも伝わる */
    cut() {
      blocked = true;
      for (const server of servers) {
        server.close();
      }
      servers = [];
    },
    restore() {
      blocked = false;
    },
  };
}
