#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const MAIN_FILE = path.join(__dirname, '../dist/index.js');

// 必须带全这四个参数
const REQUIRED_ARGS = [
  '--permission',
  '--experimental-ffi',
  '--allow-ffi',
  '--allow-fs-read=*',
  '--allow-fs-write=*'
];

const missing = REQUIRED_ARGS.filter(arg => !process.execArgv.includes(arg));

if (missing.length > 0) {
  const result = spawnSync(
    process.execPath,
    [
      ...REQUIRED_ARGS,
      MAIN_FILE,
      ...process.argv.slice(2)
    ],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 0);
}

// 权限已齐全，直接运行
require(MAIN_FILE);