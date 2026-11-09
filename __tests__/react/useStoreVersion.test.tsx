// useStoreVersion（3a）: Context から読むだけ。Provider の外のエラー、複数箇所で呼んでも fetch が 1 回、戻り値の形、
// Provider が Context に置く表示の設定（texts / icon / components / primaryColor / ui。描画は 3b）
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useContext } from 'react';
import { Text } from 'react-native';

import { StoreVersionProvider } from '../../src/react/StoreVersionProvider.tsx';
import {
  type StoreVersionDisplay,
  StoreVersionDisplayContext,
  type StoreVersionForceProps,
  type StoreVersionWarningProps,
  type UseStoreVersionResult,
  useStoreVersion,
} from '../../src/react/useStoreVersion.ts';
import { mockAppState } from '../__helpers__/appState.ts';
import {
  mockFetchFixture,
  mockFetchPending,
  readFixture,
} from '../__helpers__/fetch.ts';
import { setPlatform } from '../__helpers__/platform.ts';
import { createOnError, StateProbe } from '../__helpers__/provider.tsx';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('../__helpers__/platform').platformModule
);

const props = {
  version: '1.282.0',
  bundleId: 'com.github.stormbreaker.prod',
  country: 'jp',
};

const DisplayProbe = ({ into }: { into: (StoreVersionDisplay | null)[] }) => {
  into.push(useContext(StoreVersionDisplayContext));
  return null;
};

const Force = (_: StoreVersionForceProps) => null;
const Warning = (_: StoreVersionWarningProps) => null;

beforeEach(() => {
  setPlatform('ios');
  mockAppState();
});

describe('useStoreVersion', () => {
  it('throws a message that tells to wrap with StoreVersionProvider outside the Provider', async () => {
    // React は描画中のエラーを console.error に出すので、このテストでは黙らせる
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(renderHook(() => useStoreVersion())).rejects.toThrow(
      new Error(
        'useStoreVersion() must be called inside <StoreVersionProvider>. Wrap your app (or the component tree that calls it) with <StoreVersionProvider> from react-native-store-version.'
      )
    );
  });

  it('fetches once however many components call the hook', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    const first: UseStoreVersionResult[] = [];
    const second: UseStoreVersionResult[] = [];
    const third: UseStoreVersionResult[] = [];
    await render(
      <StoreVersionProvider {...props} onError={createOnError()}>
        <StateProbe into={first} />
        <Text>screen</Text>
        <StateProbe into={second} />
        <StateProbe into={third} />
      </StoreVersionProvider>
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const last = (list: UseStoreVersionResult[]) => list[list.length - 1];
    expect(last(first).status).toBe('ready');
    // 判定結果は Provider が 1 つだけ持つ（同じオブジェクトを読む）
    expect(last(second)).toBe(last(first));
    expect(last(third)).toBe(last(first));
  });

  it('returns exactly the values of 4.2', async () => {
    mockFetchPending();
    const seen: UseStoreVersionResult[] = [];
    await render(
      <StoreVersionProvider
        {...props}
        bundleId="com.example.hook.keys"
        onError={createOnError()}
      >
        <StateProbe into={seen} />
      </StoreVersionProvider>
    );
    expect(Object.keys(seen[seen.length - 1]).sort()).toEqual([
      'action',
      'detail',
      'diff',
      'dismiss',
      'dismissed',
      'error',
      'local',
      'openStore',
      'recheck',
      'releaseNotes',
      'remote',
      'result',
      'status',
      'storeUrl',
    ]);
  });

  it('keeps openStore / dismiss / recheck stable across renders', async () => {
    const { calls } = mockFetchPending();
    const seen: UseStoreVersionResult[] = [];
    await render(
      <StoreVersionProvider
        {...props}
        bundleId="com.example.hook.stable"
        onError={createOnError()}
      >
        <StateProbe into={seen} />
      </StoreVersionProvider>
    );
    await act(async () => {
      calls[0].respond({ body: readFixture('store/itunes-lookup.json') });
    });
    await waitFor(() => expect(seen[seen.length - 1].status).toBe('ready'));
    const first = seen[0];
    const last = seen[seen.length - 1];
    expect(last).not.toBe(first);
    expect(last.openStore).toBe(first.openStore);
    expect(last.dismiss).toBe(first.dismiss);
    expect(last.recheck).toBe(first.recheck);
  });
});

describe('StoreVersionProvider: display settings in the Context (rendered in 3b)', () => {
  it('puts texts / icon / components / primaryColor / ui as given, and renders only the children', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    const seen: (StoreVersionDisplay | null)[] = [];
    const texts = { force: { title: '更新してください' } };
    const icon = { uri: 'https://example.com/icon.png' };
    const components = { Force, Warning };
    await render(
      <StoreVersionProvider
        {...props}
        policy="force"
        texts={texts}
        icon={icon}
        components={components}
        primaryColor="#E11D48"
        ui={false}
        onError={createOnError()}
      >
        <DisplayProbe into={seen} />
        <Text>child</Text>
      </StoreVersionProvider>
    );
    expect(seen[seen.length - 1]).toEqual({
      ui: false,
      texts,
      icon,
      components,
      primaryColor: '#E11D48',
    });
    expect(seen[seen.length - 1]?.texts).toBe(texts);
    expect(screen.toJSON()).toEqual(
      expect.objectContaining({ type: 'Text', children: ['child'] })
    );
  });

  it('defaults ui to true and leaves the others undefined', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    const seen: (StoreVersionDisplay | null)[] = [];
    await render(
      <StoreVersionProvider {...props} onError={createOnError()}>
        <DisplayProbe into={seen} />
      </StoreVersionProvider>
    );
    expect(seen[seen.length - 1]).toStrictEqual({
      ui: true,
      texts: undefined,
      icon: undefined,
      components: undefined,
      primaryColor: undefined,
    });
  });

  it('does not re-render the components that call the hook when only the display settings change', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    const states: UseStoreVersionResult[] = [];
    const displays: (StoreVersionDisplay | null)[] = [];
    // 同じ要素を渡し続けるので、配下は Context が変わったときだけ描画し直す
    const children = (
      <>
        <StateProbe into={states} />
        <DisplayProbe into={displays} />
      </>
    );
    const tree = (title: string) => (
      <StoreVersionProvider
        {...props}
        // インラインの texts は描画のたびに別のオブジェクトになる。primaryColor も描画ごとに変える
        texts={{ force: { title } }}
        primaryColor={title === 'b' ? '#16A34A' : '#E11D48'}
        onError={createOnError()}
      >
        {children}
      </StoreVersionProvider>
    );
    const view = await render(tree('a'));
    await waitFor(() => expect(states[states.length - 1].status).toBe('ready'));
    const rendered = states.length;
    await view.rerender(tree('b'));
    await view.rerender(tree('c'));
    expect(states).toHaveLength(rendered);
    expect(displays[displays.length - 1]?.texts).toEqual({
      force: { title: 'c' },
    });
  });

  it('reflects texts changed after mount without checking again', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    const seen: (StoreVersionDisplay | null)[] = [];
    const tree = (title: string) => (
      <StoreVersionProvider
        {...props}
        texts={{ warning: { title } }}
        onError={createOnError()}
      >
        <DisplayProbe into={seen} />
      </StoreVersionProvider>
    );
    const view = await render(tree('a'));
    await view.rerender(tree('b'));
    expect(seen[seen.length - 1]?.texts).toEqual({ warning: { title: 'b' } });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
