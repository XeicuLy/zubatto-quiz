import { Hono } from 'hono';

// wrangler は main の export から DO のクラスを探す
export { RoomDurableObject } from './room/room-do';

// API と WebSocket の経路は、すべて /api/ の下に置く（ADR 0006）
const app = new Hono<{ Bindings: Env }>().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));

export default app;
