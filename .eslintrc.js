module.exports = {
  "parser": "@typescript-eslint/parser",
  "env": {
    "es6": true,
    "browser": true
  },
  "extends": "airbnb",
  "globals": {
    "__DEV__": true
  },
  "plugins": [
    "@typescript-eslint"
  ],
  "parserOptions": {
    "sourceType": "module",
    "project": "./tsconfig.json"
  },
  "settings": {
    "import/extensions": [
      ".js",
      ".jsx",
      ".ts",
      ".tsx"
    ],
    "import/resolver": {
      "node": {
        "extensions": [
          ".js",
          ".jsx",
          ".ts",
          ".tsx"
        ]
      }
    }
  },
  "rules": {
    "max-len": [
      1,
      140,
      2
    ],
    "import/no-extraneous-dependencies": [
      "error",
      {
        "devDependencies": ["src/**"],
        "optionalDependencies": false,
        "peerDependencies": false
      }
    ],
    "import/extensions": [
      ".js",
      ".jsx",
      ".ts",
      ".tsx"
    ]
  }
}