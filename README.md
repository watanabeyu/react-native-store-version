# react-native-store-version
This module check an app's version on google playstore or ios app store.  
By writing code successfully, you can make a forced update.

## Installation
```bash
$ npm install --save react-native-store-version
```

## Usage
```jsx
import checkVersion from './check';

export default class App extends React.Component {
  ...

  async componentDidMount(){
    const check = await checkVersion({
      version,
      iosStoreURL: 'ios app store url',
      androidStoreURL: 'android app store url',
    });

    if(check.result === "new"){
      // if app store version is new
    }
  }
}
```

## Return value
```jsx
{
  error: false,
  message: null, // if has error return error message
  local: "1.0.0",
  remote: "1.1.0",
  result: "new" // enum["new", "old", "equal"]
}
```
result compare from a `local` to `remote`.  
If `local(1.0.0)` and `remote(1.1.0)`, result is new.

## Example
[Check out example](./example)