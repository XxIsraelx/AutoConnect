/**
 * Testes de integração: sobem o Nest inteiro contra um Postgres real.
 *
 * Não usamos SQLite nem mock do Prisma de propósito — o que precisa ser
 * verificado aqui (RLS, constraints, transações, Decimal) só existe no
 * Postgres. Um mock passaria verde justamente onde o bug mora.
 */
const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  displayName: 'api:e2e',
  // Absoluto de propósito: este arquivo é usado tanto sozinho quanto como
  // `project` do jest.config.js da raiz do pacote, e um caminho relativo
  // resolveria diferente em cada caso.
  rootDir: path.join(__dirname, '..'),
  testEnvironment: 'node',
  testRegex: '\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
  // Precisa rodar antes do arquivo de teste importar o AppModule: é ele que
  // aponta a DATABASE_URL para o banco de teste e recusa apontar para outro.
  setupFiles: ['<rootDir>/test/setup-e2e.ts'],
  // Um banco compartilhado não tolera arquivos de teste concorrentes.
  maxWorkers: 1,
  testTimeout: 30_000,
};
