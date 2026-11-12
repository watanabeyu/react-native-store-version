// デフォルト UI の Modal の枠。Provider はこれを 1 つだけ描き、Force / Warning はこの中で中身だけが入れ替わる
// （Force と Warning で別々の Modal を出すと、iOS では前の Modal の dismiss と次の present が重なって次が出ないことがある）。
// ライブラリが持つもの: Modal、幕（オーバーレイ）とその色、中身の配置（Force は縦中央、Warning は下寄せ）、
// 戻るボタン・背景タップ・VoiceOver の escape の扱い、a11y の属性、開閉のアニメーション。`components` で差し替えられるのは中身だけ
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { FORCE_OVERLAY_COLOR, ForceCard } from './DefaultForceModal.tsx';
import { WARNING_OVERLAY_COLOR, WarningSheet } from './DefaultWarningSheet.tsx';
import {
  type DefaultUiContext,
  normalizeIcon,
  useDefaultUiContext,
} from './defaultUi.tsx';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect.ts';
import type {
  StoreVersionForceProps,
  StoreVersionWarningProps,
  UseStoreVersionResult,
} from './useStoreVersion.ts';

/** 出している UI の種類 */
export type UiKind = 'force' | 'warning';

/** 開閉のアニメーションの時間（ms） */
export const ANIMATION_DURATION_MS = 250;

/**
 * iOS の Modal が対応する向き。RN の既定は portrait だけで、横向き専用のアプリでは Modal を出した瞬間に落ちる
 * （"Supported orientations has no common orientation with the application"）ので、すべて渡す
 */
export const SUPPORTED_ORIENTATIONS = [
  'portrait',
  'portrait-upside-down',
  'landscape',
  'landscape-left',
  'landscape-right',
] as const;

/**
 * 出すべき UI。force なら Force、warning で「あとで」が押されていなければ Warning、それ以外
 * （none / 判定前 / skipped / error）は無し（失敗・タイムアウトでは UI を出さない）。
 * 再チェック中も前回の `action` が残るので Force は消えない
 */
export const uiKindOf = (state: UseStoreVersionResult): UiKind | null => {
  if (state.local === null) {
    return null;
  }
  if (state.action === 'force') {
    return 'force';
  }
  if (state.action === 'warning' && !state.dismissed) {
    return 'warning';
  }
  return null;
};

// Android の戻るボタンでは閉じない（Force）
const ignoreRequestClose = () => {};

/**
 * 「視差効果を減らす」（iOS）/「アニメーションを無効化」（Android）の設定。変化も追い、`active` が false になったときと
 * アンマウントで購読を外す。`active` が false の間は取得も購読もしない（Provider が `ui` かつ skipped でないときだけ true にする）。
 * 取得できるまで・取れない環境では false（動かす）
 */
export const useReduceMotion = (active: boolean): boolean => {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    if (!active) {
      return;
    }
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (live) {
          setReduceMotion(enabled);
        }
      },
      () => {
        // 取れない環境では動かす
      }
    );
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => {
      live = false;
      subscription.remove();
    };
  }, [active]);
  return reduceMotion;
};

/** 中身（カード / シート、または `components`）に渡す props */
type ContentProps = {
  force: StoreVersionForceProps;
  warning: StoreVersionWarningProps;
};

/** 中身に渡す props を作る（`local` は出すものがあるときは必ずある） */
const propsFor = (
  { state, display, texts }: DefaultUiContext,
  local: string
): ContentProps => {
  const base = {
    local,
    remote: state.remote,
    storeUrl: state.storeUrl,
    releaseNotes: state.releaseNotes,
    icon: normalizeIcon(display.icon),
    openStore: state.openStore,
  };
  const force: StoreVersionForceProps = { ...base, texts: texts.force };
  const warning: StoreVersionWarningProps = {
    ...base,
    texts: texts.warning,
    dismiss: state.dismiss,
  };
  return { force, warning };
};

