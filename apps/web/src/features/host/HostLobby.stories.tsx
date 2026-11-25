import type { Meta, StoryObj } from '@storybook/react-vite';
import { MAX_PARTICIPANTS, NAME_MAX_LENGTH, type Participants } from '@zubatto-quiz/protocol';

import { HostLobby } from './HostLobby';

const id = (n: number) => `6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e${String(n).padStart(2, '0')}`;

/** 部屋の ID は推測できない64桁なので（S3）、参加用の URL は長い */
const joinUrl = `https://zubakui.example/r/${'9e57c391'.repeat(8)}`;

/** ふだんの名前に、上限の32文字の名前を1割まぜる。上限の名前は、チップの幅で省略される */
const names = Array.from({ length: MAX_PARTICIPANTS }, (_, i) => {
  if (i % 10 === 9) {
    return `${'ながいなまえ'.repeat(6)}${String(i).padStart(2, '0')}`.slice(-NAME_MAX_LENGTH);
  }
  const base = ['たろう', 'はなこ', '部長', '経理のたなか', 'さとう', 'Christopher', '🎍みかん🎍', 'すずき', 'やまだ'];
  return `${base[i % 10]}${Math.floor(i / 10) + 1}`;
});

const participants = (count: number): Participants['participants'] =>
  names.slice(0, count).map((name, i) => ({ participantId: id(i), name }));

/**
 * ホストの待機画面（F1・F3）。投影する画面で、やることは QR を読むことだけなので、QR を主役にし、URL は下に小さく出す。
 * 進行の帯（HostControls）は進行画面が下に足すので、ここにはない。1画面に収まるかは、帯まで含めて e2e/host-lobby-fit.spec.ts で測る
 */
const meta = {
  component: HostLobby,
  args: {
    room: { title: '歓迎会のクイズ', questionCount: 10, phase: 'lobby', questionIndex: null },
    participants: participants(3),
    joinUrl,
  },
  globals: { surface: 'stage', viewport: { value: 'projector', isRotated: false } },
} satisfies Meta<typeof HostLobby>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 3人が入ったところ */
export const Projector: Story = {};

/** まだだれも入っていない */
export const Empty: Story = {
  args: { participants: [] },
};

/** 上限の50人。31人からは幅のそろった格子に並べ、名前の長さにかかわらず一覧の行の数を抑える */
export const Full: Story = {
  args: { participants: participants(MAX_PARTICIPANTS) },
};

/** ホストのスマホで開いたとき。QR・URL・参加者を縦に積む */
export const Mobile: Story = {
  globals: { viewport: { value: 'mobile', isRotated: false } },
};
