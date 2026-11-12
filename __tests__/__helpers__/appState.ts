// react-native の AppState のモック。@react-native/jest-preset は AppState を jest.fn() の集まりに差し替えていて
// （addEventListener は何もしない subscription を返し、currentState も jest.fn()）、状態を変えられないので、
// ここで listener を覚える実装を入れる（src も同じオブジェクトを import する）。jest.fn() は restoreMocks では元に戻らないので、
// linking.ts と同じく毎回 mockReset してから実装を入れる（前のテストの listener が残らないようにする）。
// react-native の AppState は使うたびに require し直される（index.js の getter）ので、jest.resetModules（__helpers__/modules.ts の
// setOptionalModules）の後は別のモックになる。AppState を使うテストで setOptionalModules を呼ぶなら、その後にこれを呼ぶ
import { AppState, type AppStateStatus } from 'react-native';

type Listener = (state: AppStateStatus) => void;

/** {@link mockAppState} が返す操作 */
export type AppStateMock = {
  /** `AppState.currentState` を変え、`change` の listener を呼ぶ（React の更新を伴うので act の中で呼ぶ） */
  change: (state: AppStateStatus) => void;
  /** 登録されている `change` の listener の数（外し忘れの確認用） */
  readonly listenerCount: number;
};

/** `AppState` を差し替える。`initial` は `AppState.currentState` の初期値（既定 `active`） */
export const mockAppState = (
  initial: AppStateStatus = 'active'
): AppStateMock => {
  const listeners = new Set<Listener>();
  const addEventListener = AppState.addEventListener as jest.MockedFunction<
    typeof AppState.addEventListener
  >;
  addEventListener.mockReset();
  addEventListener.mockImplementation((type, listener) => {
    const registered = listener as Listener;
    if (type === 'change') {
      listeners.add(registered);
    }
    return {
      remove: () => {
        listeners.delete(registered);
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
  const state = AppState as { currentState: AppStateStatus };
  state.currentState = initial;
  return {
    change: (next) => {
      state.currentState = next;
      for (const listener of [...listeners]) {
        listener(next);
      }
    },
    get listenerCount() {
      return listeners.size;
    },
  };
};
