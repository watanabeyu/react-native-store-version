// react-native の AccessibilityInfo のモック。@react-native/jest-preset が jest.fn() の集まりに差し替えている
// （isReduceMotionEnabled は Promise<false>、addEventListener は何もしない subscription を返す）ので、「視差効果を減らす」の値と
// その変化を起こせる実装に入れ替える。jest.fn() は restoreMocks では元に戻らないので、linking.ts と同じく毎回 mockReset する
import { AccessibilityInfo } from 'react-native';

type Listener = (enabled: boolean) => void;

/** {@link mockReduceMotion} が返す操作 */
export type ReduceMotionMock = {
  /** 設定の変化（`reduceMotionChanged`）を起こす（React の更新を伴うので act の中で呼ぶ） */
  change: (enabled: boolean) => void;
  /** 登録されている listener の数（外し忘れの確認用） */
  readonly listenerCount: number;
};

/** `AccessibilityInfo.isReduceMotionEnabled()` の値と `reduceMotionChanged` の購読を差し替える */
export const mockReduceMotion = (initial = false): ReduceMotionMock => {
  let enabled = initial;
  const listeners = new Set<Listener>();
  const isEnabled =
    AccessibilityInfo.isReduceMotionEnabled as jest.MockedFunction<
      typeof AccessibilityInfo.isReduceMotionEnabled
    >;
  isEnabled.mockReset();
  isEnabled.mockImplementation(async () => enabled);
  const addEventListener =
    AccessibilityInfo.addEventListener as jest.MockedFunction<
      typeof AccessibilityInfo.addEventListener
    >;
  addEventListener.mockReset();
  addEventListener.mockImplementation((type, listener) => {
    const registered = listener as Listener;
    if (type === 'reduceMotionChanged') {
      listeners.add(registered);
    }
    return {
      remove: () => {
        listeners.delete(registered);
      },
    } as ReturnType<typeof AccessibilityInfo.addEventListener>;
  });
  return {
    change: (next) => {
      enabled = next;
      for (const listener of [...listeners]) {
        listener(next);
      }
    },
    get listenerCount() {
      return listeners.size;
    },
  };
};
