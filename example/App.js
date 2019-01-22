import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Linking,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native';
import { Constants } from 'expo';

/* react-native-store-version */
import checkVersion from 'react-native-store-version';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  button: {
    marginHorizontal: 60,
    marginVertical: 20,
    height: 60,
    paddingHorizontal: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    flex: 1,
    paddingHorizontal: 60,
    justifyContent: 'center',
  },
  modalButton: {
    width: '100%',
    backgroundColor: '#fff',
    paddingVertical: 18,
    borderRadius: 10,
  },
});

export default class App extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      isLatest: true,
    };
  }

  async componentDidMount() {
    const { version } = Constants.manifest;

    const check = await checkVersion({
      version,
      iosStoreURL: 'https://itunes.apple.com/app/id1321198947?mt=8',
      androidStoreURL: 'https://play.google.com/store/apps/details?id=jp.ewaf.pinpoint.android',
    });

    if (check.result === 'new') {
      this.setState({ isLatest: false });
    }
  }

  onStoreButtonPress = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('https://itunes.apple.com/app/id1321198947?mt=8');
    } else {
      Linking.openURL('https://play.google.com/store/apps/details?id=jp.ewaf.pinpoint.android');
    }
  }

  render() {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.button}>
          <Text>button1</Text>
        </TouchableOpacity>
        <Modal animationType="fade" transparent visible={!this.state.isLatest} onRequestClose={() => { }}>
          <View style={styles.modalContainer}>
            <TouchableOpacity style={styles.modalButton} onPress={this.onStoreButtonPress}>
              <Text style={{ textAlign: 'center' }}>Go Store</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    );
  }
}
