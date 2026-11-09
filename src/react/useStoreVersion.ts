// Provider が持つ判定結果を配下に配る Context と、それを読むだけの hook（4.2）。
// 判定は Provider が 1 つだけ持つので、hook を何箇所で使っても fetch は増えない
import { type ComponentType, createContext, useContext } from 'react';
import type { ColorValue, ImageSourcePropType } from 'react-native';

import type { CompareDetail, CompareResult, DiffType } from '../compare.ts';
import type { StoreVersionError } from '../errors.ts';
import type { Action } from '../policy.ts';
import type {
  StoreVersionForceTexts,
  StoreVersionTexts,
  StoreVersionWarningTexts,
} from './texts.ts';

/**
 * 進行状態。
 * - `idle`: まだ判定していない（マウント直後。バックグラウンドのままマウントされたら active になるまで）
 * - `checking`: 判定中
 * - `ready`: 判定できた（`result` / `action` などに値が入る）
 * - `skipped`: 判定しない環境（web / ios・android 以外の OS / Expo Go / `enabled={false}`）。`onError` は呼ばない
 * - `error`: 判定できなかった（`error` に理由。UI は出さない）
 */
export type StoreVersionStatus =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'skipped'
  | 'error';

/** {@link useStoreVersion} の戻り値 */
export type UseStoreVersionResult = {
  /** 進行状態 */
  status: StoreVersionStatus;
  /**
   * 比較の結果（`ready` のときのみ。再チェック中の `checking` では前回の ready の値）。v1 の `checkVersion()` と同じ値で、policy では変わらない。
   * 最新バージョンが比較できず、最低バージョンで force になったときは null
   */
  result: CompareResult | null;
  /** v1 の `checkVersion()` と同じ `detail`（`result` と同じく、ready と再チェック中のみ） */
  detail: CompareDetail | null;
  /**
   * policy と最低バージョンを当てた結果（`result` と同じく、ready と再チェック中のみ）。デフォルト UI はこれで出す。
   * 再チェックの間も前回の値のままなので、force のモーダルは再チェック中に消えない
   */
  action: Action | null;
  /** 差分の種類（`result` が `'new'` のときのみ） */
  diff: DiffType | null;
  /** `action` が `warning` だが「あとで」（`dismiss`）が押されて UI を出していない。remote が変われば false に戻る */
  dismissed: boolean;
  /** アプリのバージョン（ネイティブのバージョン）。判定を始めた後に入る */
  local: string | null;
  /** 最新バージョン（`result` と同じく、ready と再チェック中のみ） */
  remote: string | null;
  /** 開くべきストアの URL（`result` と同じく、ready と再チェック中のみ）。iOS で URL を取得中・取得に失敗したときは null（4.5） */
  storeUrl: string | null;
  /** iOS でストアのバージョンを使ったときの `releaseNotes`（`result` と同じく、ready と再チェック中のみ）。Android と `getLatestVersion` 使用時は undefined */
  releaseNotes: string | undefined;
  /**
   * ストアのアプリのページを開く。iOS で URL を取得中なら待ち、取れていなければその場でもう一度 lookup する。
   * 開けたら true、開けなかったら false で resolve する（reject しない。`onPress={openStore}` のまま使える）。
   * 失敗（iOS の lookup の失敗・`Linking.openURL` の失敗・判定前や skipped で開く先が分からない）は
   * `STORE_URL_UNAVAILABLE` で `onError` に渡す。`status` / `error` は変えない
   */
  openStore: () => Promise<boolean>;
  /** warning を閉じる（同じ remote のバージョンの間は出さない。メモリだけに持つので、次に起動したら再び出る） */
  dismiss: () => void;
  /**
   * 手動で再チェックする（判定中なら、それを取り消してやり直す）。再チェックの間も前回の結果は残り、失敗したら前回の結果に戻る。
   * バックグラウンドの間に呼ばれたら、active になってから始める
   */
  recheck: () => void;
  /** 判定できなかった理由（`error` のときのみ。再チェックの失敗では前回の結果に戻るので入らない。`onError` には渡る） */
  error: StoreVersionError | null;
};

