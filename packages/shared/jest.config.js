/**
 * Domínio puro: schemas Zod, cálculos e máquinas de estado. Sem banco, sem
 * rede — roda em milissegundos e é onde as regras de negócio são verificadas.
 */
/** @type {import('jest').Config} */
module.exports = {
  displayName: 'shared',
  rootDir: __dirname,
  testEnvironment: 'node',
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
};