/**
 * デフォルト UI の Modal。Provider が初めて出すものができたときにマウントし、以後はマウントしたまま
 * （出すものが無い間は `visible={false}` で何も描かない。skipped や判定前はマウントもしない）。
 * 「視差効果を減らす」は Provider が購読して props で受け取る（マウントと同じ commit で開くので、ここで取りに行くと初回に間に合わない）。
 *
 * - 中身の props（`local` / `remote` / `storeUrl` / 文言 / `openStore` / `dismiss`）は出している間に作ったものを保存し、
 *   閉じるアニメーションの間は最後の値のまま描く（`enabled` を false にした経路では engine が `local` / `remote` / `storeUrl` を
 *   null にするので、そのまま読むと閉じる途中で本文が変わり、`components` に `local: ''` が渡ってしまう）
 *
 * - 開くとき: 幕は opacity 0 → 1、Force のカードは opacity 0 → 1、Warning のシートは画面の高さ分下から translateY → 0（250ms、native driver）
 * - 閉じるとき（`action` が force / warning でなくなる、Warning が dismiss される）: 逆のアニメーションを走らせ、終わってから `visible={false}`
 * - Force ⇄ Warning の切り替えでは Modal を閉じず、中身だけを入れ替える（切り替え自体はアニメーションしない）
 * - 「視差効果を減らす」が有効なら動かさず、すぐに開閉する
 * - 中身は ScrollView に入れる（大きいフォントや横向きでもボタンまで届くように）。Warning は ScrollView の空いたところのタップでも `dismiss`
 * - `components` で差し替えた中身にも同じアニメーションを外側のラッパーでかける
 */
export const StoreVersionModal = ({
  reduceMotion,
}: {
  /** 「視差効果を減らす」の設定（Provider が {@link useReduceMotion} で購読した値）。true なら開閉を動かさない */
  reduceMotion: boolean;
}) => {
  const context = useDefaultUiContext();
  const { state, display } = context;
  const kind = uiKindOf(state);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const inset = overflowInsetFor(windowWidth, windowHeight);

  // 描いている種類。閉じるアニメーションの間は、出すものが無くなった後も前の種類を描き続ける。
  // 開くときは同じ描画で中身を出す（描画中の自分の setState。前の描画の値から導く React の書き方）
  const [shown, setShown] = useState<UiKind | null>(kind);
  if (kind !== null && kind !== shown) {
    setShown(kind);
  }

  // 出している間の props は描画で作り、commit の後に最後の値として保存する（layout effect。描画中には ref に書かない）。
  // 閉じている間（kind が null）は保存した最後の値で描く（描画中に ref を読むが、読むのは commit 済みの描画が書いた値だけ）
  const current =
    kind !== null && state.local !== null
      ? propsFor(context, state.local)
      : null;
  const lastRef = useRef<ContentProps | null>(null);
  useIsomorphicLayoutEffect(() => {
    if (current !== null) {
      lastRef.current = current;
    }
  });
  const saved = current ?? lastRef.current;

  // 幕と中身は 0 から始めて、マウント直後の effect で 1 へ動かす（Provider は初めて出すものができたときにマウントする）
  const progress = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  // 設定は開閉のときに読むだけにする（表示中に設定が変わっても、走っているアニメーションを止めたりやり直したりしない）。
  // この effect は下の開閉の effect より先に宣言してあるので、同じ commit では先に更新される
  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
  }, [reduceMotion]);

  useEffect(() => {
    if (kind !== null) {
      openRef.current = true;
      if (reduceMotionRef.current) {
        progress.setValue(1);
        return;
      }
      const animation = Animated.timing(progress, {
        toValue: 1,
        duration: ANIMATION_DURATION_MS,
        useNativeDriver: true,
      });
      animation.start();
      return () => animation.stop();
    }
    if (!openRef.current) {
      return;
    }
    openRef.current = false;
    if (reduceMotionRef.current) {
      progress.setValue(0);
      setShown(null);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: ANIMATION_DURATION_MS,
      useNativeDriver: true,
    });
    // 途中でまた開くことになったら stop され（finished: false）、閉じない
    animation.start(({ finished }) => {
      if (finished) {
        setShown(null);
      }
    });
    return () => animation.stop();
  }, [kind, progress]);

  // Warning のシートは画面の高さ分（シートの高さに関わらず画面の外になる値）下から出る
  const slide = useMemo(
    () => ({
      transform: [
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [windowHeight, 0],
          }),
        },
      ],
    }),
    [progress, windowHeight]
  );

  const isWarning = shown === 'warning';
  // 閉じる途中の戻るボタン・背景タップ・escape も、保存した props の dismiss（engine の関数）のまま
  const dismiss = saved?.warning.dismiss ?? ignoreRequestClose;
  const Force = display.components?.Force;
  const Warning = display.components?.Warning;
  const content =
    shown === null || saved === null ? null : isWarning ? (
      Warning ? (
        <Warning {...saved.warning} />
      ) : (
        <WarningSheet {...saved.warning} />
      )
    ) : Force ? (
      <Force {...saved.force} />
    ) : (
      <ForceCard {...saved.force} />
    );

  return (
    <Modal
      visible={shown !== null}
      transparent
      // 幕と中身は自前でアニメーションするので Modal 自体は動かさない
      animationType="none"
      // Android の透過 Modal は既定でステータスバーの下まで広がらず、そこだけ暗くならない帯になるので広げる（iOS では無視される）
      statusBarTranslucent
      supportedOrientations={[...SUPPORTED_ORIENTATIONS]}
      onRequestClose={isWarning ? dismiss : ignoreRequestClose}
    >
      {/* 幕。見た目だけで、タッチは受けない（背景のタップは下の ScrollView の中で受ける） */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.overlay,
          {
            backgroundColor: isWarning
              ? WARNING_OVERLAY_COLOR
              : FORCE_OVERLAY_COLOR,
            opacity: progress,
          },
        ]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
      {/* a11y の容れ物。VoiceOver / TalkBack は幕の後ろに行かない。Warning は 2 本指 Z（escape）でも閉じる */}
      <View
        style={styles.fill}
        accessibilityViewIsModal
        onAccessibilityEscape={isWarning ? dismiss : undefined}
      >
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[
            styles.content,
            isWarning
              ? [styles.bottom, { paddingTop: inset }]
              : [styles.center, { paddingVertical: inset }],
          ]}
          bounces={false}
          keyboardShouldPersistTaps="handled"
        >
          {isWarning ? (
            // 背景（中身の無いところ）のタップで dismiss。ScrollView の中に置くので、スクロールしても空いたところはすべて背景
            <Pressable
              style={styles.overlay}
              onPress={dismiss}
              accessible={false}
              // 読み上げから外すのと同じ理由で、キーボード / D-pad のフォーカスも受けない（Pressable の既定は focusable）
              focusable={false}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            />
          ) : null}
          <Animated.View style={isWarning ? slide : { opacity: progress }}>
            {content}
          </Animated.View>
        </ScrollView>
      </View>
    </Modal>
  );
};

