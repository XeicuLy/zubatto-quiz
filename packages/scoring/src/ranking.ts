/** 順位を付ける相手。score には、問題ごとのランキングならその問題の点を、累計のランキングなら合計点を入れる */
export type Competitor = {
  participantId: string;
  /** 入室した順。同じ順位の人を並べるときに使う（小さいほど先） */
  joinOrder: number;
  score: number;
};

export type RankedCompetitor = Competitor & { rank: number };

const byJoinOrder = (a: { joinOrder: number }, b: { joinOrder: number }): number => a.joinOrder - b.joinOrder;

/**
 * 点の高い順に並べて順位を付ける（F15）。
 * 同点は同じ順位にし（1位・2位・2位・4位）、回答時間や正解数では比べない。同じ順位の人は入室した順に並べる
 */
export const rankByScore = (competitors: readonly Competitor[]): RankedCompetitor[] => {
  const sorted = [...competitors].sort((a, b) => b.score - a.score || byJoinOrder(a, b));
  const ranked: RankedCompetitor[] = [];
  for (const [index, competitor] of sorted.entries()) {
    const previous = ranked.at(-1);
    // 前の人と同点なら同じ順位。違えば、自分より点の高い人の数 + 1（＝並べた位置 + 1）
    const rank = previous !== undefined && previous.score === competitor.score ? previous.rank : index + 1;
    ranked.push({ ...competitor, rank });
  }
  return ranked;
};

/** 1問ぶんの回答。未回答の人は入れない */
export type QuestionAnswer = {
  participantId: string;
  joinOrder: number;
  correct: boolean;
  /** normalizeElapsedMs で0.01秒単位に切り捨てた経過時間 */
  elapsedMs: number;
};

export type FastAnswer = { participantId: string; elapsedMs: number };

/** 最速正解者として出す人数（F14） */
const FASTEST_COUNT = 3;

/**
 * 最速で正解した人を速い順に3人まで求め、正解した人数も数える（F14）。
 * 全員が不正解なら fastest は空。経過時間が同じ人は入室した順に並べる
 */
export const findFastest = (answers: readonly QuestionAnswer[]): { fastest: FastAnswer[]; correctCount: number } => {
  const correct = answers.filter((answer) => answer.correct);
  const fastest = [...correct]
    .sort((a, b) => a.elapsedMs - b.elapsedMs || byJoinOrder(a, b))
    .slice(0, FASTEST_COUNT)
    .map(({ participantId, elapsedMs }) => ({ participantId, elapsedMs }));
  return { fastest, correctCount: correct.length };
};

/**
 * 前の問題までのランキングと比べて、この問題で順位をいくつ上げたかを回答者ごとに求める。
 * 下がった人と変わらない人、前のランキングにいない人（途中で入った人）は0（順位の見せ方: 矢印は上がったときだけ）
 */
export const rankUps = (
  previous: readonly RankedCompetitor[],
  current: readonly RankedCompetitor[],
): Map<string, number> => {
  const previousRanks = new Map(previous.map(({ participantId, rank }) => [participantId, rank]));
  return new Map(
    current.map(({ participantId, rank }) => {
      const previousRank = previousRanks.get(participantId);
      return [participantId, previousRank === undefined ? 0 : Math.max(previousRank - rank, 0)];
    }),
  );
};

export type Climber = { participantId: string; rankUp: number };

/**
 * この問題で一番順位を上げた人を求める（F14）。
 * 第1問（previous が空）や、誰も順位を上げなかったときは null。
 * 上げた幅が同じ人が複数いるときは、今の順位が上の人。順位も同じなら入室した順で先の人
 */
export const findBiggestClimber = (
  previous: readonly RankedCompetitor[],
  current: readonly RankedCompetitor[],
): Climber | null => {
  // 第1問は previous が空なので、全員の幅が0になり、誰も選ばれない
  const rankUpById = rankUps(previous, current);
  let biggest: Climber | null = null;
  // current は「今の順位が上 → 入室した順」に並んでいるので、同じ幅なら先に見た人を残す（> で比べ、>= にしない）
  for (const { participantId } of current) {
    const rankUp = rankUpById.get(participantId) ?? 0;
    // まだ誰もいないときは0と比べるので、1以上上げた人だけが入る
    if (rankUp > (biggest?.rankUp ?? 0)) {
      biggest = { participantId, rankUp };
    }
  }
  return biggest;
};

/**
 * 回答者画面に出す自分の位置（F15）。形は packages/protocol の playerPosition に合わせ、rankUp は rankUps で別に求める。
 * - leader: 1位。自分以外で一番点の高い人との差。1位が同点なら0、ほかに回答者がいなければ null
 * - podium: 2位・3位。順位と、1つ上の人との差
 * - chasing: 4位以下。順位の数字は持たず、1つ上の人との差とトップとの差
 * 「1つ上の人」は、自分より点の高い人のうち一番点の低い人（同点の人とは比べない）
 */
export type PlayerPosition =
  | { kind: 'leader'; leadOverNext: number | null }
  | { kind: 'podium'; rank: 2 | 3; gapToAbove: number }
  | { kind: 'chasing'; gapToAbove: number; gapToTop: number };

/** ranking には rankByScore の結果（点の高い順）を渡す */
export const positionOf = (ranking: readonly RankedCompetitor[], participantId: string): PlayerPosition => {
  const self = ranking.find((competitor) => competitor.participantId === participantId);
  if (self === undefined) throw new Error(`ランキングにいない回答者: ${participantId}`);

  const { rank, score } = self;
  if (rank === 1) {
    // ranking は点の高い順なので、自分以外の先頭が、自分以外で一番点の高い人
    const runnerUp = ranking.find((competitor) => competitor.participantId !== participantId);
    return { kind: 'leader', leadOverNext: runnerUp === undefined ? null : score - runnerUp.score };
  }

  // rank は「自分より点の高い人の数 + 1」なので、rank - 2 番目が、自分より点の高い人のうち一番点の低い人
  const gapToAbove = ranking[rank - 2].score - score;
  if (rank === 2 || rank === 3) return { kind: 'podium', rank, gapToAbove };
  return { kind: 'chasing', gapToAbove, gapToTop: ranking[0].score - score };
};
