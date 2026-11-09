// デフォルト UI の Modal の枠（3b、D53）。偽の state / display を Context に入れて StoreVersionModal だけを描き、
// 枠の挙動を直接確かめる: 出す条件、Modal の props（supportedOrientations など）、Force の戻るボタンが dismiss につながらないこと、
// Warning の戻るボタン・背景タップ・VoiceOver の escape、Force ⇄ Warning の切り替えで Modal が 1 つのまま、
// 閉じるアニメーションが終わってから visible={false}、視差効果を減らす設定では動かさない、components が Modal の中に描かれること
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import {
  ANIMATION_DURATION_MS,
  StoreVersionModal,
  SUPPORTED_ORIENTATIONS,
  uiKindOf,
  useReduceMotion,
} from '../../src/react/StoreVersionModal.tsx';
import {
  type StoreVersionDisplay,
  StoreVersionDisplayContext,
  type StoreVersionForceProps,
  StoreVersionStateContext,
  type StoreVersionWarningProps,
  type UseStoreVersionResult,
} from '../../src/react/useStoreVersion.ts';
import {
  mockReduceMotion,
  type ReduceMotionMock,
} from '../__helpers__/accessibilityInfo.ts';
import { setPlatform } from '../__helpers__/platform.ts';
import {
  getBackdrop,
  getDialogContainer,
  getModal,
  getOverlay,
  getScrollView,
  mockColorScheme,
  mockTiming,
  queryBackdrop,
  queryModal,
} from '../__helpers__/ui.tsx';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('../__helpers__/platform').platformModule
);

const FORCE_TITLE = 'Update required';
const WARNING_TITLE = 'Update available';

const stateOf = (
  overrides: Partial<UseStoreVersionResult> = {}
): UseStoreVersionResult => ({
  status: 'ready',
  result: 'new',
  detail: 'remote > local',
  action: 'warning',
  diff: 'minor',
  dismissed: false,
  local: '1.0.0',
  remote: '1.1.0',
  storeUrl: 'https://apps.apple.com/jp/app/x/id1',
  releaseNotes: undefined,
  openStore: jest.fn(async () => true),
  dismiss: jest.fn(),
  recheck: jest.fn(),
  error: null,
  ...overrides,
});

const NONE: Partial<UseStoreVersionResult> = {
  action: 'none',
  result: 'equal',
  detail: 'remote === local',
  diff: null,
};

const displayOf = (
  overrides: Partial<StoreVersionDisplay> = {}
): StoreVersionDisplay => ({
  ui: true,
  texts: undefined,
  icon: undefined,
  components: undefined,
  ...overrides,
});

const Harness = ({
  state,
  display = displayOf(),
  reduceMotion = false,
}: {
  state: UseStoreVersionResult;
  display?: StoreVersionDisplay;
  reduceMotion?: boolean;
}) => (
  <StoreVersionStateContext.Provider value={state}>
    <StoreVersionDisplayContext.Provider value={display}>
      <StoreVersionModal reduceMotion={reduceMotion} />
    </StoreVersionDisplayContext.Provider>
  </StoreVersionStateContext.Provider>
);

const CustomForce = (props: StoreVersionForceProps) => (
  <Text>custom force {props.remote}</Text>
);
const CustomWarning = (props: StoreVersionWarningProps) => (
  <Text onPress={props.dismiss}>custom warning {props.remote}</Text>
);
// 受け取った icon を記録する（Biome の noComponentHookFactories のためモジュール直下に置く）
const seenIcons: (StoreVersionForceProps['icon'] | 'unset')[] = [];
const IconProbe = (props: StoreVersionForceProps) => {
  seenIcons.push('icon' in props ? props.icon : 'unset');
  return null;
};

let reduceMotion: ReduceMotionMock;

beforeEach(() => {
  setPlatform('ios');
  mockColorScheme('light');
  reduceMotion = mockReduceMotion(false);
});

describe('uiKindOf', () => {
  it('force → force, warning → warning unless dismissed, everything else → null', () => {
    expect(uiKindOf(stateOf({ action: 'force' }))).toBe('force');
    expect(uiKindOf(stateOf({ action: 'force', dismissed: true }))).toBe(
      'force'
    );
    expect(uiKindOf(stateOf())).toBe('warning');
    expect(uiKindOf(stateOf({ dismissed: true }))).toBeNull();
    expect(uiKindOf(stateOf(NONE))).toBeNull();
    expect(
      uiKindOf(
        stateOf({
          status: 'checking',
          action: null,
          result: null,
          detail: null,
          diff: null,
          remote: null,
        })
      )
    ).toBeNull();
    expect(uiKindOf(stateOf({ action: 'force', local: null }))).toBeNull();
  });
});

