/**
 * Um único `pnpm test` cobre as duas famílias, porque o portão do projeto é
 * `turbo run typecheck lint test` — teste que mora fora desse comando não é
 * rodado por ninguém.
 *
 * - unit: rápido, sem banco, `*.spec.ts` dentro de src/
 * - e2e:  sobe o Nest contra Postgres real, `*.e2e-spec.ts` em test/
 */
/** @type {import('jest').Config} */
module.exports = {
  // Global, não por projeto: com `projects`, o `maxWorkers` do e2e é ignorado
  // e os arquivos de integração rodavam em paralelo contra o mesmo banco — o
  // teste de cron (que lê agendamentos de todas as lojas) quebrava quando outro
  // arquivo apagava a sua loja no meio da consulta. Serial leva ~15s.
  maxWorkers: 1,
  projects: [
    {
      displayName: 'api:unit',
      rootDir: __dirname,
      testEnvironment: 'node',
      testRegex: 'src/.*\\.spec\\.ts$',
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
    },
    require('./test/jest-e2e.config.js'),
  ],
};