/**
 * `components.Force` に渡す props。このコンポーネントが描くのはカードの中身だけで、Modal・幕・配置・
 * Android の戻るボタンで閉じないこと・開閉のアニメーションはライブラリが持つ（D50 ⑪、D53）。
 * 置かれ方: 左右 24 の余白の内側で画面の縦中央、ScrollView の中。カードの面（背景・角丸・影・最大幅 480）はライブラリは掛けないので、
 * このコンポーネントが自分で描く
 */
export type StoreVersionForceProps = {
  local: string;
  /** 最新バージョン。Play の版が比較できず、最低バージョンで force になったときは null */
  remote: string | null;
  storeUrl: string | null;
  releaseNotes: string | undefined;
  /** `{remote}` / `{local}` を置き換え済みの文言 */
  texts: StoreVersionForceTexts;
  icon: ImageSourcePropType | undefined;
  /** 開けたら true、開けなかったら false（reject しない。失敗は `onError` に渡る） */
  openStore: () => Promise<boolean>;
};

/**
 * `components.Warning` に渡す props。Force の props に加えて `dismiss`（「あとで」）。このコンポーネントが描くのはシートの中身だけで、
 * Modal・幕・配置・戻るボタン / 背景タップで `dismiss` すること・開閉のアニメーションはライブラリが持つ（D50 ⑪、D53）。
 * 置かれ方: 画面幅で下寄せ、ScrollView の中。シートの面（背景・角丸・影・最大幅 480）はライブラリは掛けないので、
 * このコンポーネントが自分で描く
 */
export type StoreVersionWarningProps = Omit<StoreVersionForceProps, 'texts'> & {
  /** `{remote}` / `{local}` を置き換え済みの文言 */
  texts: StoreVersionWarningTexts;
  dismiss: () => void;
};

/**
 * デフォルト UI の中身の差し替え。差し替えられるのはカード（Force）/ シート（Warning）の中身だけ。
 * Modal、幕（オーバーレイ）の色、配置、Android の戻るボタンと背景タップの扱い（Force は閉じない、Warning は `dismiss`）、
 * 開閉のアニメーションはライブラリが持ち、差し替えても変わらない（D50 ⑪、D53）。
 * 置かれ方: Force は左右 24 の余白の内側で画面の縦中央、Warning は画面幅で下寄せ。どちらも ScrollView の中。
 * カード / シートの面（背景・角丸・影・最大幅 480）はライブラリは掛けないので、差し替えたコンポーネントが自分で描く
 */
export type StoreVersionComponents = {
  Force?: ComponentType<StoreVersionForceProps>;
  Warning?: ComponentType<StoreVersionWarningProps>;
};

/** デフォルト UI に渡す表示の設定（Provider の props をそのまま置く） */
export type StoreVersionDisplay = {
  ui: boolean;
  texts: StoreVersionTexts | undefined;
  icon: ImageSourcePropType | undefined;
  components: StoreVersionComponents | undefined;
  primaryColor: ColorValue | undefined;
};

/**
 * 判定の状態の Context（hook が読む。パッケージの入口からは export しない）。
 * 表示の設定とは分けてある（インラインの `texts` などで Provider が描画し直しても、hook を使う側を描画し直さないように）
 */
export const StoreVersionStateContext =
  createContext<UseStoreVersionResult | null>(null);
StoreVersionStateContext.displayName = 'StoreVersionStateContext';

/** 表示の設定の Context（デフォルト UI が読む。パッケージの入口からは export しない） */
export const StoreVersionDisplayContext =
  createContext<StoreVersionDisplay | null>(null);
StoreVersionDisplayContext.displayName = 'StoreVersionDisplayContext';

/**
 * `StoreVersionProvider` が持つ判定結果を読む。Provider 配下ならどこでも呼べ、何箇所で呼んでも fetch は増えない。
 * Provider の外で呼ぶと throw する
 */
export const useStoreVersion = (): UseStoreVersionResult => {
  const state = useContext(StoreVersionStateContext);
  if (state === null) {
    throw new Error(
      'useStoreVersion() must be called inside <StoreVersionProvider>. Wrap your app (or the component tree that calls it) with <StoreVersionProvider> from react-native-store-version.'
    );
  }
  return state;
};
