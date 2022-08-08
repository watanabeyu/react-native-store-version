# react-native-store-version

This module check an app's version on google playstore or ios app store.  
By writing code successfully, you can make a forced update.

I've only been updating occasionally, but I'd be happy to sponsor you to keep me motivated.
https://github.com/sponsors/watanabeyu

## Installation

```bash
$ npm install --save react-native-store-version
```

## CHANGELOG

### v1.4.0

- Sorry for the long wait for an update.
- fix android.ts by [hussainimdad004](https://github.com/hussainimdad004)
  - https://github.com/watanabeyu/react-native-store-version/issues/39
- use prettier
- move example to [snack](https://snack.expo.dev/@watanabe_yu/react-native-store-version-example)

### v1.3.0

- if failed, throw an error.
- add result detail.

## Usage

```tsx
import checkVersion from 'react-native-store-version';

export default function App() {
  useEffect(() => {
    const init = async () => {
      try {
        const check = await checkVersion({
          version: '1.0.0', // app local version
          iosStoreURL: 'ios app store url',
          androidStoreURL: 'android app store url',
          country: 'jp', // default value is 'jp'
        });

        if (check.result === 'new') {
          // if app store version is new
        }
      } catch (e) {
        console.log(e);
      }
    };

    init();
  }, []);
}
```

## Return value

```jsx
// correct
{
  local: "1.0.0",
  remote: "1.1.0",
  result: "new", // "new" | "old" | "equal"
  detail: "remote > local", // "remote > local" | "remote < local" | "remote === local"
}

// catch error
{
  message: "string",
}
```

result compare from a `local` to `remote`.  
If `local(1.0.0)` and `remote(1.1.0)`, result is new.

## Example

[Check out example on snack](https://snack.expo.dev/@watanabe_yu/react-native-store-version-example)
