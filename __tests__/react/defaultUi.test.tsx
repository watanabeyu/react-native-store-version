// デフォルト UI の共有部品（3b）: 配色がモックの renderVals() と一致する（実測値の対応表）、Provider の外では描けない
import { render } from '@testing-library/react-native';
import { FORCE_OVERLAY_COLOR } from '../../src/react/DefaultForceModal.tsx';
import { WARNING_OVERLAY_COLOR } from '../../src/react/DefaultWarningSheet.tsx';
import {
  BUTTON_TEXT_COLOR,
  PALETTES,
  useDefaultUiContext,
} from '../../src/react/defaultUi.tsx';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('../__helpers__/platform').platformModule
);

const Outside = () => {
  useDefaultUiContext();
  return null;
};

describe('PALETTES: the colors of Main.dc.html / Warning.dc.html renderVals()', () => {
  it('light', () => {
    expect(PALETTES.light).toEqual({
      card: '#FFFFFF',
      text: '#18181B',
      sub: '#52525B',
      primary: '#1D4ED8',
      iconBg: '#DBEAFE',
      handle: '#D4D4D8',
      secondaryText: '#1D4ED8',
    });
  });

  it('dark', () => {
    expect(PALETTES.dark).toEqual({
      card: '#27272A',
      text: '#FAFAFA',
      sub: '#D4D4D8',
      primary: '#2563EB',
      iconBg: '#1E3A8A',
      handle: '#52525B',
      secondaryText: '#93C5FD',
    });
  });

  it('fixed colors: button text white, overlays .55 / .35', () => {
    expect(BUTTON_TEXT_COLOR).toBe('#FFFFFF');
    expect(FORCE_OVERLAY_COLOR).toBe('rgba(0, 0, 0, 0.55)');
    expect(WARNING_OVERLAY_COLOR).toBe('rgba(0, 0, 0, 0.35)');
  });
});

describe('useDefaultUiContext', () => {
  it('throws outside the Provider (unreachable through the public API)', async () => {
    // React は描画中のエラーを console.error に出すので、このテストでは黙らせる
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render(<Outside />)).rejects.toThrow(
      'the default UI of react-native-store-version must be rendered by <StoreVersionProvider>'
    );
  });
});
