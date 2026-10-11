import { Hono } from 'hono';

import { createAuth } from './auth/create-auth';
import { questionSetRoutes } from './routes/question-sets';
import { roomRoutes } from './routes/rooms';

// wrangler は main の export から DO のクラスを探す
export { RoomDurableObject } from './room/room-do';

// API と WebSocket の経路は、すべて /api/ の下に置く（ADR 0006）
const app = new Hono<{ Bindings: Env }>().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));

// GitHub のログイン・コールバック・ログアウト・セッションの取得（ADR 0003）。Origin の確認は Better Auth 自身が baseURL で行う
app.on(['GET', 'POST'], '/auth/*', (c) => createAuth(c.env).handler(c.req.raw));

app.route('/question-sets', questionSetRoutes);
app.route('/rooms', roomRoutes);

export default app;
