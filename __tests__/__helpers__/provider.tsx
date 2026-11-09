// StoreVersionProvider のテスト用。hook を呼ぶだけのコンポーネント（Probe）を Provider の配下に置き、描画のたびの戻り値を記録する
// （判定の状態は hook の戻り値で見る。デフォルト UI の見え方は __tests__/react/Default*.test.tsx / StoreVersionModal.test.tsx）
import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import type { StoreVersionError } from '../../src/errors.ts';
import {
  type StoreVersionCheckResult,
  StoreVersionProvider,
  type StoreVersionProviderProps,
} from '../../src/react/StoreVersionProvider.tsx';
import {
  type UseStoreVersionResult,
  useStoreVersion,
} from '../../src/react/useStoreVersion.ts';

/** hook を呼んで、描画のたびの戻り値を `into` に足すコンポーネント */
export const StateProbe = ({ into }: { into: UseStoreVersionResult[] }) => {
  into.push(useStoreVersion());
  return null;
};

/** {@link createProbe} の戻り値 */
export type Probe = {
  /** Provider の配下に置く要素（{@link StateProbe}） */
  element: ReactElement;
  /** 描画のたびの hook の戻り値 */
  readonly history: UseStoreVersionResult[];
  /** 最後に描画したときの hook の戻り値 */
  readonly current: UseStoreVersionResult;
  /** 描画で見えた status の移り変わり（同じ status の連続はまとめる） */
  statuses(): UseStoreVersionResult['status'][];
};

export const createProbe = (): Probe => {
  const history: UseStoreVersionResult[] = [];
  return {
    element: <StateProbe into={history} />,
    history,
    get current() {
      const last = history[history.length - 1];
      if (!last) {
        throw new Error('the probe has not been rendered');
      }
      return last;
    },
    statuses() {
      const list: UseStoreVersionResult['status'][] = [];
      for (const { status } of history) {
        if (list[list.length - 1] !== status) {
          list.push(status);
        }
      }
      return list;
    },
  };
};

/** `onError` のモック */
export const createOnError = () => jest.fn<void, [StoreVersionError]>();

/** `onResult` のモック */
export const createOnResult = () => jest.fn<void, [StoreVersionCheckResult]>();

/** `onError` に渡された code を順に並べる */
export const codesOf = (onError: jest.Mock<void, [StoreVersionError]>) =>
  onError.mock.calls.map(([error]) => error.code);

/** Provider の配下に Probe（と children）を置いて描画する。`rerender` は props だけを差し替える */
export const renderProvider = async (
  props: StoreVersionProviderProps,
  probe: Probe,
  children?: ReactNode
) => {
  const tree = (next: StoreVersionProviderProps) => (
    <StoreVersionProvider {...next}>
      {probe.element}
      {children}
    </StoreVersionProvider>
  );
  const result = await render(tree(props));
  return {
    ...result,
    rerender: (next: StoreVersionProviderProps) => result.rerender(tree(next)),
  };
};
