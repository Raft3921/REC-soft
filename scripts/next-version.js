const fs = require('fs');
const { execFileSync } = require('child_process');
const file = 'package.json';
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
let exists = false;
try { execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/v${pkg.version}`], { stdio: 'ignore' }); exists = true; } catch {}
if (exists) {
  const [, minor, patch] = pkg.version.split('.').map(Number);
  pkg.version = patch >= 9 ? `1.${minor + 1}.0` : `1.${minor}.${patch + 1}`;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
process.stdout.write(pkg.version);
