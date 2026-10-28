// Copies the static web app into www/ so Capacitor can bundle it.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'core.js', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest',
  'nutrition-advanced.js', 'nutrition-ui.js', 'nutrition.css', 'theme-manager.js', 'themes.css']) fs.copyFileSync(path.join(root, f), path.join(out, f));
fs.cpSync(path.join(root, 'icons'), path.join(out, 'icons'), { recursive: true });
console.log('Copied web app to www/');
