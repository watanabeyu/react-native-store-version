// Warning のデフォルト UI（3b）: 出す条件（dismissed では出さない）、Warning.dc.html の実測値、戻るボタン・背景タップ・「あとで」で dismiss、
// 「更新」で openStore、texts（補完・置き換え・表示中の変更・ja）、icon、ダークモード、a11y、components.Warning の差し替え、ui={false}
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import type { StoreVersionProviderProps } from '../../src/react/StoreVersionProvider.tsx';
import type { StoreVersionWarningProps } from '../../src/react/useStoreVersion.ts';
import ja from '../../src/texts/ja.ts';
import { mockAppState } from '../__helpers__/appState.ts';
import {
  mockFetchFixture,
  mockFetchPending,
  mockFetchResponse,
} from '../__helpers__/fetch.ts';
import { mockOpenURL } from '../__helpers__/linking.ts';
import { setPlatform } from '../__helpers__/platform.ts';
import {
  createOnError,
  createProbe,
  type Probe,
  renderProvider,
} from '../__helpers__/provider.tsx';
import {
  getDialog,
  getDialogContainer,
  getImage,
  getModal,
  getOverlay,
  hostChildren,
  mockColorScheme,
  pressIn,
  pressOut,
  queryAllImages,
  queryModal,
} from '../__helpers__/ui.tsx';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('../__helpers__/platform').platformModule
);

const trackViewUrl = 'https://apps.apple.com/jp/app/github/id1477376905?uo=4';
const playUrl =
  'https://play.google.com/store/apps/details?id=com.github.android';
const TITLE = 'Update available';
const MESSAGE = 'Version 1.283.0 is now available.';

// fixture の iOS は 1.283.0。local 1.282.0 は minor の差分で、既定の policy では warning
const warning = (
  overrides: Partial<StoreVersionProviderProps> = {}
): StoreVersionProviderProps => ({
  version: '1.282.0',
  bundleId: 'com.github.stormbreaker.prod',
  country: 'jp',
  onError: createOnError(),
  ...overrides,
});

const seenWarningProps: StoreVersionWarningProps[] = [];
const CustomWarning = (props: StoreVersionWarningProps) => {
  seenWarningProps.push(props);
  return (
    <>
      <Text onPress={() => void props.openStore()}>
        custom warning {props.remote}
      </Text>
      <Text onPress={props.dismiss}>custom later</Text>
    </>
  );
};

// もう一方の差し替えだけが渡されたときに影響しないことの確認用
const NullForce = () => null;

let probe: Probe;

beforeEach(() => {
  setPlatform('ios');
  mockAppState();
  mockColorScheme('light');
  probe = createProbe();
  seenWarningProps.length = 0;
});

const renderWarning = async (
  overrides: Partial<StoreVersionProviderProps> = {}
) => {
  mockFetchFixture('store/itunes-lookup.json');
  const view = await renderProvider(warning(overrides), probe);
  await waitFor(() => expect(probe.current.action).toBe('warning'));
  return view;
};

const expectClosed = () => {
  expect(queryModal()).toBeNull();
  expect(screen.queryByText(TITLE)).toBeNull();
  expect(probe.current).toMatchObject({ action: 'warning', dismissed: true });
};

describe('DefaultWarningSheet: when it is shown', () => {
  it('shows the sheet when action is warning, with the texts of 4.3', async () => {
    await renderWarning();
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Update' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Later' })).toBeOnTheScreen();
  });

  it('does not display releaseNotes', async () => {
    await renderWarning();
    const notes = probe.current.releaseNotes;
    expect(typeof notes).toBe('string');
    expect(screen.queryByText(notes as string)).toBeNull();
  });

  it('Android: the same sheet with the Play Store URL', async () => {
    setPlatform('android');
    const openURL = mockOpenURL();
    mockFetchFixture('store/playstore.html');
    await renderProvider(
      warning({ bundleId: undefined, packageName: 'com.github.android' }),
      probe
    );
    await waitFor(() => expect(probe.current.action).toBe('warning'));
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() =>
      expect(openURL).toHaveBeenCalledWith(
        'market://details?id=com.github.android'
      )
    );
    expect(openURL).not.toHaveBeenCalledWith(playUrl);
  });

  it('does not show anything with ui={false}', async () => {
    await renderWarning({ ui: false });
    expect(queryModal()).toBeNull();
  });

  it('keeps the sheet while rechecking, and stays closed once dismissed (D51)', async () => {
    await renderWarning();
    mockFetchPending();
    await act(async () => {
      probe.current.recheck();
    });
    expect(probe.current.status).toBe('checking');
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Later' }));
    expectClosed();
  });

  it('shows the sheet again for a newer remote after dismiss (D22)', async () => {
    await renderWarning();
    await fireEvent.press(screen.getByRole('button', { name: 'Later' }));
    expectClosed();
    mockFetchResponse(
      JSON.stringify({
        resultCount: 1,
        results: [{ version: '1.284.0', trackViewUrl }],
      })
    );
    await act(async () => {
      probe.current.recheck();
    });
    await waitFor(() => expect(probe.current.remote).toBe('1.284.0'));
    expect(
      screen.getByText('Version 1.284.0 is now available.')
    ).toBeOnTheScreen();
  });

  it('switches to the Force modal when the policy makes it force', async () => {
    const view = await renderWarning();
    await view.rerender(warning({ policy: 'force' }));
    await waitFor(() => expect(probe.current.action).toBe('force'));
    expect(screen.getByText('Update required')).toBeOnTheScreen();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull();
  });
});

