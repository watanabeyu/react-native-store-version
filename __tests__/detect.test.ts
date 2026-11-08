import {
  detect,
  detectApp,
  EXPO_GO_APPLICATION_ID,
  getSkipReason,
} from '../src/detect.ts';
import { StoreVersionError } from '../src/errors.ts';
import { setOptionalModules } from './__helpers__/modules.ts';
import { setPlatform } from './__helpers__/platform.ts';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('./__helpers__/platform').platformModule
);

const expoApplication = {
  nativeApplicationVersion: '1.2.3',
  applicationId: 'com.example.expo',
};

const deviceInfo = {
  getVersion: () => '4.5.6',
  getBundleId: () => 'com.example.deviceinfo',
};

const catchError = (fn: () => unknown): StoreVersionError => {
  try {
    fn();
  } catch (e) {
    return e as StoreVersionError;
  }
  throw new Error('did not throw');
};

beforeEach(() => {
  setPlatform('ios');
  setOptionalModules();
});

describe('detect (auto detection)', () => {
  it('uses expo-application when it is installed', () => {
    setOptionalModules({
      'expo-application': expoApplication,
      'react-native-device-info': deviceInfo,
    });
    expect(detect()).toEqual({
      skipped: null,
      platform: 'ios',
      version: '1.2.3',
      appId: 'com.example.expo',
    });
  });

  it('uses expo-application in the default export shape', () => {
    setOptionalModules({ 'expo-application': { default: expoApplication } });
    expect(detect()).toMatchObject({
      version: '1.2.3',
      appId: 'com.example.expo',
    });
  });

  it('uses react-native-device-info when only it is installed', () => {
    setPlatform('android');
    setOptionalModules({ 'react-native-device-info': deviceInfo });
    expect(detect()).toEqual({
      skipped: null,
      platform: 'android',
      version: '4.5.6',
      appId: 'com.example.deviceinfo',
    });
  });

  it('uses react-native-device-info in the default export shape', () => {
    setOptionalModules({ 'react-native-device-info': { default: deviceInfo } });
    expect(detect()).toMatchObject({
      version: '4.5.6',
      appId: 'com.example.deviceinfo',
    });
  });

  it('falls back to react-native-device-info per value when expo-application returns null', () => {
    setOptionalModules({
      'expo-application': {
        nativeApplicationVersion: null,
        applicationId: 'com.example.expo',
      },
      'react-native-device-info': deviceInfo,
    });
    expect(detect()).toMatchObject({
      version: '4.5.6',
      appId: 'com.example.expo',
    });
  });

  it('treats react-native-device-info that throws (no native module) as unavailable', () => {
    setOptionalModules({
      'react-native-device-info': {
        getVersion: () => {
          throw new Error('NativeModule.RNDeviceInfo is null');
        },
        getBundleId: () => 'com.example.deviceinfo',
      },
    });
    expect(catchError(() => detect()).code).toBe('LOCAL_VERSION_UNAVAILABLE');
  });

  it('ignores a module that is not an object', () => {
    setOptionalModules({
      'expo-application': 0 as never,
      'react-native-device-info': deviceInfo,
    });
    expect(detect()).toMatchObject({
      version: '4.5.6',
      appId: 'com.example.deviceinfo',
    });
  });

  it('throws LOCAL_VERSION_UNAVAILABLE saying what to pass when neither is installed', () => {
    const error = catchError(() => detect());
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error.code).toBe('LOCAL_VERSION_UNAVAILABLE');
    expect(error.message).toContain('expo-application');
    expect(error.message).toContain('react-native-device-info');
    expect(error.message).toContain('`version`');
    expect(error.message).toContain('CFBundleShortVersionString');
  });

  it('names versionName on Android', () => {
    setPlatform('android');
    expect(catchError(() => detect()).message).toContain('versionName');
  });

  it.each([
    ['ios', 'bundle ID', '`bundleId`'],
    ['android', 'package name', '`packageName`'],
  ] as const)(
    'throws LOCAL_VERSION_UNAVAILABLE for a missing ID on %s',
    (os, what, param) => {
      setPlatform(os);
      const error = catchError(() => detect({ version: '1.0.0' }));
      expect(error.code).toBe('LOCAL_VERSION_UNAVAILABLE');
      expect(error.message).toContain(what);
      expect(error.message).toContain(param);
    }
  );
});

describe('detect (explicit values)', () => {
  it('prefers the explicit values to expo-application', () => {
    setOptionalModules({ 'expo-application': expoApplication });
    expect(detect({ version: '9.9.9', bundleId: 'com.explicit' })).toEqual({
      skipped: null,
      platform: 'ios',
      version: '9.9.9',
      appId: 'com.explicit',
    });
  });

  it('uses packageName on Android and ignores bundleId', () => {
    setPlatform('android');
    expect(
      detect({
        version: '9.9.9',
        bundleId: 'com.ios',
        packageName: 'com.android',
      })
    ).toMatchObject({ appId: 'com.android' });
  });

  it('works with explicit values and no optional modules', () => {
    expect(detect({ version: '1.0.0', bundleId: 'com.explicit' })).toEqual({
      skipped: null,
      platform: 'ios',
      version: '1.0.0',
      appId: 'com.explicit',
    });
  });

  it('mixes an explicit value with an auto-detected one', () => {
    setOptionalModules({ 'react-native-device-info': deviceInfo });
    expect(detect({ version: '9.9.9' })).toMatchObject({
      version: '9.9.9',
      appId: 'com.example.deviceinfo',
    });
  });

  it('treats an empty string as not given', () => {
    setOptionalModules({ 'expo-application': expoApplication });
    expect(detect({ version: '', bundleId: '' })).toMatchObject({
      version: '1.2.3',
      appId: 'com.example.expo',
    });
  });
});

describe('detect (skipped)', () => {
  it('skips on web', () => {
    setPlatform('web');
    setOptionalModules({ 'expo-application': expoApplication });
    expect(detect()).toEqual({ skipped: 'web' });
  });

  it.each(['windows', 'macos'] as const)('skips on %s (D47)', (os) => {
    setPlatform(os);
    expect(detect({ version: '1.0.0', bundleId: 'x' })).toEqual({
      skipped: 'unsupported-platform',
    });
  });

  it('skips in Expo Go, even with explicit values', () => {
    setOptionalModules({
      'expo-application': {
        nativeApplicationVersion: '2.32.0',
        applicationId: EXPO_GO_APPLICATION_ID,
      },
    });
    expect(EXPO_GO_APPLICATION_ID).toBe('host.exp.exponent');
    expect(detect()).toEqual({ skipped: 'expo-go' });
    expect(detect({ version: '1.0.0', bundleId: 'com.explicit' })).toEqual({
      skipped: 'expo-go',
    });
  });

  it('does not skip on ios / android with a normal app', () => {
    setOptionalModules({ 'expo-application': expoApplication });
    expect(getSkipReason('ios')).toBeNull();
    expect(getSkipReason('android')).toBeNull();
  });
});

describe('detectApp', () => {
  it('takes the platform as an argument (does not read Platform.OS)', () => {
    setPlatform('web');
    setOptionalModules({ 'expo-application': expoApplication });
    expect(detectApp('android')).toEqual({
      platform: 'android',
      version: '1.2.3',
      appId: 'com.example.expo',
    });
  });
});
