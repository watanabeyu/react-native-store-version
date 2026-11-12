// The policy forces an update on a major difference from the store version (C8 warns).
// `onResult={(result) => …}` has a ">" inside the opening tag
import { Text } from 'react-native';
import { StoreVersionProvider } from 'react-native-store-version';

export default function App() {
  return (
    <StoreVersionProvider
      onResult={(result) => result.action !== 'none' && console.log(result)}
      policy={{ major: 'force', minor: 'warning', patch: 'warning' }}
    >
      <Text>Bare React Native</Text>
    </StoreVersionProvider>
  );
}