describe('DefaultWarningSheet: closing (D50 ①)', () => {
  it('Later: dismiss', async () => {
    await renderWarning();
    await fireEvent.press(screen.getByRole('button', { name: 'Later' }));
    expectClosed();
  });

  it('the Android back button (onRequestClose): dismiss', async () => {
    await renderWarning();
    await act(async () => {
      getModal().props.onRequestClose();
    });
    expectClosed();
  });

  it('a tap on the overlay: dismiss', async () => {
    await renderWarning();
    await fireEvent.press(getOverlay());
    expectClosed();
  });

  it('Update: opens the store and keeps the sheet', async () => {
    const openURL = mockOpenURL();
    await renderWarning();
    await fireEvent.press(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith(trackViewUrl));
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(probe.current.dismissed).toBe(false);
  });

  it('a tap on the sheet itself does not dismiss', async () => {
    await renderWarning();
    await fireEvent.press(screen.getByText(MESSAGE));
    await fireEvent.press(getDialog());
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(probe.current.dismissed).toBe(false);
  });
});

describe('DefaultWarningSheet: pressed state (D53)', () => {
  it('dims Update and Later to opacity 0.7 only while pressed', async () => {
    const openURL = mockOpenURL();
    await renderWarning();
    // Pressable は離してから 130ms 後に pressed を戻すので、偽のタイマーで進める（React の microtask は本物のまま）
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    const update = () => screen.getByRole('button', { name: 'Update' });
    expect(update()).not.toHaveStyle({ opacity: 0.7 });
    await pressIn(update());
    expect(update()).toHaveStyle({ opacity: 0.7 });
    expect(update()).toHaveStyle({ backgroundColor: '#1D4ED8' });
    // 離すと onPress（openStore）が走り、130ms 後に pressed が戻る。シートは残る
    await pressOut(update());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expect(update()).not.toHaveStyle({ opacity: 0.7 });
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
    expect(screen.getByText(TITLE)).toBeOnTheScreen();

    const later = () => screen.getByRole('button', { name: 'Later' });
    expect(later()).not.toHaveStyle({ opacity: 0.7 });
    await pressIn(later());
    expect(later()).toHaveStyle({ opacity: 0.7 });
    expect(later()).not.toHaveStyle({ backgroundColor: expect.any(String) });
    // 離すと onPress（dismiss）でシートが閉じる
    await pressOut(later());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expectClosed();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('DefaultWarningSheet: the Modal frame', () => {
  it('is a transparent Modal with the overlay rgba(0, 0, 0, 0.35) and the sheet at the bottom', async () => {
    await renderWarning();
    expect(getModal().props).toMatchObject({
      visible: true,
      transparent: true,
      statusBarTranslucent: true,
    });
    expect(getOverlay()).toHaveStyle({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.35)',
    });
    const container = getDialogContainer();
    expect(container).toHaveStyle({ flex: 1, justifyContent: 'flex-end' });
    expect(container.props.pointerEvents).toBe('box-none');
  });
});

describe('DefaultWarningSheet: the sheet (Warning.dc.html)', () => {
  it('sheet: radius 24/24/0/0, padding 12/24/40, gap 14, shadow 0 -8 32 .2, white, full width', async () => {
    await renderWarning();
    const sheet = getDialog();
    expect(sheet).toHaveStyle({
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 12,
      paddingHorizontal: 24,
      paddingBottom: 40,
      gap: 14,
      backgroundColor: '#FFFFFF',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.2,
      shadowRadius: 32,
    });
    expect(sheet).not.toHaveStyle({ borderBottomLeftRadius: 24 });
    expect(sheet).not.toHaveStyle({ marginHorizontal: 24 });
  });

  it('handle: 40×5, radius 3, centered, 10 below, #D4D4D8, decorative only', async () => {
    await renderWarning();
    const [handle] = hostChildren(getDialog());
    expect(handle.type).toBe('View');
    expect(handle).toHaveStyle({
      width: 40,
      height: 5,
      borderRadius: 3,
      alignSelf: 'center',
      marginBottom: 10,
      backgroundColor: '#D4D4D8',
    });
    expect(handle.props.onStartShouldSetResponder).toBeUndefined();
    expect(handle.props.onResponderMove).toBeUndefined();
  });

  it('title 20/28 bold #18181B, message 15/22 #52525B, both left aligned', async () => {
    await renderWarning();
    expect(screen.getByText(TITLE)).toHaveStyle({
      fontSize: 20,
      lineHeight: 28,
      fontWeight: '700',
      color: '#18181B',
    });
    expect(screen.getByText(TITLE)).not.toHaveStyle({ textAlign: 'center' });
    expect(screen.getByText(MESSAGE)).toHaveStyle({
      fontSize: 15,
      lineHeight: 22,
      color: '#52525B',
    });
    expect(screen.getByText(MESSAGE)).not.toHaveStyle({ textAlign: 'center' });
  });

  it('buttons: in a column with gap 8 and 8 above; Update filled #1D4ED8 white, Later text only #1D4ED8', async () => {
    await renderWarning();
    const update = screen.getByRole('button', { name: 'Update' });
    const later = screen.getByRole('button', { name: 'Later' });
    expect(update.parent).toBe(later.parent);
    expect(update.parent).toHaveStyle({ gap: 8, marginTop: 8 });
    expect(update.parent).not.toHaveStyle({ flexDirection: 'row' });
    expect(hostChildren(update.parent as typeof update).map((c) => c)).toEqual([
      update,
      later,
    ]);
    for (const button of [update, later]) {
      expect(button).toHaveStyle({
        minHeight: 50,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
      });
      expect(button).not.toHaveStyle({ height: 50 });
    }
    expect(update).toHaveStyle({ backgroundColor: '#1D4ED8' });
    expect(later).not.toHaveStyle({ backgroundColor: expect.any(String) });
    expect(screen.getByText('Update')).toHaveStyle({
      fontSize: 16,
      fontWeight: '600',
      color: '#FFFFFF',
    });
    expect(screen.getByText('Later')).toHaveStyle({
      fontSize: 16,
      fontWeight: '600',
      color: '#1D4ED8',
    });
  });

  it('does not set a fontFamily and keeps font scaling on', async () => {
    await renderWarning();
    for (const text of [TITLE, MESSAGE, 'Update', 'Later']) {
      const element = screen.getByText(text);
      expect(element).not.toHaveStyle({ fontFamily: expect.any(String) });
      expect(element.props.allowFontScaling).not.toBe(false);
    }
  });

  it('order: handle, title, message, buttons (no icon without the icon prop)', async () => {
    await renderWarning();
    expect(hostChildren(getDialog()).map((child) => child.type)).toEqual([
      'View',
      'Text',
      'Text',
      'View',
    ]);
    expect(queryAllImages()).toHaveLength(0);
  });
});

describe('DefaultWarningSheet: icon', () => {
  it('shows the icon at the top left under the handle, 56×56 radius 13 on #DBEAFE', async () => {
    const icon = { uri: 'https://example.com/icon.png' };
    await renderWarning({ icon });
    expect(hostChildren(getDialog()).map((child) => child.type)).toEqual([
      'View',
      'Image',
      'Text',
      'Text',
      'View',
    ]);
    const image = getImage();
    expect(image.props.source).toBe(icon);
    expect(image).toHaveStyle({
      width: 56,
      height: 56,
      borderRadius: 13,
      alignSelf: 'flex-start',
      backgroundColor: '#DBEAFE',
    });
  });
});

describe('DefaultWarningSheet: dark mode', () => {
  it('uses the dark values of renderVals()', async () => {
    mockColorScheme('dark');
    await renderWarning({ icon: { uri: 'x' } });
    expect(getDialog()).toHaveStyle({ backgroundColor: '#27272A' });
    const [handle] = hostChildren(getDialog());
    expect(handle).toHaveStyle({ backgroundColor: '#52525B' });
    expect(screen.getByText(TITLE)).toHaveStyle({ color: '#FAFAFA' });
    expect(screen.getByText(MESSAGE)).toHaveStyle({ color: '#D4D4D8' });
    expect(screen.getByRole('button', { name: 'Update' })).toHaveStyle({
      backgroundColor: '#2563EB',
    });
    expect(screen.getByText('Update')).toHaveStyle({ color: '#FFFFFF' });
    expect(screen.getByText('Later')).toHaveStyle({ color: '#93C5FD' });
    expect(getImage()).toHaveStyle({
      backgroundColor: '#1E3A8A',
    });
    expect(getOverlay()).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.35)',
    });
  });
});

