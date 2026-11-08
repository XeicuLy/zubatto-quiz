import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import preview from '../.storybook/preview';
import { storyFiles } from './story-files';

/**
 * ストーリーの煙テスト。src のすべてのストーリーを、Storybook と同じ設定（preview のデコレータと globals）で jsdom に1回ずつ描く。
 * 見た目や振る舞いは確かめない。部品のテストと E2E に任せ、ここでは描けなくなったストーリーと面の取り違えだけを見つける。
 * 読むファイルの一覧が、いま src にあるものとそろうことは story-files.test.ts が確かめる
 */
const annotations = setProjectAnnotations(preview);
beforeAll(annotations.beforeAll);

const files = await Promise.all(Object.entries(storyFiles).map(async ([path, load]) => ({ path, file: await load() })));

const stories = files.flatMap(({ path, file }) =>
  Object.entries(composeStories(file)).map(([name, Story]) => ({ path: path.replace('../src/', ''), name, Story })),
);

describe('ストーリー', () => {
  it('src にストーリーがある（glob が1つも当たらないまま通らない）', () => {
    expect(stories.length).toBeGreaterThan(0);
  });

  // 描くときに投げた例外は、run が reject して落ちる
  it.for(stories)('$path の $name を、globals の面（surface）で描ける', async ({ Story }) => {
    const canvasElement = document.body.appendChild(document.createElement('div'));
    onTestFinished(() => canvasElement.remove());

    await Story.run({ canvasElement });

    // デコレータの箱。中が空なら、ストーリーが何も描いていない
    const surface = canvasElement.firstElementChild;
    expect(surface).not.toBeEmptyDOMElement();
    // 暗い面は .stage の箱で包む。明るい面は包まない（:root の値のまま）
    expect(surface?.classList.contains('stage')).toBe(Story.globals.surface === 'stage');
  });
});
