const fs = require('fs');
const path = require('path');

const destArg = process.argv[2] || 'dist/panel';
const src = path.resolve(__dirname, '../dist');
const dest = path.resolve(process.cwd(), destArg);

if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error(`missing panel build at ${src}`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
