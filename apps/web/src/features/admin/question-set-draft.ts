import {
  DEFAULT_LIMIT_MS,
  MAX_CHOICES,
  MAX_LIMIT_MS,
  MAX_QUESTIONS,
  MIN_CHOICES,
  MIN_LIMIT_MS,
  questionSetSchema,
  type QuestionSet,
  type QuestionSetDetail,
} from '@zubatto-quiz/protocol';

/**
 * 問題セットの編集画面（F4・F7・F9）の下書き。保存する形（QuestionSetInput）とは別に持つ。
 * - 正解をまだ選んでいない問題を表すため、correctIndex は null を許す
 * - 制限時間は入力欄の文字列のまま秒で持つ。空や小数も入れられ、確かめるときにミリ秒へ直す
 *
 * 検査の規則は持たない。保存の前に protocol の questionSetSchema に通し、サーバー（T15）と同じ規則で確かめる
 */
export interface QuestionDraft {
  /** React の key。並べ替えても入力欄の状態がほかの問題へずれないようにする。保存はしない */
  key: string;
  text: string;
  choices: string[];
  correctIndex: number | null;
  limitSeconds: string;
}

export interface QuestionSetDraft {
  title: string;
  questions: QuestionDraft[];
}

let nextKey = 0;

/** 問題の key を作る。reducer の外で呼び、reducer を純粋なままにする */
export function newQuestionKey(): string {
  nextKey += 1;
  return `question-${nextKey}`;
}

export function draftOf(detail: QuestionSetDetail): QuestionSetDraft {
  return {
    title: detail.title,
    questions: detail.questions.map((question) => ({
      key: newQuestionKey(),
      text: question.text,
      choices: [...question.choices],
      correctIndex: question.correctIndex,
      limitSeconds: String(question.limitMs / 1000),
    })),
  };
}

/** 足したばかりの問題。正解は、ホストが選ぶまで決めない */
export function newQuestion(key: string): QuestionDraft {
  return {
    key,
    text: '',
    choices: Array.from({ length: MIN_CHOICES }, () => ''),
    correctIndex: null,
    limitSeconds: String(DEFAULT_LIMIT_MS / 1000),
  };
}

export type EditorAction =
  | { type: 'setTitle'; title: string }
  | { type: 'setText'; index: number; text: string }
  | { type: 'setChoice'; index: number; choiceIndex: number; text: string }
  | { type: 'addChoice'; index: number }
  | { type: 'removeChoice'; index: number; choiceIndex: number }
  | { type: 'setCorrect'; index: number; choiceIndex: number }
  | { type: 'setLimit'; index: number; limitSeconds: string }
  | { type: 'addQuestion'; key: string }
  | { type: 'removeQuestion'; index: number }
  | { type: 'moveQuestion'; index: number; offset: -1 | 1 };

/**
 * 下書きを1操作ぶん進める。数の上限と下限（選択肢は2〜4個、問題は1〜100問）を外れる操作は、
 * 同じ state を返して何もしない。画面のボタンも押せなくするが、ここでも守る
 */
export function editorReducer(state: QuestionSetDraft, action: EditorAction): QuestionSetDraft {
  switch (action.type) {
    case 'setTitle':
      return { ...state, title: action.title };
    case 'setText':
      return updateQuestion(state, action.index, (question) => ({ ...question, text: action.text }));
    case 'setChoice':
      return updateQuestion(state, action.index, (question) => ({
        ...question,
        choices: question.choices.map((choice, i) => (i === action.choiceIndex ? action.text : choice)),
      }));
    case 'addChoice':
      return updateQuestion(state, action.index, (question) =>
        question.choices.length >= MAX_CHOICES ? question : { ...question, choices: [...question.choices, ''] },
      );
    case 'removeChoice':
      return updateQuestion(state, action.index, (question) =>
        question.choices.length <= MIN_CHOICES
          ? question
          : {
              ...question,
              choices: question.choices.filter((_, i) => i !== action.choiceIndex),
              correctIndex: correctIndexAfterRemoving(question.correctIndex, action.choiceIndex),
            },
      );
    case 'setCorrect':
      return updateQuestion(state, action.index, (question) => ({ ...question, correctIndex: action.choiceIndex }));
    case 'setLimit':
      return updateQuestion(state, action.index, (question) => ({ ...question, limitSeconds: action.limitSeconds }));
    case 'addQuestion':
      return state.questions.length >= MAX_QUESTIONS
        ? state
        : { ...state, questions: [...state.questions, newQuestion(action.key)] };
    case 'removeQuestion':
      return state.questions.length <= 1
        ? state
        : { ...state, questions: state.questions.filter((_, i) => i !== action.index) };
    case 'moveQuestion': {
      const to = action.index + action.offset;
      if (to < 0 || to >= state.questions.length) {
        return state;
      }
      const questions = [...state.questions];
      [questions[action.index], questions[to]] = [questions[to]!, questions[action.index]!];
      return { ...state, questions };
    }
  }
}

