// react-native の Linking のモック。@react-native/jest-preset が Linking を jest.fn() の集まりに差し替えているので、
// それを使う（src も同じオブジェクトを import する）。jest.fn() は restoreMocks では元に戻らないので、
// ここで毎回 mockReset してから実装を入れる（前のテストの実装が残らないようにする）
import { Linking } from 'react-native';

/** `Linking.openURL` の実装を差し替える。既定は成功（resolve） */
export const mockOpenURL = (
  impl: (url: string) => Promise<void> = async () => {}
) => {
  const fn = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;
  fn.mockReset();
  fn.mockImplementation(impl);
  return fn;
};

/** `Linking.canOpenURL` の呼び出しを見る（src が頼っていないことの確認用） */
export const canOpenURLMock = () =>
  Linking.canOpenURL as jest.MockedFunction<typeof Linking.canOpenURL>;
