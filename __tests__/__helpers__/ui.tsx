// デフォルト UI（3b）のテスト用。ライブラリの Modal の枠（幕・背景・a11y の容れ物・ScrollView）と、その中身（カード / シート）を
// 取り出す。testID は src に足さない（利用者のビュー階層に残るため）ので、a11y の属性と構造で辿る。
// @testing-library/react-native 14 のツリーはホストの要素だけ（type は 'Modal' / 'View' / 'Text' / 'Image' などの文字列）
import { fireEvent, screen } from '@testing-library/react-native';
import { Animated, useColorScheme } from 'react-native';

type Instance = ReturnType<typeof screen.getByText>;

const all = (predicate: (node: Instance) => boolean): Instance[] =>
  screen.container.queryAll(predicate);

const only = (list: Instance[], what: string): Instance => {
  const [first, ...rest] = list;
  if (!first || rest.length > 0) {
    throw new Error(`expected exactly one ${what}, found ${list.length}`);
  }
  return first;
};

/** 描画されているライブラリの Modal（無ければ null。2 つ以上あれば throw。Modal は 1 つだけのはず） */
export const queryModal = (): Instance | null => {
  const modals = all((node) => node.type === 'Modal');
  if (modals.length > 1) {
    throw new Error(`expected at most one Modal, found ${modals.length}`);
  }
  return modals[0] ?? null;
};

/** 描画されているライブラリの Modal（無ければ throw） */
export const getModal = (): Instance => {
  const modal = queryModal();
  if (modal === null) {
    throw new Error('no Modal is rendered');
  }
  return modal;
};

const hidden = (node: Instance) =>
  node.props.accessibilityElementsHidden === true &&
  node.props.importantForAccessibility === 'no-hide-descendants';

/** 幕（色の付いた、タッチを受けない Animated.View。読み上げから外してある） */
export const getOverlay = (): Instance =>
  only(
    getModal().queryAll(
      (node) => hidden(node) && node.props.pointerEvents === 'none'
    ),
    'overlay'
  );

/** 背景のタップを受ける Pressable（Warning だけ。ScrollView の中。無ければ null） */
export const queryBackdrop = (): Instance | null => {
  const list = getModal().queryAll(
    (node) => hidden(node) && node.props.accessible === false
  );
  if (list.length > 1) {
    throw new Error(`expected at most one backdrop, found ${list.length}`);
  }
  return list[0] ?? null;
};

export const getBackdrop = (): Instance => {
  const backdrop = queryBackdrop();
  if (backdrop === null) {
    throw new Error('no backdrop is rendered');
  }
  return backdrop;
};

/** a11y の容れ物（`accessibilityViewIsModal` を持つホストの View。画面いっぱい） */
export const getDialogContainer = (): Instance =>
  only(
    getModal().queryAll((node) => node.props.accessibilityViewIsModal === true),
    'dialog container'
  );

/** 中身を入れる ScrollView（ホストは RCTScrollView） */
export const getScrollView = (): Instance =>
  only(
    getDialogContainer().queryAll((node) => node.type === 'RCTScrollView'),
    'ScrollView'
  );

/** ホストの子要素（文字列は除く） */
export const hostChildren = (node: Instance): Instance[] =>
  node.children.filter((child): child is Instance => typeof child !== 'string');

/** デフォルト UI のカード / シート（タイトル（header）を直接持つ View） */
export const getCard = (): Instance => {
  const parent = screen.getByRole('header').parent;
  if (parent === null) {
    throw new Error('the title has no parent');
  }
  return parent;
};

/** 描画されている Image（`icon`） */
export const queryAllImages = (): Instance[] =>
  all((node) => node.type === 'Image');

export const getImage = (): Instance => only(queryAllImages(), 'Image');

/**
 * `useColorScheme` の戻り値を差し替える（@react-native/jest-preset が jest.fn(() => 'light') に差し替えている。
 * jest.fn() は restoreMocks では戻らないので、使ったテストファイルの beforeEach で 'light' に戻す）
 */
export const mockColorScheme = (scheme: 'light' | 'dark' | null) => {
  const fn = useColorScheme as jest.MockedFunction<typeof useColorScheme>;
  fn.mockReset();
  fn.mockImplementation(() => scheme);
};

// Pressable の「押している間」を起こす。fireEvent.press は onPress を直接呼ぶだけで Pressable の pressed 状態を変えないので、
// ホストの View が持つ Pressability の responder ハンドラ（onResponderGrant / onResponderRelease）に、RN が渡すのと同じ形の
// タッチイベントを流す（@testing-library/react-native の userEvent.press が内部で行っているのと同じ）。
// Pressable は離してから最短 130ms（minPressDuration）後に pressed を戻すので、pressOut の後は偽のタイマーを進めること
const touchEvent = (registrationName: string) => ({
  dispatchConfig: { registrationName },
  nativeEvent: {
    changedTouches: [],
    identifier: 0,
    locationX: 0,
    locationY: 0,
    pageX: 0,
    pageY: 0,
    target: 0,
    timestamp: Date.now(),
    touches: [],
  },
  currentTarget: { measure: () => {} },
  persist: () => {},
});

/** 指を置く（pressed になる） */
export const pressIn = (button: Instance) =>
  fireEvent(button, 'responderGrant', touchEvent('onResponderGrant'));

/** 指を離す（pressed が戻るのは最短 130ms 後） */
export const pressOut = (button: Instance) =>
  fireEvent(button, 'responderRelease', touchEvent('onResponderRelease'));

/** {@link mockTiming} が記録する 1 回のアニメーション */
export type StartedTiming = {
  toValue: unknown;
  config: Animated.TimingAnimationConfig;
  /** 完了を起こす（`finished: false` は stop されたときの完了） */
  finish: (finished: boolean) => void;
  stop: jest.Mock;
};

/**
 * `Animated.timing` を、完了を手で起こせる偽のアニメーションに差し替える（開閉の順序を確かめるため。
 * jest では native driver の timing の完了が観測しにくい）
 */
export const mockTiming = () => {
  const started: StartedTiming[] = [];
  const spy = jest
    .spyOn(Animated, 'timing')
    .mockImplementation((_value, config) => {
      const entry: StartedTiming = {
        toValue: config.toValue,
        config,
        finish: () => {},
        stop: jest.fn(),
      };
      started.push(entry);
      return {
        start: (callback?: (result: { finished: boolean }) => void) => {
          entry.finish = (finished) => callback?.({ finished });
        },
        stop: entry.stop,
        reset: () => {},
      } as unknown as Animated.CompositeAnimation;
    });
  return { spy, started };
};
