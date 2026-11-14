import type { ChangelogConfig } from 'changelogen';

/**
 * リリースノートと CHANGELOG の文面の設定（ADR 0012）。tools/release が changelogen の loadChangelogConfig で読む。
 *
 * - 版は tools/release の plan が決めるので、types に semver は書かない
 * - 書かない feat・fix・perf・refactor・docs は、changelogen の既定の見出しのまま出す
 * - 既定の表にない revert は足す。既定の表の types・examples は commitlint が許さないので外す
 * - chore・ci・test・build・style は出さない（CHANGELOG の PR も Dependabot の PR も載らない）
 * - 作者の節（Contributors）は出さない。作者は tools/release が消してから渡す（ungh.cc へ問い合わせないため）
 */
export default {
  repo: 'XeicuLy/zubatto-quiz',
  noAuthors: true,
  types: {
    revert: { title: '⏪ Reverts' },
    chore: false,
    ci: false,
    test: false,
    build: false,
    style: false,
    types: false,
    examples: false,
  },
} satisfies Partial<ChangelogConfig>;
