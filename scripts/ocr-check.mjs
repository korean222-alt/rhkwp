import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'features.spec.ts', '-g', 'original screenshot'], { stdio: 'inherit', env: { ...process.env, LENS_TEST_URL: process.env.LENS_TEST_URL || 'http://127.0.0.1:5175' } });
process.exitCode = result.status ?? 1;
