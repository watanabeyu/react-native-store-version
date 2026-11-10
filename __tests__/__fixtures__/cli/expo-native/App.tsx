// The policy has 'force', but getMinimumVersion is used in src/version.ts (C8 does not warn)
import { Platform, Text } from 'react-native';
import { StoreVersionProvider } from 'react-native-store-version';
import { getMinimumVersion } from './src/version';

export default function App() {
  return (
    <StoreVersionProvider
      policy={{ major: Platform.OS === 'android' ? 'warning' : 'force' }}
      getMinimumVersion={getMinimumVersion}
    >
      <Text>Expo with native directories</Text>
    </StoreVersionProvider>
  );
}
