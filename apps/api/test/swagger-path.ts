/**
 * Swagger UI の経路（ADR 0011）。テスト専用の入口（e2e-entry.ts）だけが持ち、本番の入口（src/index.ts）にはない。
 * Swagger UI は外部の CDN のスクリプトを読むので、回答者の secret がある本番のオリジンでは動かさない。
 * 本番のバンドルにこの文字列がないことを、test/bundle/production-bundle.test.ts で確かめる
 */
export const SWAGGER_UI_PATH = '/api/docs';
