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
  /** `initial` が 'pending' のとき、保留にした `isReduceMotionEnabled()` を解決 / 拒否する（Error を渡すと拒否） */
  settle: (value: boolean | Error) => void;
  /** `isReduceMotionEnabled()` が呼ばれた回数（購読していないことの確認用） */
  readonly queryCount: number;
};

/**
 * `AccessibilityInfo.isReduceMotionEnabled()` の値と `reduceMotionChanged` の購読を差し替える。
 * `initial`: boolean は即 resolve、'reject' は reject（取得できない環境）、'pending' は `settle()` まで保留
 */
export const mockReduceMotion = (
  initial: boolean | 'reject' | 'pending' = false
): ReduceMotionMock => {
  let enabled = initial === true;
  const listeners = new Set<Listener>();
  const pending: {
    resolve: (value: boolean) => void;
    reject: (error: Error) => void;
  }[] = [];
  const isEnabled =
    AccessibilityInfo.isReduceMotionEnabled as jest.MockedFunction<
      typeof AccessibilityInfo.isReduceMotionEnabled
    >;
  isEnabled.mockReset();
  let queryCount = 0;
  isEnabled.mockImplementation(() => {
    queryCount += 1;
    if (initial === 'reject') {
      return Promise.reject(new Error('AccessibilityInfo unavailable'));
    }
    if (initial === 'pending') {
      return new Promise<boolean>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    }
    return Promise.resolve(enabled);
  });
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
    get queryCount() {
      return queryCount;
    },
    settle: (value) => {
      for (const p of pending.splice(0)) {
        if (value instanceof Error) {
          p.reject(value);
        } else {
          p.resolve(value);
        }
      }
    },
  };
};
