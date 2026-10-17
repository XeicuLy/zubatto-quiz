import { MAX_CHOICES, MAX_QUESTIONS, type QuestionSetDetail } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import {
  correctIndexAfterRemoving,
  draftOf,
  editorReducer,
  errorSummaryOf,
  newQuestion,
  validateDraft,
  type DraftErrors,
  type QuestionDraft,
  type QuestionSetDraft,
} from './question-set-draft';

const DETAIL: QuestionSetDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '2026 内輪クイズ',
  questions: [
    { text: '部長の十八番は？', choices: ['演歌', 'アニソン', '洋楽ロック'], correctIndex: 1, limitMs: 10_000 },
    { text: 'ポトス太郎は夏を越せた？', choices: ['越せた', '枯れた'], correctIndex: 0, limitMs: 5_000 },
  ],
};

function question(overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return { key: 'q', text: '問題文', choices: ['A', 'B'], correctIndex: 0, limitSeconds: '10', ...overrides };
}

function draftWith(...questions: QuestionDraft[]): QuestionSetDraft {
  return { title: '内輪クイズ', questions };
}

describe('draftOf', () => {
  it('保存した問題セットを、制限時間を秒にして下書きにする', () => {
    const draft = draftOf(DETAIL);

    expect(draft.title).toBe(DETAIL.title);
    expect(draft.questions).toEqual([
      {
        key: expect.any(String),
        text: '部長の十八番は？',
        choices: ['演歌', 'アニソン', '洋楽ロック'],
        correctIndex: 1,
        limitSeconds: '10',
      },
      {
        key: expect.any(String),
        text: 'ポトス太郎は夏を越せた？',
        choices: ['越せた', '枯れた'],
        correctIndex: 0,
        limitSeconds: '5',
      },
    ]);
  });

  it('問題ごとに別の key を付ける', () => {
    const keys = draftOf(DETAIL).questions.map((q) => q.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('newQuestion', () => {
  it('2択・正解なし・制限時間10秒（F9 の初期値）で始まる', () => {
    expect(newQuestion('k1')).toEqual({
      key: 'k1',
      text: '',
      choices: ['', ''],
      correctIndex: null,
      limitSeconds: '10',
    });
  });
});

describe('editorReducer', () => {
  it('選択肢を足すと、空の選択肢が末尾に入る', () => {
    const next = editorReducer(draftWith(question()), { type: 'addChoice', index: 0 });

    expect(next.questions[0]!.choices).toEqual(['A', 'B', '']);
  });

  it(`選択肢が${MAX_CHOICES}つあれば、もう足さない（F4）`, () => {
    const state = draftWith(question({ choices: ['A', 'B', 'C', 'D'] }));

    expect(editorReducer(state, { type: 'addChoice', index: 0 })).toBe(state);
  });

  it('選択肢が2つなら、もう消さない（F4）', () => {
    const state = draftWith(question({ choices: ['A', 'B'] }));

    expect(editorReducer(state, { type: 'removeChoice', index: 0, choiceIndex: 1 })).toBe(state);
  });

  it('正解より前の選択肢を消すと、正解の番号も1つ前へずれ、同じ選択肢が正解のまま残る', () => {
    const state = draftWith(question({ choices: ['A', 'B', 'C'], correctIndex: 2 }));

    const next = editorReducer(state, { type: 'removeChoice', index: 0, choiceIndex: 0 });

    expect(next.questions[0]).toMatchObject({ choices: ['B', 'C'], correctIndex: 1 });
  });

  it('正解の選択肢を消すと、正解は選ばれていない状態に戻る', () => {
    const state = draftWith(question({ choices: ['A', 'B', 'C'], correctIndex: 1 }));

    const next = editorReducer(state, { type: 'removeChoice', index: 0, choiceIndex: 1 });

    expect(next.questions[0]).toMatchObject({ choices: ['A', 'C'], correctIndex: null });
  });

  it('問題を足すと、渡した key の新しい問題が末尾に入る', () => {
    const next = editorReducer(draftWith(question({ key: 'a' })), { type: 'addQuestion', key: 'b' });

    expect(next.questions.map((q) => q.key)).toEqual(['a', 'b']);
    expect(next.questions[1]).toEqual(newQuestion('b'));
  });

  it(`問題が${MAX_QUESTIONS}問あれば、もう足さない`, () => {
    const state = draftWith(...Array.from({ length: MAX_QUESTIONS }, (_, i) => question({ key: `q${i}` })));

    expect(editorReducer(state, { type: 'addQuestion', key: 'extra' })).toBe(state);
  });

  it('問題を消す。ただし最後の1問は消さない（問題セットは1問以上）', () => {
    const two = draftWith(question({ key: 'a' }), question({ key: 'b' }));

    const one = editorReducer(two, { type: 'removeQuestion', index: 0 });

    expect(one.questions.map((q) => q.key)).toEqual(['b']);
    expect(editorReducer(one, { type: 'removeQuestion', index: 0 })).toBe(one);
  });

  it.each([
    { index: 1, offset: -1, expected: ['b', 'a', 'c'] },
    { index: 1, offset: 1, expected: ['a', 'c', 'b'] },
  ] as const)('$index 番目を $offset 動かすと $expected の順になる', ({ index, offset, expected }) => {
    const state = draftWith(question({ key: 'a' }), question({ key: 'b' }), question({ key: 'c' }));

    const next = editorReducer(state, { type: 'moveQuestion', index, offset });

    expect(next.questions.map((q) => q.key)).toEqual(expected);
  });

  it.each([
    { index: 0, offset: -1 },
    { index: 2, offset: 1 },
  ] as const)('端の問題（$index 番目）は、外へ $offset 動かさない', ({ index, offset }) => {
    const state = draftWith(question({ key: 'a' }), question({ key: 'b' }), question({ key: 'c' }));

    expect(editorReducer(state, { type: 'moveQuestion', index, offset })).toBe(state);
  });

  it('入力した値を、その問題にだけ入れる', () => {
    let state = draftWith(question({ key: 'a' }), question({ key: 'b' }));

    state = editorReducer(state, { type: 'setTitle', title: '新しい名前' });
    state = editorReducer(state, { type: 'setText', index: 1, text: '変えた問題文' });
    state = editorReducer(state, { type: 'setChoice', index: 1, choiceIndex: 0, text: '変えた選択肢' });
    state = editorReducer(state, { type: 'setCorrect', index: 1, choiceIndex: 1 });
    state = editorReducer(state, { type: 'setLimit', index: 1, limitSeconds: '30' });

    expect(state.title).toBe('新しい名前');
    expect(state.questions[0]).toEqual(question({ key: 'a' }));
    expect(state.questions[1]).toEqual({
      key: 'b',
      text: '変えた問題文',
      choices: ['変えた選択肢', 'B'],
      correctIndex: 1,
      limitSeconds: '30',
    });
  });
});

describe('correctIndexAfterRemoving', () => {
  it.each([
    // 消したのが正解より後ろなら、正解の番号は変わらない
    { correctIndex: 0, removed: 2, expected: 0 },
    // 正解を消したら、正解は選ばれていない状態に戻る
    { correctIndex: 1, removed: 1, expected: null },
    // まだ正解を選んでいなければ、そのまま
    { correctIndex: null, removed: 0, expected: null },
    // 消したのが正解より前なら、正解の番号が1つ前へずれる
    { correctIndex: 2, removed: 0, expected: 1 },
    // 境目: 正解のすぐ前を消しても、ずれる
    { correctIndex: 2, removed: 1, expected: 1 },
    // 境目: 正解のすぐ後ろを消しても、ずれない
    { correctIndex: 1, removed: 2, expected: 1 },
  ])('正解が $correctIndex で $removed を消すと $expected', ({ correctIndex, removed, expected }) => {
    expect(correctIndexAfterRemoving(correctIndex, removed)).toBe(expected);
  });
});

describe('validateDraft（F4・F9）', () => {
  it('通れば、前後の空白を除き、制限時間をミリ秒にした保存する値を返す', () => {
    const result = validateDraft(
      draftWith(question({ text: '  問題文  ', choices: [' A ', 'B'], correctIndex: 1, limitSeconds: '15' })),
    );

    expect(result).toEqual({
      ok: true,
      input: {
        title: '内輪クイズ',
        questions: [{ text: '問題文', choices: ['A', 'B'], correctIndex: 1, limitMs: 15_000 }],
      },
    });
  });

  it.each([
    {
      name: '問題セットの名前が空',
      draft: { title: '  ', questions: [question()] },
      key: 'title',
      message: '問題セットの名前を入れてください',
    },
    {
      name: '問題セットの名前が長い',
      draft: { title: 'あ'.repeat(101), questions: [question()] },
      key: 'title',
      message: '問題セットの名前は100文字までです',
    },
    {
      name: '問題文が空',
      draft: draftWith(question({ text: '' })),
      key: 'questions.0.text',
      message: '問題文を入れてください',
    },
    {
      name: '問題文が長い',
      draft: draftWith(question({ text: 'あ'.repeat(1001) })),
      key: 'questions.0.text',
      message: '問題文は1,000文字までです',
    },
    {
      name: '選択肢が空',
      draft: draftWith(question({ choices: ['A', ' '] })),
      key: 'questions.0.choices.1',
      message: '選択肢を入れてください',
    },
    {
      name: '選択肢が長い',
      draft: draftWith(question({ choices: ['あ'.repeat(101), 'B'] })),
      key: 'questions.0.choices.0',
      message: '選択肢は100文字までです',
    },
    {
      name: '正解を選んでいない',
      draft: draftWith(question({ correctIndex: null })),
      key: 'questions.0.correctIndex',
      message: '正解を1つ選んでください',
    },
    ...['4', '61', '7.5', ''].map((limitSeconds) => ({
      name: `制限時間が「${limitSeconds}」`,
      draft: draftWith(question({ limitSeconds })),
      key: 'questions.0.limitMs',
      message: '制限時間は5〜60秒の整数で入れてください',
    })),
  ])('$name なら、その場所に「$message」を出す', ({ draft, key, message }) => {
    const result = validateDraft(draft);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual({ [key]: message });
  });

  it.each(['5', '60'])('制限時間の境目（%s秒）は通る', (limitSeconds) => {
    expect(validateDraft(draftWith(question({ limitSeconds }))).ok).toBe(true);
  });

  it('1つの場所に誤りが2つあっても、出すのは1つ', () => {
    const result = validateDraft(draftWith(question({ limitSeconds: '4.5' })));

    expect(!result.ok && result.errors).toEqual({ 'questions.0.limitMs': '制限時間は5〜60秒の整数で入れてください' });
  });
});

describe('errorSummaryOf', () => {
  it.each<{ errors: DraftErrors; expected: string | null }>([
    { errors: {}, expected: null },
    { errors: { 'questions.1.correctIndex': 'x' }, expected: '第2問に直すところがあります' },
    {
      errors: { title: 'x', 'questions.4.text': 'x', 'questions.1.correctIndex': 'x', 'questions.1.text': 'x' },
      expected: '問題セットの名前・第2問・第5問に直すところがあります',
    },
  ])('$expected', ({ errors, expected }) => {
    expect(errorSummaryOf(errors)).toBe(expected);
  });
});
