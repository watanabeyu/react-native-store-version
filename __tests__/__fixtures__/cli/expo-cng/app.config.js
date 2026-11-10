// The iOS bundleIdentifier is set only here (not in app.json), so it is found only when app.config.js is evaluated
module.exports = ({ config }) => ({
  ...config,
  ios: { ...config.ios, bundleIdentifier: 'com.example.cng' },
});
