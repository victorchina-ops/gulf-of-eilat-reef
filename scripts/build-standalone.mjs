import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const assetsDir = path.join(distDir, 'assets');
const distIndexPath = path.join(distDir, 'index.html');
const nojekyllPath = path.join(distDir, '.nojekyll');
const standaloneOutPath = path.join(rootDir, 'gulf-of-eilat-reef-standalone.html');

function insertBeforeTag(html, tag, snippet) {
  const lower = html.toLowerCase();
  const idx = lower.lastIndexOf(tag.toLowerCase());
  if (idx === -1) {
    throw new Error(`Expected closing tag "${tag}" not found in dist/index.html`);
  }
  return [html.slice(0, idx), snippet, html.slice(idx)].join('');
}

function buildStandalone() {
  if (!fs.existsSync(distIndexPath)) {
    throw new Error(`Missing ${distIndexPath}. Run "vite build" first.`);
  }
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`Missing ${assetsDir}. Run "vite build" first.`);
  }

  let html = fs.readFileSync(distIndexPath, 'utf8');
  const assetFiles = fs.readdirSync(assetsDir).sort();
  const cssFiles = assetFiles.filter((f) => f.endsWith('.css'));
  const jsFiles = assetFiles.filter((f) => f.endsWith('.js'));

  const cssBundle = cssFiles
    .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
    .join('\n');
  const jsBundle = jsFiles
    .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
    .join('\n');

  // Escape any literal </script sequence in JS so HTML parser never closes the tag early.
  const safeJsBundle = jsBundle.replace(/<\/script/gi, '<\\/script');

  // Strip external ./assets/ script and stylesheet tags emitted by Vite.
  html = html.replace(
    /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']\.\/assets\/[^"']+["'][^>]*>\s*<\/script>\s*/gi,
    ''
  );
  html = html.replace(
    /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']\.\/assets\/[^"']+["'][^>]*>\s*/gi,
    ''
  );

  // Use string slicing/concatenation (never String.prototype.replace with bundle content)
  // so minified $& / $$ patterns are never interpreted as replacement patterns.
  if (cssBundle.length > 0) {
    html = insertBeforeTag(html, '</head>', `  <style>\n${cssBundle}\n    </style>\n  `);
  }
  if (safeJsBundle.length > 0) {
    html = insertBeforeTag(
      html,
      '</body>',
      `  <script type="module">\n${safeJsBundle}\n    </script>\n  `
    );
  }

  fs.writeFileSync(nojekyllPath, '', 'utf8');
  fs.writeFileSync(standaloneOutPath, html, 'utf8');

  const stats = fs.statSync(standaloneOutPath);
  const sizeKb = (stats.size / 1024).toFixed(1);
  console.log(`Wrote ${nojekyllPath}`);
  console.log(`Wrote ${standaloneOutPath} (${stats.size} bytes / ${sizeKb} KB)`);
}

buildStandalone();
