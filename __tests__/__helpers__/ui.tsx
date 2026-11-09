// デフォルト UI（3b）のテスト用。ライブラリの Modal の枠（オーバーレイ・a11y の容れ物）と、その中身（カード / シート）を
// 取り出す。testID は src に足さない（利用者のビュー階層に残るため）ので、a11y の属性と構造で辿る。
// @testing-library/react-native 14 のツリーはホストの要素だけ（type は 'Modal' / 'View' / 'Text' / 'Image' などの文字列）
import { fireEvent, screen } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';

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

/** 描画されているライブラリの Modal（無ければ null） */
export const queryModal = (): Instance | null =>
  all((node) => node.type === 'Modal')[0] ?? null;

/** 描画されているライブラリの Modal（無ければ throw） */
export const getModal = (): Instance => {
  const modal = queryModal();
  if (modal === null) {
    throw new Error('no Modal is rendered');
  }
  return modal;
};

/** オーバーレイ（読み上げから外したホストの View。Warning ではタップで dismiss） */
export const getOverlay = (): Instance =>
  only(
    getModal().queryAll(
      (node) => node.props.accessibilityElementsHidden === true
    ),
    'overlay'
  );

/** a11y の容れ物（`accessibilityViewIsModal` を持つホストの View。中身の配置もここ） */
export const getDialogContainer = (): Instance =>
  only(
    getModal().queryAll((node) => node.props.accessibilityViewIsModal === true),
    'dialog container'
  );

/** ホストの子要素（文字列は除く） */
export const hostChildren = (node: Instance): Instance[] =>
  node.children.filter((child): child is Instance => typeof child !== 'string');

/** 容れ物の直下のホストの要素（デフォルト UI ではカード / シート、`components` では差し替えたコンポーネントの最初のホスト要素） */
export const getDialog = (): Instance =>
  only(hostChildren(getDialogContainer()), 'child in the dialog container');

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