/**
 * 中身が画面より高くなったとき（大きいフォントなど）に、端をシステムの領域から外すための余白（Force は上下、Warning は上）。
 * react-native-safe-area-context には依存しないので固定値にする。
 * - 縦向き: 72。ステータスバー / ノッチ / Dynamic Island（上の領域は機種により 60pt 台）と Android の edge-to-edge の
 *   ステータスバーを覆う
 * - 横向き: 24。iPhone の横向きは上にステータスバーが無く、Android の横向きのステータスバー（24dp）だけを覆う
 * 中身が「画面の高さ − 余白」に収まるときは、配置（Force は中央、Warning は下寄せ）の見た目は変わらない
 */
export const overflowInsetFor = (width: number, height: number): number =>
  width > height ? 24 : 72;

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  // 画面いっぱい（StyleSheet.absoluteFill と同じ。RN 0.88 の型には absoluteFillObject が無いので書き下す）
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // 中身が画面より低いときは画面いっぱいに広げて配置し、高いときはスクロールする
  content: {
    flexGrow: 1,
  },
  // Force: 画面の縦中央（デザインの top 268px は 844pt の画面での値なので、中央寄せに読み替える）。
  // カードの左右 24 はデザインの left / right 24（カード側ではなくここで取る）。上下の余白は overflowInsetFor
  center: {
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  // Warning: 下寄せ。上の余白は overflowInsetFor。下はシートの padding 40 で、iOS のホームインジケータ（34pt）と
  // Android のジェスチャーナビは吸収する。Android の 3 ボタンのナビゲーションバー（48dp）では「あとで」の押せる範囲の
  // 下の端がバーに少し重なる（文字は見え、押せることを Android エミュレータで確認）
  bottom: {
    justifyContent: 'flex-end',
  },
});