describe('StoreVersionModal: what is shown', () => {
  it('renders nothing (visible=false) when there is nothing to show', async () => {
    await render(<Harness state={stateOf(NONE)} />);
    expect(queryModal()).toBeNull();
    expect(screen.queryByText(FORCE_TITLE)).toBeNull();
    expect(screen.queryByText(WARNING_TITLE)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing while idle / checking / error / skipped', async () => {
    for (const status of ['idle', 'checking', 'error', 'skipped'] as const) {
      const view = await render(
        <Harness
          state={stateOf({
            status,
            action: null,
            result: null,
            detail: null,
            diff: null,
            remote: null,
            local: status === 'idle' ? null : '1.0.0',
          })}
        />
      );
      expect(queryModal()).toBeNull();
      expect(screen.queryByRole('header')).toBeNull();
      await view.unmount();
    }
  });

  it('renders the Force card for action force (even if dismiss was called)', async () => {
    await render(
      <Harness state={stateOf({ action: 'force', dismissed: true })} />
    );
    expect(within(getModal()).getByText(FORCE_TITLE)).toBeOnTheScreen();
    expect(screen.queryByText(WARNING_TITLE)).toBeNull();
  });

  it('renders the Warning sheet for action warning, and nothing once dismissed', async () => {
    const view = await render(<Harness state={stateOf()} />);
    expect(within(getModal()).getByText(WARNING_TITLE)).toBeOnTheScreen();
    await view.rerender(<Harness state={stateOf({ dismissed: true })} />);
    await waitFor(() => expect(queryModal()).toBeNull());
    expect(screen.queryByText(WARNING_TITLE)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('StoreVersionModal: the Modal props', () => {
  it('is transparent, not animated by the Modal itself, status bar translucent, and supports every orientation', async () => {
    await render(<Harness state={stateOf()} />);
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
    expect(modal.props.supportedOrientations).toEqual([
      ...SUPPORTED_ORIENTATIONS,
    ]);
  });

  it('puts the content in a ScrollView that fills the screen and does not bounce', async () => {
    await render(<Harness state={stateOf({ action: 'force' })} />);
    const scroll = getScrollView();
    expect(scroll.props.bounces).toBe(false);
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toEqual({
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingVertical: 64,
    });
    expect(within(scroll).getByText(FORCE_TITLE)).toBeOnTheScreen();
  });
});

describe('StoreVersionModal: Force', () => {
  it('onRequestClose is not wired to dismiss, there is no backdrop and no escape handler', async () => {
    const dismiss = jest.fn();
    await render(<Harness state={stateOf({ action: 'force', dismiss })} />);
    const modal = getModal();
    expect(typeof modal.props.onRequestClose).toBe('function');
    await act(async () => {
      modal.props.onRequestClose();
    });
    expect(dismiss).not.toHaveBeenCalled();
    expect(screen.getByText(FORCE_TITLE)).toBeOnTheScreen();
    expect(queryBackdrop()).toBeNull();
    expect(getDialogContainer().props.onAccessibilityEscape).toBeUndefined();
    expect(getOverlay()).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
    });
    expect(getOverlay().props.pointerEvents).toBe('none');
  });
});

describe('StoreVersionModal: Warning', () => {
  it('the back button, the backdrop and the accessibility escape all call dismiss', async () => {
    const dismiss = jest.fn();
    await render(<Harness state={stateOf({ dismiss })} />);
    await act(async () => {
      getModal().props.onRequestClose();
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
    await fireEvent.press(getBackdrop());
    expect(dismiss).toHaveBeenCalledTimes(2);
    await act(async () => {
      getDialogContainer().props.onAccessibilityEscape();
    });
    expect(dismiss).toHaveBeenCalledTimes(3);
    // 背景のタップは ScrollView の中で受ける（スクロールしても空いたところはすべて背景）
    expect(
      getScrollView().queryAll((node) => node === getBackdrop())
    ).toHaveLength(1);
    expect(getOverlay()).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.35)',
    });
    expect(
      StyleSheet.flatten(getScrollView().props.contentContainerStyle)
    ).toEqual({ flexGrow: 1, justifyContent: 'flex-end', paddingTop: 64 });
  });
});

describe('StoreVersionModal: Force ⇄ Warning', () => {
  it('swaps the content inside the same Modal without closing it', async () => {
    const { started } = mockTiming();
    const view = await render(<Harness state={stateOf({ action: 'force' })} />);
    expect(started.map((a) => a.toValue)).toEqual([1]);
    expect(screen.getByText(FORCE_TITLE)).toBeOnTheScreen();

    await view.rerender(<Harness state={stateOf()} />);
    expect(getModal().props.visible).toBe(true);
    expect(screen.getByText(WARNING_TITLE)).toBeOnTheScreen();
    expect(screen.queryByText(FORCE_TITLE)).toBeNull();
    expect(getBackdrop()).toBeTruthy();
    expect(getOverlay()).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.35)',
    });

    await view.rerender(<Harness state={stateOf({ action: 'force' })} />);
    expect(getModal().props.visible).toBe(true);
    expect(screen.getByText(FORCE_TITLE)).toBeOnTheScreen();
    expect(queryBackdrop()).toBeNull();
    // 閉じるアニメーション（toValue 0）は一度も走らない
    expect(started.filter((a) => a.toValue === 0)).toHaveLength(0);
  });
});