/** index 番目の問題だけを置き換える。何も変えなければ同じ state を返す */
function updateQuestion(
  state: QuestionSetDraft,
  index: number,
  update: (question: QuestionDraft) => QuestionDraft,
): QuestionSetDraft {
  const current = state.questions[index];
  if (current === undefined) {
    return state;
  }
  const next = update(current);
  return next === current
    ? state
    : { ...state, questions: state.questions.map((question, i) => (i === index ? next : question)) };
}

/**
 * removed 番目（0始まり）の選択肢を消したあとの、正解の番号。
 * 正解だった選択肢が残るなら、消したあとも同じ選択肢を正解にしておく
 */
export function correctIndexAfterRemoving(correctIndex: number | null, removed: number): number | null {
  if (correctIndex === null) {
    return null;
  }
  // 正解だった選択肢を消したので、正解はまだ選ばれていない状態に戻す
  if (correctIndex === removed) {
    return null;
  }
  // 消したのが正解より前なので、正解の選択肢が1つ前へ詰まる
  if (correctIndex > removed) {
    return correctIndex - 1;
  }
  // 消したのが正解より後ろなので、正解の番号は変わらない
  return correctIndex;
}

/** 場所（'questions.1.correctIndex' のような zod の path をつないだもの）ごとの、画面に出す誤り */
export type DraftErrors = Record<string, string>;

export type DraftValidation = { ok: true; input: QuestionSet } | { ok: false; errors: DraftErrors };

/**
 * 下書きを protocol の questionSetSchema で確かめる。通れば、前後の空白を除いた保存する値を返す。
 * 通らなければ、場所ごとに最初の誤りを1つだけ、日本語にして返す
 */
export function validateDraft(draft: QuestionSetDraft): DraftValidation {
  const result = questionSetSchema.safeParse({
    title: draft.title,
    questions: draft.questions.map((question) => ({
      text: question.text,
      choices: question.choices,
      correctIndex: question.correctIndex,
      // 空の欄は0秒になり、5秒より短いとして断られる
      limitMs: Number(question.limitSeconds) * 1000,
    })),
  });
  if (result.success) {
    return { ok: true, input: result.data };
  }
  const errors: DraftErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    errors[key] ??= messageOf(issue.path, issue.code);
  }
  return { ok: false, errors };
}

/** 場所の最後の名前と、長すぎる（too_big）かで文言を選ぶ。それ以外の誤り（空・型）は「入れてください」にする */
function messageOf(path: PropertyKey[], code: string): string {
  const field = path.at(-1);
  const tooLong = code === 'too_big';
  if (path.length === 1 && field === 'title') {
    return tooLong ? '問題セットの名前は100文字までです' : '問題セットの名前を入れてください';
  }
  if (path.length === 1) {
    return `問題は1〜${MAX_QUESTIONS}問にしてください`;
  }
  if (field === 'text') {
    return tooLong ? '問題文は1,000文字までです' : '問題文を入れてください';
  }
  if (field === 'choices') {
    return `選択肢は${MIN_CHOICES}〜${MAX_CHOICES}個にしてください`;
  }
  if (path.at(-2) === 'choices') {
    return tooLong ? '選択肢は100文字までです' : '選択肢を入れてください';
  }
  if (field === 'correctIndex') {
    return '正解を1つ選んでください';
  }
  return `制限時間は${MIN_LIMIT_MS / 1000}〜${MAX_LIMIT_MS / 1000}秒の整数で入れてください`;
}

/** 保存の帯に出す、直すところの一覧。誤りがなければ null */
export function errorSummaryOf(errors: DraftErrors): string | null {
  const keys = Object.keys(errors);
  if (keys.length === 0) {
    return null;
  }
  const questionNumbers = [...new Set(keys.flatMap((key) => /^questions\.(\d+)\./.exec(key)?.[1] ?? []).map(Number))];
  questionNumbers.sort((a, b) => a - b);
  const places = [
    ...(keys.includes('title') ? ['問題セットの名前'] : []),
    ...questionNumbers.map((index) => `第${index + 1}問`),
  ];
  return `${places.join('・')}に直すところがあります`;
}
