module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    // tsconfig.spec.json e não tsconfig.json: o script de lint já cobre
    // {src,test}, e o de build só inclui src/ — com ele o eslint recusaria
    // todo arquivo de teste com "file not found in project".
    project: 'tsconfig.spec.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: ['plugin:@typescript-eslint/recommended'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
};
