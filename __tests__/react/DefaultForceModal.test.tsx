// Force のデフォルト UI（3b）: 出す条件、Force のモックの実測値（色・寸法・余白・影・文字）、戻るボタン無効、ボタンで openStore、
// texts（補完・置き換え・表示中の変更・ja・remote 不明）、icon、ダークモード、a11y、components.Force の差し替え、ui={false}、
// 7 章の表の UI の列（再チェックの失敗で消えない、iOS の URL 取得の失敗でも出る）
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import type { VersionGetter } from '../../src/fetchers/custom.ts';
import * as modalModule from '../../src/react/StoreVersionModal.tsx';
import type { StoreVersionProviderProps } from '../../src/react/StoreVersionProvider.tsx';
import type { StoreVersionForceProps } from '../../src/react/useStoreVersion.ts';
import ja from '../../src/texts/ja.ts';
import {
  mockReduceMotion,
  type ReduceMotionMock,
} from '../__helpers__/accessibilityInfo.ts';
import { mockAppState } from '../__helpers__/appState.ts';
import {
  mockFetchFixture,
  mockFetchPending,
  mockFetchReject,
} from '../__helpers__/fetch.ts';
import { mockOpenURL } from '../__helpers__/linking.ts';
import { setPlatform } from '../__helpers__/platform.ts';
import {
  codesOf,
  createOnError,
  createProbe,
  type Probe,
  renderProvider,
} from '../__helpers__/provider.tsx';
import {
  getCard,
  getDialogContainer,
  getImage,
  getModal,
  getOverlay,
  getScrollView,
  hostChildren,
  mockColorScheme,
  mockTiming,
  pressIn,
  pressOut,
  queryAllImages,
  queryBackdrop,
  queryModal,
} from '../__helpers__/ui.tsx';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('../__helpers__/platform').platformModule
);

const trackViewUrl = 'https://apps.apple.com/jp/app/github/id1477376905?uo=4';
const TITLE = 'Update required';
const MESSAGE =
  'A new version (1.283.0) is available. Please update to continue using the app.';

// fixture の iOS は 1.283.0。local 1.282.0 に policy: 'force' で action が force になる
const force = (
  overrides: Partial<StoreVersionProviderProps> = {}
): StoreVersionProviderProps => ({
  version: '1.282.0',
  bundleId: 'com.github.stormbreaker.prod',
  country: 'jp',
  policy: 'force',
  onError: createOnError(),
  ...overrides,
});

// components の差し替え（Biome の noNestedComponentDefinitions のためモジュール直下に置く）。受け取った props を記録する
const seenForceProps: StoreVersionForceProps[] = [];
const CustomForce = (props: StoreVersionForceProps) => {
  seenForceProps.push(props);
  return (
    <Text onPress={() => void props.openStore()}>
      custom force {props.remote}
    </Text>
  );
};
// もう一方の差し替えだけが渡されたときに影響しないことの確認用
const NullWarning = () => null;

let probe: Probe;
let reduceMotion: ReduceMotionMock;

beforeEach(() => {
  setPlatform('ios');
  mockAppState();
  mockColorScheme('light');
  reduceMotion = mockReduceMotion(false);
  probe = createProbe();
  seenForceProps.length = 0;
});

const renderForce = async (
  overrides: Partial<StoreVersionProviderProps> = {}
) => {
  mockFetchFixture('store/itunes-lookup.json');
  const view = await renderProvider(force(overrides), probe);
  await waitFor(() => expect(probe.current.action).toBe('force'));
  return view;
};