describe('DefaultWarningSheet: texts', () => {
  it('fills the keys not given with the English defaults', async () => {
    await renderWarning({ texts: { warning: { later: 'Not now' } } });
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Update' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeOnTheScreen();
  });

  it('replaces every {remote} and {local}', async () => {
    await renderWarning({
      texts: {
        warning: {
          message: 'You have {local}. {remote} is out ({remote}).',
          later: 'Stay on {local}',
        },
      },
    });
    expect(
      screen.getByText('You have 1.282.0. 1.283.0 is out (1.283.0).')
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Stay on 1.282.0' })
    ).toBeOnTheScreen();
  });

  it('reflects texts changed while shown', async () => {
    const view = await renderWarning({ texts: { warning: { title: 'A' } } });
    expect(screen.getByText('A')).toBeOnTheScreen();
    await view.rerender(warning({ texts: { warning: { title: 'B' } } }));
    expect(screen.queryByText('A')).toBeNull();
    expect(screen.getByText('B')).toBeOnTheScreen();
    await view.rerender(warning({ texts: ja }));
    expect(screen.getByText('新しいバージョンがあります')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'あとで' })).toBeOnTheScreen();
  });

  it('ja preset', async () => {
    await renderWarning({ texts: ja });
    expect(screen.getByText('新しいバージョンがあります')).toBeOnTheScreen();
    expect(
      screen.getByText('バージョン 1.283.0 が利用できます。')
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'アップデート' })
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'あとで' }));
    expect(probe.current.dismissed).toBe(true);
    expect(queryModal()).toBeNull();
  });
});

