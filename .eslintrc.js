module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
  },
  env: {
    es6: true,
    browser: true,
    jest: true,
  },
  extends: [
    'airbnb-typescript/base',
  ],
  globals: {
    __DEV__: true,
  },
  plugins: [
    '@typescript-eslint',
  ],
  settings: {
    'import/extensions': [
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
    ],
    'import/core-modules': [
      'app',
    ],
    'import/resolver': {
      node: {
        extensions: [
          '.js',
          '.jsx',
          '.ts',
          '.tsx',
        ],
      },
    },
  },
  rules: {
    camelcase: 0,
    'import/prefer-default-export': 0,
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ["error", { "argsIgnorePattern": "^_" }],
    'max-len': 0,
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: true,
        optionalDependencies: false,
        peerDependencies: false,
        packageDir: './',
      },
    ],
    'import/no-unresolved': [
      2,
      {
        ignore: [
          '^app/.+$',
        ],
      },
    ],
    'import/extensions': [
      'error', 'always',
      {
        js: 'never',
        jsx: 'never',
        ts: 'never',
        tsx: 'never',
      },
    ],
  },
};
