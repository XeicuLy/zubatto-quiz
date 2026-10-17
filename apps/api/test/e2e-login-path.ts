/**
 * E2E 用のログインの経路（ADR 0003）。テスト専用の入口（e2e-entry.ts）だけが持ち、本番の入口（src/index.ts）にはない。
 * 本番のバンドルにこの文字列がないことを、test/bundle/production-bundle.test.ts で確かめる
 */
export const E2E_LOGIN_PATH = '/api/e2e/login';
