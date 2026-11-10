// デフォルト UI の共有部品: 配色がモックの renderVals() と一致する（実測値の対応表）、影の読み替え（iOS は shadow、
// Android は elevation。Platform.select はモジュール読み込み時に評価されるので isolateModules で読み直す）、Provider の外では描けない
import { render } from '@testing-library/react-native';
import {
  cardShadow,
  FORCE_OVERLAY_COLOR,
} from '../../src/react/DefaultForceModal.tsx';
import {
  sheetShadow,
  WARNING_OVERLAY_COLOR,
} from '../../src/react/DefaultWarningSheet.tsx';
import {
  BUTTON_TEXT_COLOR,
  MAX_CONTENT_WIDTH,
  normalizeIcon,
  PALETTES,
  useDefaultUiContext,
} from '../../src/react/defaultUi.tsx';
import { setPlatform } from '../__helpers__/platform.ts';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('../__helpers__/platform').platformModule
);

const Outside = () => {
  useDefaultUiContext();
  return null;
};

describe('PALETTES: the colors of the Force / Warning mock renderVals()', () => {
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

  it('fixed values: button text white, overlays .55 / .35, max width 480', () => {
    expect(BUTTON_TEXT_COLOR).toBe('#FFFFFF');
    expect(FORCE_OVERLAY_COLOR).toBe('rgba(0, 0, 0, 0.55)');
    expect(WARNING_OVERLAY_COLOR).toBe('rgba(0, 0, 0, 0.35)');
    expect(MAX_CONTENT_WIDTH).toBe(480);
  });
});

describe('shadows', () => {
  it('iOS: the mock box-shadows as shadow* (the test files load with Platform ios)', () => {
    expect(cardShadow).toEqual({
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.3,
      shadowRadius: 40,
    });
    expect(sheetShadow).toEqual({
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.2,
      shadowRadius: 32,
    });
  });

  it('Android: elevation 12 (card) / 8 (sheet)', () => {
    setPlatform('android');
    try {
      jest.isolateModules(() => {
        const force = require('../../src/react/DefaultForceModal.tsx') as {
          cardShadow: unknown;
        };
        const warning = require('../../src/react/DefaultWarningSheet.tsx') as {
          sheetShadow: unknown;
        };
        expect(force.cardShadow).toEqual({ elevation: 12 });
        expect(warning.sheetShadow).toEqual({ elevation: 8 });
      });
    } finally {
      setPlatform('ios');
    }
  });
});

describe('normalizeIcon', () => {
  it('turns null / false into undefined and keeps a source', () => {
    const source = { uri: 'x' };
    expect(normalizeIcon(source)).toBe(source);
    expect(normalizeIcon(1)).toBe(1);
    expect(normalizeIcon(undefined)).toBeUndefined();
    expect(normalizeIcon(null as unknown as undefined)).toBeUndefined();
    expect(normalizeIcon(false as unknown as undefined)).toBeUndefined();
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