/** Force の UI が出ていないこと（Modal も文言もボタンも無い） */
const expectNoForceUi = () => {
  expect(queryModal()).toBeNull();
  expect(screen.queryByText(TITLE)).toBeNull();
  expect(screen.queryByRole('header')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
};

// Play の版が「Varies with device」で比較できず、最低バージョンで force になるケース（remote は null）
const renderForceWithoutRemote = async (
  overrides: Partial<StoreVersionProviderProps> = {}
) => {
  setPlatform('android');
  mockFetchFixture('store/playstore-varies.html');
  const getMinimumVersion: VersionGetter = async () => '2.0.0';
  const view = await renderProvider(
    force({
      bundleId: undefined,
      packageName: 'com.github.android',
      policy: undefined,
      getMinimumVersion,
      ...overrides,
    }),
    probe
  );
  await waitFor(() => expect(probe.current.action).toBe('force'));
  expect(probe.current.remote).toBeNull();
  return view;
};

describe('DefaultForceModal: when it is shown', () => {
  it('shows the Force modal when action is force, with the texts of 4.3', async () => {
    await renderForce();
    expect(screen.getByRole('header', { name: TITLE })).toBeOnTheScreen();
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Update' })).toBeOnTheScreen();
    // 「あとで」は無い（閉じるボタン無し）
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('does not show anything while checking (the children are not blocked)', async () => {
    mockFetchPending();
    await renderProvider(
      force({ bundleId: 'com.example.force.checking' }),
      probe,
      <Text>child</Text>
    );
    expect(probe.current.status).toBe('checking');
    expect(screen.getByText('child')).toBeOnTheScreen();
    expectNoForceUi();
  });

  it('does not show anything when action is none (equal)', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(force({ version: '1.283.0' }), probe);
    await waitFor(() => expect(probe.current.status).toBe('ready'));
    expect(probe.current.action).toBe('none');
    expectNoForceUi();
  });

  it('does not show anything on error', async () => {
    mockFetchReject(new Error('boom'));
    await renderProvider(force(), probe);
    await waitFor(() => expect(probe.current.status).toBe('error'));
    expectNoForceUi();
  });

  it('does not show anything when skipped (web)', async () => {
    setPlatform('web');
    await renderProvider(force(), probe);
    expect(probe.current.status).toBe('skipped');
    expectNoForceUi();
  });

  it('does not show anything with ui={false}', async () => {
    await renderForce({ ui: false });
    expectNoForceUi();
  });

  it('keeps the modal while rechecking, and after the recheck failed and fell back to the previous result (D51, chapter 7)', async () => {
    const onError = createOnError();
    await renderForce({ onError });
    const { calls } = mockFetchPending();
    await act(async () => {
      probe.current.recheck();
    });
    expect(probe.current.status).toBe('checking');
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    await act(async () => {
      calls[0].fail(new Error('offline'));
    });
    await waitFor(() => expect(probe.current.status).toBe('ready'));
    expect(probe.current).toMatchObject({ action: 'force', error: null });
    expect(codesOf(onError)).toEqual(['NETWORK']);
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(getModal().props.visible).toBe(true);
  });

  it('iOS with getLatestVersion: shows Force even though the store URL lookup failed at launch (STORE_URL_UNAVAILABLE to onError)', async () => {
    const onError = createOnError();
    mockFetchReject(new Error('offline'));
    await renderProvider(
      force({ getLatestVersion: async () => '9.9.9', onError }),
      probe
    );
    await waitFor(() => expect(probe.current.action).toBe('force'));
    await waitFor(() =>
      expect(codesOf(onError)).toEqual(['STORE_URL_UNAVAILABLE'])
    );
    expect(probe.current).toMatchObject({
      status: 'ready',
      storeUrl: null,
      error: null,
    });
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(
      screen.getByText(
        'A new version (9.9.9) is available. Please update to continue using the app.'
      )
    ).toBeOnTheScreen();
  });
});

describe('DefaultForceModal: mounting of the Modal (round 2 #6)', () => {
  // Modal のモックは visible=false で null を描くので、マウント済みかはホストのツリーでは分からない。
  // StoreVersionModal を spy して「描画されたか」で見る（描画のたびに呼ばれる）
  const spyModal = () => jest.spyOn(modalModule, 'StoreVersionModal');

  it('does not mount the Modal while skipped (web), and does not subscribe to reduce motion', async () => {
    const rendered = spyModal();
    setPlatform('web');
    await renderProvider(force(), probe);
    expect(probe.current.status).toBe('skipped');
    expect(queryModal()).toBeNull();
    expect(rendered).not.toHaveBeenCalled();
    expect(reduceMotion.queryCount).toBe(0);
    expect(reduceMotion.listenerCount).toBe(0);
  });

  it('does not mount the Modal when the action is none (but does subscribe to reduce motion)', async () => {
    const rendered = spyModal();
    mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(force({ version: '1.283.0' }), probe);
    await waitFor(() => expect(probe.current.action).toBe('none'));
    expect(queryModal()).toBeNull();
    expect(rendered).not.toHaveBeenCalled();
    expect(reduceMotion.listenerCount).toBe(1);
  });

  it('mounts the Modal once something is shown, and keeps it mounted (visible=false) after it closed', async () => {
    const rendered = spyModal();
    const view = await renderForce();
    expect(rendered).toHaveBeenCalled();
    const renders = rendered.mock.calls.length;
    await view.rerender(force({ enabled: false }));
    await waitFor(() => expect(probe.current.status).toBe('skipped'));
    await waitFor(() => expect(queryModal()).toBeNull());
    expectNoForceUi();
    // 閉じた後も描画され続けている（マウントしたまま visible=false）
    expect(rendered.mock.calls.length).toBeGreaterThan(renders);
    // skipped になったので購読は外れる
    expect(reduceMotion.listenerCount).toBe(0);
  });

  it('enabled={false} from the start: no Modal, no reduce motion subscription', async () => {
    const rendered = spyModal();
    await renderProvider(force({ enabled: false }), probe);
    expect(probe.current.status).toBe('skipped');
    expect(rendered).not.toHaveBeenCalled();
    expect(reduceMotion.queryCount).toBe(0);
  });
});

describe('DefaultForceModal: reduce motion on the first show (round 3 #1)', () => {
  it('never calls Animated.timing when the setting is on before the first Force', async () => {
    reduceMotion = mockReduceMotion(true);
    const { started } = mockTiming();
    await renderForce();
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(started).toHaveLength(0);
  });
});

describe('DefaultForceModal: props while closing (round 2 #1)', () => {
  it('keeps the last props while the closing animation runs after enabled={false} (default card)', async () => {
    const view = await renderForce();
    const { started } = mockTiming();
    await view.rerender(force({ enabled: false }));
    await waitFor(() => expect(probe.current.status).toBe('skipped'));
    expect(probe.current).toMatchObject({
      local: null,
      remote: null,
      storeUrl: null,
    });
    // 閉じるアニメーションの間、本文は直前の値のまま
    expect(started.map((a) => a.toValue)).toEqual([0]);
    expect(getModal().props.visible).toBe(true);
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
    expect(
      screen.queryByText(
        'A new version is available. Please update to continue using the app.'
      )
    ).toBeNull();
    await act(async () => {
      started[0].finish(true);
    });
    expectNoForceUi();
  });

  it('keeps the last props for components.Force too', async () => {
    const view = await renderForce({ components: { Force: CustomForce } });
    const { started } = mockTiming();
    const before = seenForceProps[seenForceProps.length - 1];
    await view.rerender(
      force({ enabled: false, components: { Force: CustomForce } })
    );
    await waitFor(() => expect(probe.current.status).toBe('skipped'));
    expect(screen.getByText('custom force 1.283.0')).toBeOnTheScreen();
    const during = seenForceProps[seenForceProps.length - 1];
    expect(during).toEqual(before);
    expect(during).toMatchObject({
      local: '1.282.0',
      remote: '1.283.0',
      storeUrl: trackViewUrl,
      texts: { message: MESSAGE },
    });
    expect(during.openStore).toBe(before.openStore);
    await act(async () => {
      started[0].finish(true);
    });
    expect(queryModal()).toBeNull();
    expect(screen.queryByText('custom force 1.283.0')).toBeNull();
  });
});

describe('DefaultForceModal: the Modal frame', () => {
  it('is a transparent Modal that ignores onRequestClose (the Android back button)', async () => {
    await renderForce();
    const modal = getModal();
    expect(modal.props).toMatchObject({
      visible: true,
      transparent: true,
      animationType: 'none',
      statusBarTranslucent: true,
    });
    expect(modal.props.supportedOrientations).toEqual([
      'portrait',
      'portrait-upside-down',
      'landscape',
      'landscape-left',
      'landscape-right',
    ]);
    expect(typeof modal.props.onRequestClose).toBe('function');
    await act(async () => {
      modal.props.onRequestClose();
    });
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(probe.current).toMatchObject({ action: 'force', dismissed: false });
  });

  it('dims the background with rgba(0, 0, 0, 0.55) and has no backdrop to tap', async () => {
    await renderForce();
    const overlay = getOverlay();
    expect(overlay).toHaveStyle({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
    });
    expect(overlay.props.pointerEvents).toBe('none');
    expect(queryBackdrop()).toBeNull();
    await fireEvent.press(getScrollView());
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
  });

  it('places the card in the vertical center of a ScrollView with the mock side margin of 24 and an overflow inset of 72 (portrait)', async () => {
    await renderForce();
    const scroll = getScrollView();
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toEqual({
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingVertical: 72,
    });
    expect(scroll.props.bounces).toBe(false);
    expect(within(scroll).getByText(TITLE)).toBeOnTheScreen();
  });
});

describe('DefaultForceModal: the card (Force mock)', () => {
  it('card: full width up to 480 and centered, radius 20, padding 28/24/24, gap 14, shadow 0 12 40 .3, white', async () => {
    await renderForce();
    expect(getCard()).toHaveStyle({
      width: '100%',
      maxWidth: 480,
      alignSelf: 'center',
      borderRadius: 20,
      paddingTop: 28,
      paddingHorizontal: 24,
      paddingBottom: 24,
      gap: 14,
      backgroundColor: '#FFFFFF',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.3,
      shadowRadius: 40,
    });
    expect(getCard()).not.toHaveStyle({ marginHorizontal: 24 });
  });

  it('title 20/28 bold #18181B centered (header), message 15/22 #52525B centered', async () => {
    await renderForce();
    const title = screen.getByRole('header');
    expect(title).toHaveTextContent(TITLE);
    expect(title).toHaveStyle({
      fontSize: 20,
      lineHeight: 28,
      fontWeight: '700',
      color: '#18181B',
      textAlign: 'center',
    });
    expect(screen.getByText(MESSAGE)).toHaveStyle({
      fontSize: 15,
      lineHeight: 22,
      color: '#52525B',
      textAlign: 'center',
    });
    expect(screen.getByText(MESSAGE).props.accessibilityRole).toBeUndefined();
  });

  it('button: minHeight 50 (not height), radius 12, #1D4ED8, padding 8/16, text 16/600 white, 6 above', async () => {
    await renderForce();
    const button = screen.getByRole('button', { name: 'Update' });
    expect(button).toHaveStyle({
      minHeight: 50,
      borderRadius: 12,
      backgroundColor: '#1D4ED8',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 16,
    });
    expect(button).not.toHaveStyle({ height: 50 });
    expect(screen.getByText('Update')).toHaveStyle({
      fontSize: 16,
      fontWeight: '600',
      color: '#FFFFFF',
    });
    expect(button.parent).toHaveStyle({ marginTop: 6 });
  });

  it('does not set a fontFamily and keeps font scaling on', async () => {
    await renderForce();
    for (const text of [TITLE, MESSAGE, 'Update']) {
      const element = screen.getByText(text);
      expect(element).not.toHaveStyle({ fontFamily: expect.any(String) });
      expect(element.props.allowFontScaling).not.toBe(false);
    }
  });

  it('order: title, message, button (no icon without the icon prop)', async () => {
    await renderForce();
    expect(hostChildren(getCard()).map((child) => child.type)).toEqual([
      'Text',
      'Text',
      'View',
    ]);
    expect(queryAllImages()).toHaveLength(0);
  });
});

describe('DefaultForceModal: remote unknown (Varies with device + minimum version. D53)', () => {
  it('shows the English message without the empty parentheses', async () => {
    await renderForceWithoutRemote();
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(
      screen.getByText(
        'A new version is available. Please update to continue using the app.'
      )
    ).toBeOnTheScreen();
    expect(screen.queryByText(/\(\)|\{remote\}/)).toBeNull();
  });

  it('shows the Japanese message without the empty full-width parentheses', async () => {
    await renderForceWithoutRemote({ texts: ja });
    expect(
      screen.getByText(
        '新しいバージョンが公開されています。引き続きご利用いただくにはアップデートしてください。'
      )
    ).toBeOnTheScreen();
  });

  it('gives components.Force remote null and the cleaned texts', async () => {
    await renderForceWithoutRemote({ components: { Force: CustomForce } });
    const props = seenForceProps[seenForceProps.length - 1];
    expect(props.remote).toBeNull();
    expect(props.local).toBe('1.282.0');
    expect(props.texts.message).toBe(
      'A new version is available. Please update to continue using the app.'
    );
  });
});

describe('DefaultForceModal: pressed state (D53)', () => {
  it('dims the Update button to opacity 0.7 only while pressed', async () => {
    // 離すと onPress（openStore）も走るので Linking を差し替えておく
    const openURL = mockOpenURL();
    await renderForce();
    // Pressable は離してから 130ms 後に pressed を戻すので、偽のタイマーで進める（React の microtask は本物のまま）
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    const button = () => screen.getByRole('button', { name: 'Update' });
    expect(button()).not.toHaveStyle({ opacity: 0.7 });
    await pressIn(button());
    expect(button()).toHaveStyle({ opacity: 0.7 });
    // 押している間も他のスタイルは変わらない
    expect(button()).toHaveStyle({ backgroundColor: '#1D4ED8', minHeight: 50 });
    await pressOut(button());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expect(button()).not.toHaveStyle({ opacity: 0.7 });
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('DefaultForceModal: icon', () => {
  it('shows the icon above the title, 64×64 radius 15 centered on #DBEAFE', async () => {
    const icon = { uri: 'https://example.com/icon.png' };
    await renderForce({ icon });
    expect(hostChildren(getCard()).map((child) => child.type)).toEqual([
      'Image',
      'Text',
      'Text',
      'View',
    ]);
    const image = getImage();
    expect(image.props.source).toBe(icon);
    expect(image).toHaveStyle({
      width: 64,
      height: 64,
      borderRadius: 15,
      alignSelf: 'center',
      backgroundColor: '#DBEAFE',
    });
  });

  it('draws nothing for icon null / false (JS callers)', async () => {
    for (const icon of [null, false]) {
      const view = await renderForce({ icon: icon as unknown as undefined });
      expect(queryAllImages()).toHaveLength(0);
      expect(hostChildren(getCard())[0].type).toBe('Text');
      await view.unmount();
    }
  });
});

describe('DefaultForceModal: primaryColor (D55)', () => {
  it.each(['light', 'dark'] as const)(
    'paints Update with primaryColor in %s mode and keeps its white text',
    async (scheme) => {
      mockColorScheme(scheme);
      await renderForce({ primaryColor: '#E11D48' });
      expect(screen.getByRole('button', { name: 'Update' })).toHaveStyle({
        backgroundColor: '#E11D48',
      });
      expect(screen.getByText('Update')).toHaveStyle({ color: '#FFFFFF' });
    }
  );
});

describe('DefaultForceModal: dark mode', () => {
  it('uses the dark values of renderVals()', async () => {
    mockColorScheme('dark');
    await renderForce({ icon: { uri: 'x' } });
    expect(getCard()).toHaveStyle({ backgroundColor: '#27272A' });
    expect(screen.getByText(TITLE)).toHaveStyle({ color: '#FAFAFA' });
    expect(screen.getByText(MESSAGE)).toHaveStyle({ color: '#D4D4D8' });
    expect(screen.getByRole('button', { name: 'Update' })).toHaveStyle({
      backgroundColor: '#2563EB',
    });
    expect(screen.getByText('Update')).toHaveStyle({ color: '#FFFFFF' });
    expect(getImage()).toHaveStyle({ backgroundColor: '#1E3A8A' });
    // 幕はライト / ダークで同じ
    expect(getOverlay()).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
    });
  });

  it('treats a null color scheme as light', async () => {
    mockColorScheme(null);
    await renderForce();
    expect(getCard()).toHaveStyle({ backgroundColor: '#FFFFFF' });
  });
});

describe('DefaultForceModal: the Update button', () => {
  it('calls openStore() and opens the trackViewUrl', async () => {
    const openURL = mockOpenURL();
    await renderForce();
    await fireEvent.press(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith(trackViewUrl));
    // 開いてもモーダルは残る（強制なので）
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
  });

  it('does not turn a failure into an unhandled rejection (onError gets STORE_URL_UNAVAILABLE)', async () => {
    mockOpenURL(async () => {
      throw new Error('no store app');
    });
    const onError = createOnError();
    await renderForce({ onError });
    await fireEvent.press(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() =>
      expect(codesOf(onError)).toEqual(['STORE_URL_UNAVAILABLE'])
    );
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
  });
});

describe('DefaultForceModal: texts', () => {
  it('fills the keys not given with the English defaults', async () => {
    await renderForce({ texts: { force: { title: 'Please update' } } });
    expect(screen.getByText('Please update')).toBeOnTheScreen();
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Update' })).toBeOnTheScreen();
  });

  it('replaces every {remote} and {local}', async () => {
    await renderForce({
      texts: {
        force: {
          message: '{local} → {remote} ({remote})',
          update: 'Get {remote}',
        },
      },
    });
    expect(screen.getByText('1.282.0 → 1.283.0 (1.283.0)')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Get 1.283.0' })
    ).toBeOnTheScreen();
  });

  it('reflects texts changed while shown, without checking again', async () => {
    const view = await renderForce({ texts: { force: { title: 'A' } } });
    const fetchSpy = jest.mocked(globalThis.fetch);
    const fetched = fetchSpy.mock.calls.length;
    expect(screen.getByText('A')).toBeOnTheScreen();
    await view.rerender(force({ texts: { force: { title: 'B' } } }));
    expect(screen.queryByText('A')).toBeNull();
    expect(screen.getByText('B')).toBeOnTheScreen();
    await view.rerender(force({ texts: ja }));
    expect(screen.getByText('アップデートが必要です')).toBeOnTheScreen();
    expect(fetchSpy.mock.calls).toHaveLength(fetched);
  });

  it('ja preset', async () => {
    await renderForce({ texts: ja });
    expect(screen.getByText('アップデートが必要です')).toBeOnTheScreen();
    expect(
      screen.getByText(
        '新しいバージョン（1.283.0）が公開されています。引き続きご利用いただくにはアップデートしてください。'
      )
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'アップデート' })
    ).toBeOnTheScreen();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('falls back to the defaults for non-string values (JS callers)', async () => {
    await renderForce({
      texts: {
        force: { title: 42, message: null },
      } as unknown as StoreVersionProviderProps['texts'],
    });
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
  });
});

describe('DefaultForceModal: accessibility', () => {
  it('marks the dialog as modal, hides the overlay, no escape handler, header + button roles', async () => {
    await renderForce();
    const container = getDialogContainer();
    expect(container.props.accessibilityViewIsModal).toBe(true);
    expect(container.props.onAccessibilityEscape).toBeUndefined();
    const overlay = getOverlay();
    expect(overlay.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(overlay.props.accessibilityElementsHidden).toBe(true);
    expect(screen.getByRole('header', { name: TITLE })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Update' })).toBeOnTheScreen();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('DefaultForceModal: components.Force', () => {
  it('renders the component inside the library Modal with the props of 4.3 (texts resolved)', async () => {
    const icon = { uri: 'x' };
    await renderForce({ components: { Force: CustomForce }, icon });
    const modal = getModal();
    // ライブラリの Modal の中（ScrollView の中）に描かれる
    expect(within(modal).getByText('custom force 1.283.0')).toBeOnTheScreen();
    expect(
      within(getScrollView()).getByText('custom force 1.283.0')
    ).toBeOnTheScreen();
    // デフォルトのカードは描かない
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.queryByRole('header')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    // Modal の枠はライブラリのまま（戻るボタン無効・幕・a11y）
    expect(modal.props.transparent).toBe(true);
    await act(async () => {
      modal.props.onRequestClose();
    });
    expect(screen.getByText('custom force 1.283.0')).toBeOnTheScreen();
    expect(getOverlay()).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
    });
    expect(getDialogContainer().props.accessibilityViewIsModal).toBe(true);
    expect(queryBackdrop()).toBeNull();

    const props = seenForceProps[seenForceProps.length - 1];
    expect(Object.keys(props).sort()).toEqual([
      'icon',
      'local',
      'openStore',
      'releaseNotes',
      'remote',
      'storeUrl',
      'texts',
    ]);
    expect(props).toMatchObject({
      local: '1.282.0',
      remote: '1.283.0',
      storeUrl: trackViewUrl,
      icon,
      texts: { title: TITLE, message: MESSAGE, update: 'Update' },
    });
    expect(props.releaseNotes).toBe(probe.current.releaseNotes);
    expect(typeof props.releaseNotes).toBe('string');
    expect(props.openStore).toBe(probe.current.openStore);
    expect('dismiss' in props).toBe(false);
  });

  it('gives the component the texts given by the Provider, replaced', async () => {
    await renderForce({
      components: { Force: CustomForce },
      texts: { force: { title: 'v{remote}' } },
    });
    expect(seenForceProps[seenForceProps.length - 1].texts).toEqual({
      title: 'v1.283.0',
      message: MESSAGE,
      update: 'Update',
    });
  });

  it('openStore from the component opens the store', async () => {
    const openURL = mockOpenURL();
    await renderForce({ components: { Force: CustomForce } });
    await fireEvent.press(screen.getByText('custom force 1.283.0'));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith(trackViewUrl));
  });

  it('components.Warning alone does not change the Force UI', async () => {
    await renderForce({ components: { Warning: NullWarning } });
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
  });
});