describe('DefaultWarningSheet: accessibility', () => {
  it('marks the dialog as modal, hides the overlay from assistive tech and focus, and gives the buttons their role', async () => {
    await renderWarning();
    expect(getDialogContainer().props.accessibilityViewIsModal).toBe(true);
    const overlay = getOverlay();
    expect(overlay.props).toMatchObject({
      importantForAccessibility: 'no-hide-descendants',
      accessibilityElementsHidden: true,
      accessible: false,
      focusable: false,
    });
    expect(
      screen.getAllByRole('button').map((b) => b.props.accessible)
    ).toEqual([true, true]);
  });
});

describe('DefaultWarningSheet: components.Warning', () => {
  it('renders the component inside the library Modal with the props of 4.3 plus dismiss', async () => {
    const icon = { uri: 'x' };
    await renderWarning({ components: { Warning: CustomWarning }, icon });
    expect(screen.getByText('custom warning 1.283.0')).toBeOnTheScreen();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(getOverlay()).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.35)',
    });
    expect(getDialogContainer()).toHaveStyle({ justifyContent: 'flex-end' });

    const props = seenWarningProps[seenWarningProps.length - 1];
    expect(Object.keys(props).sort()).toEqual([
      'dismiss',
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
      texts: {
        title: TITLE,
        message: MESSAGE,
        update: 'Update',
        later: 'Later',
      },
    });
    expect(props.openStore).toBe(probe.current.openStore);
    expect(props.dismiss).toBe(probe.current.dismiss);
  });

  it('the library frame still dismisses on the back button and the overlay', async () => {
    await renderWarning({ components: { Warning: CustomWarning } });
    await act(async () => {
      getModal().props.onRequestClose();
    });
    expect(queryModal()).toBeNull();
    expect(probe.current.dismissed).toBe(true);
  });

  it('dismiss / openStore from the component work', async () => {
    const openURL = mockOpenURL();
    await renderWarning({ components: { Warning: CustomWarning } });
    await fireEvent.press(screen.getByText('custom warning 1.283.0'));
    await waitFor(() => expect(openURL).toHaveBeenCalledWith(trackViewUrl));
    await fireEvent.press(screen.getByText('custom later'));
    expect(queryModal()).toBeNull();
    expect(probe.current.dismissed).toBe(true);
  });

  it('gives the component the texts given by the Provider, replaced', async () => {
    await renderWarning({
      components: { Warning: CustomWarning },
      texts: { warning: { later: 'Stay on {local}' } },
    });
    expect(seenWarningProps[seenWarningProps.length - 1].texts.later).toBe(
      'Stay on 1.282.0'
    );
  });

  it('components.Force alone does not change the Warning UI', async () => {
    await renderWarning({ components: { Force: NullForce } });
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
  });
});
