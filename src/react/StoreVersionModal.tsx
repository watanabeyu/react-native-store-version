// デフォルト UI の Modal の枠（D50 ⑪、D53）。Provider はこれを 1 つだけ描き、Force / Warning はこの中で中身だけが入れ替わる
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
 * （none / 判定前 / skipped / error）は無し（失敗・タイムアウトでは UI を出さない。原則 3）。
 * 再チェック中も前回の `action` が残るので Force は消えない（D51 ①）
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
 * 「視差効果を減らす」（iOS）/「アニメーションを無効化」（Android）の設定。変化も追い、アンマウントで購読を外す。
 * 取得できるまでは false（動かす）
 */
export const useReduceMotion = (): boolean => {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (active) {
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
      active = false;
      subscription.remove();
    };
  }, []);
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
export const StoreVersionModal = () => {
  const context = useDefaultUiContext();
  const { state, display } = context;
  const kind = uiKindOf(state);
  const reduceMotion = useReduceMotion();
  const { height: windowHeight } = useWindowDimensions();

  // 描いている種類。閉じるアニメーションの間は、出すものが無くなった後も前の種類を描き続ける。
  // 開くときは同じ描画で中身を出す（描画中の自分の setState。前の描画の値から導く React の書き方）
  const [shown, setShown] = useState<UiKind | null>(kind);
  if (kind !== null && kind !== shown) {
    setShown(kind);
  }

  // 出している間の props を保存し、閉じている間（kind が null）は最後の値で描く。描画中に書く ref（前の描画の値から導くだけ）
  const propsRef = useRef<ContentProps | null>(null);
  if (kind !== null && state.local !== null) {
    propsRef.current = propsFor(context, state.local);
  }
  const saved = propsRef.current;

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
            isWarning ? styles.bottom : styles.center,
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
  // Force: 画面の縦中央（モックの top 268px は 844pt の画面での値なので、中央寄せに読み替える。D50 ⑩）。
  // カードの左右 24 はモックの left / right 24（カード側ではなくここで取る）
  center: {
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  // Warning: 下寄せ
  bottom: {
    justifyContent: 'flex-end',
  },
});