describe('StoreVersionModal: open / close animation', () => {
  it('opens with a 250ms native-driver timing to 1', async () => {
    const { started } = mockTiming();
    await render(<Harness state={stateOf()} />);
    expect(started).toHaveLength(1);
    expect(started[0].config).toMatchObject({
      toValue: 1,
      duration: ANIMATION_DURATION_MS,
      useNativeDriver: true,
    });
    expect(ANIMATION_DURATION_MS).toBe(250);
  });

  it('keeps the Modal visible until the closing animation has finished', async () => {
    const { started } = mockTiming();
    const view = await render(<Harness state={stateOf()} />);
    await view.rerender(<Harness state={stateOf({ dismissed: true })} />);
    expect(started.map((a) => a.toValue)).toEqual([1, 0]);
    expect(started[1].config).toMatchObject({
      duration: ANIMATION_DURATION_MS,
      useNativeDriver: true,
    });
    // まだ閉じていない
    expect(getModal().props.visible).toBe(true);
    expect(screen.getByText(WARNING_TITLE)).toBeOnTheScreen();
    await act(async () => {
      started[1].finish(true);
    });
    expect(queryModal()).toBeNull();
    expect(screen.queryByText(WARNING_TITLE)).toBeNull();
  });

  it('a reopen during the closing animation stops it and keeps the Modal (no dismiss → present)', async () => {
    const { started } = mockTiming();
    const view = await render(<Harness state={stateOf()} />);
    await view.rerender(<Harness state={stateOf({ dismissed: true })} />);
    expect(started.map((a) => a.toValue)).toEqual([1, 0]);
    await view.rerender(<Harness state={stateOf({ action: 'force' })} />);
    expect(started[1].stop).toHaveBeenCalled();
    expect(started.map((a) => a.toValue)).toEqual([1, 0, 1]);
    // 止められたアニメーションの完了（finished: false）では閉じない
    await act(async () => {
      started[1].finish(false);
    });
    expect(getModal().props.visible).toBe(true);
    expect(screen.getByText(FORCE_TITLE)).toBeOnTheScreen();
  });

  it('unmount stops the running animation', async () => {
    const { started } = mockTiming();
    const view = await render(<Harness state={stateOf()} />);
    await view.unmount();
    expect(started[0].stop).toHaveBeenCalled();
  });

  it('unmount during the closing animation calls stop(), and a late completion does not throw', async () => {
    const { started } = mockTiming();
    const view = await render(<Harness state={stateOf()} />);
    await view.rerender(<Harness state={stateOf({ dismissed: true })} />);
    expect(started.map((a) => a.toValue)).toEqual([1, 0]);
    await view.unmount();
    expect(started[1].stop).toHaveBeenCalled();
    await act(async () => {
      started[1].finish(false);
    });
    // 止められたアニメーションの完了（finished: false）は無視される（例外や unhandled rejection にならない）
  });

  it('really closes with the real Animated under fake timers', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    const view = await render(<Harness state={stateOf()} />);
    await view.rerender(<Harness state={stateOf({ dismissed: true })} />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ANIMATION_DURATION_MS + 50);
    });
    expect(queryModal()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('StoreVersionModal: reduce motion (the value comes from the Provider as a prop)', () => {
  it('does not animate when the setting is on, and closes right away', async () => {
    const { started } = mockTiming();
    const view = await render(<Harness state={stateOf()} reduceMotion />);
    expect(screen.getByText(WARNING_TITLE)).toBeOnTheScreen();
    expect(started).toHaveLength(0);
    await view.rerender(
      <Harness state={stateOf({ dismissed: true })} reduceMotion />
    );
    await waitFor(() => expect(queryModal()).toBeNull());
    expect(started).toHaveLength(0);
  });

  it('reads the setting when opening / closing, and does not restart a running animation when it changes', async () => {
    const { started } = mockTiming();
    const view = await render(<Harness state={stateOf(NONE)} reduceMotion />);
    await view.rerender(<Harness state={stateOf()} reduceMotion />);
    expect(started).toHaveLength(0);
    // 表示中に設定が変わっても何も走らない
    await view.rerender(<Harness state={stateOf()} reduceMotion={false} />);
    expect(started).toHaveLength(0);
    // 閉じるときに今の設定（false）で動く
    await view.rerender(
      <Harness state={stateOf({ dismissed: true })} reduceMotion={false} />
    );
    expect(started.map((a) => a.toValue)).toEqual([0]);
  });
});

describe('useReduceMotion', () => {
  it('reads and subscribes only while active, and unsubscribes when inactive / unmounted', async () => {
    const hook = await renderHook(
      ({ active }: { active: boolean }) => useReduceMotion(active),
      { initialProps: { active: false } }
    );
    expect(reduceMotion.queryCount).toBe(0);
    expect(reduceMotion.listenerCount).toBe(0);
    expect(hook.result.current).toBe(false);

    await hook.rerender({ active: true });
    expect(reduceMotion.queryCount).toBe(1);
    expect(reduceMotion.listenerCount).toBe(1);
    await act(async () => {
      reduceMotion.change(true);
    });
    expect(hook.result.current).toBe(true);

    await hook.rerender({ active: false });
    expect(reduceMotion.listenerCount).toBe(0);
    await hook.rerender({ active: true });
    expect(reduceMotion.listenerCount).toBe(1);
    await hook.unmount();
    expect(reduceMotion.listenerCount).toBe(0);
  });

  it('becomes true when the setting is on', async () => {
    reduceMotion = mockReduceMotion(true);
    const hook = await renderHook(() => useReduceMotion(true));
    await waitFor(() => expect(hook.result.current).toBe(true));
  });

  it('stays false when isReduceMotionEnabled() rejects (the setting cannot be read)', async () => {
    reduceMotion = mockReduceMotion('reject');
    const hook = await renderHook(() => useReduceMotion(true));
    await act(async () => {});
    expect(hook.result.current).toBe(false);
    expect(reduceMotion.queryCount).toBe(1);
  });

  it('a settle after unmount (resolve or reject) does not throw nor become an unhandled rejection', async () => {
    reduceMotion = mockReduceMotion('pending');
    const first = await renderHook(() => useReduceMotion(true));
    expect(reduceMotion.listenerCount).toBe(1);
    await first.unmount();
    expect(reduceMotion.listenerCount).toBe(0);
    await act(async () => {
      reduceMotion.settle(true);
    });
    const second = await renderHook(() => useReduceMotion(true));
    await second.unmount();
    await act(async () => {
      reduceMotion.settle(new Error('late failure'));
    });
  });
});

describe('StoreVersionModal: components', () => {
  it('renders components.Force / components.Warning inside the library Modal (and only the content)', async () => {
    const display = displayOf({
      components: { Force: CustomForce, Warning: CustomWarning },
    });
    const view = await render(
      <Harness state={stateOf({ action: 'force' })} display={display} />
    );
    const modal = getModal();
    expect(within(modal).getByText('custom force 1.1.0')).toBeOnTheScreen();
    expect(
      within(getScrollView()).getByText('custom force 1.1.0')
    ).toBeOnTheScreen();
    expect(screen.queryByText(FORCE_TITLE)).toBeNull();
    expect(getOverlay()).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
    });
    expect(getDialogContainer().props.accessibilityViewIsModal).toBe(true);

    await view.rerender(<Harness state={stateOf()} display={display} />);
    expect(
      within(getModal()).getByText('custom warning 1.1.0')
    ).toBeOnTheScreen();
    expect(getBackdrop()).toBeTruthy();
  });

  it('passes icon as undefined when the Provider got null / false (JS callers)', async () => {
    seenIcons.length = 0;
    for (const icon of [null, false, undefined]) {
      const view = await render(
        <Harness
          state={stateOf({ action: 'force' })}
          display={displayOf({
            components: { Force: IconProbe },
            icon: icon as unknown as undefined,
          })}
        />
      );
      await view.unmount();
    }
    expect(seenIcons).toEqual([undefined, undefined, undefined]);
  });
});
