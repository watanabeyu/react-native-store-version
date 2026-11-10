// No policy: the default policy forces an update on a major difference (C8 warns)
import { Text } from 'react-native';
import { StoreVersionProvider } from 'react-native-store-version';

export default function App() {
  return (
    <StoreVersionProvider onError={(error) => console.warn(error)}>
      <Text>CNG</Text>
    </StoreVersionProvider>
  );
}
