// Launch the desktop app from source. Strips ELECTRON_RUN_AS_NODE, which VS Code (an
// Electron app itself) sets in its terminals — with it set, Electron runs as plain Node
// and the app can't start ("Cannot read properties of undefined (reading 'setPath')").
//   node tools/run-electron.mjs [--smoke-test]
import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', code => process.exit(code ?? 0));
