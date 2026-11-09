// サーバーでの描画（react-native-web の SSR など）では useLayoutEffect が React 18 で警告を出すので、window が無ければ useEffect にする。
// Provider（props の ref）とデフォルト UI の Modal（閉じる途中に描く最後の props）が、commit の後・配下の passive effect より先に ref を書くために使う
import { useEffect, useLayoutEffect } from 'react';

export const useIsomorphicLayoutEffect =
  (globalThis as { window?: unknown }).window === undefined
    ? useEffect
    : useLayoutEffect;
