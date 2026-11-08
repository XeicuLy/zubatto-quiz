/// <reference types="vite/client" />
import type { Meta, StoryObj } from '@storybook/react-vite';

/** stories のファイルの形（CSF 3）。default が meta で、ほかの名前付きの export がストーリー */
export type StoriesFile = { default: Meta; [name: string]: StoryObj | Meta };

/**
 * src のすべてのストーリーのファイル（キーは '../src/…' の相対パス）。煙テスト（stories.test.tsx）が描き、
 * story-files.test.ts がディスクの一覧とそろうことを確かめる。node のテストからも読むので、eager にせず、キーだけでは部品を import しない。
 * glob には型引数を付けず、型は as で付ける。vitest 5 の fsModuleCache は、glob のすぐあとに丸かっこが続く文字のあるファイルだけをキャッシュから外す。
 * 型引数を付けるとその文字にならず、変換した結果（そのときのファイルの一覧）が残って、足したストーリーを煙テストが描かない（vitest 5.0.5 で確かめた、2026-11-08）。
 * このコメントには、その文字を書かない。書くとコメントがキャッシュを外し、型引数を付けても story-files.test.ts が落ちなくなる
 */
export const storyFiles = import.meta.glob('../src/**/*.stories.tsx') as Record<string, () => Promise<StoriesFile>>;
