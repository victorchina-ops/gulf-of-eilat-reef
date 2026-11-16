import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIRTUAL_ID = 'virtual:reef-version';
const RESOLVED_VIRTUAL_ID = '\0virtual:reef-version';

function readVersionPayload() {
  let chronological = [];
  try {
    const raw = execSync('git log --reverse --format="%h%x09%aI%x09%s"', {
      cwd: __dirname,
      encoding: 'utf8',
    });
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    chronological = lines.map((line, idx) => {
      const parts = line.split('\t');
      const hash = (parts[0] || '').trim();
      const iso = (parts[1] || '').trim();
      const subject = parts.slice(2).join('\t').trim();
      const vNum = idx + 1;
      return {
        version: vNum,
        tag: `v${vNum}`,
        hash,
        date: iso ? iso.slice(0, 10) : '',
        subject,
      };
    });
  } catch {
    chronological = [];
  }

  const commits = chronological.slice().reverse();
  const latest = commits[0] || null;
  const version = latest ? latest.version : 20;
  const tag = latest ? latest.tag : `v${version}`;
  const latestDate = latest && latest.date ? latest.date : '2026-11-16';

  const changelogSections = [];
  try {
    const md = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8');
    const lines = md.split(/\r?\n/);
    let current = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith('### ')) {
        current = {
          heading: line.slice(4).trim(),
          bullets: [],
        };
        changelogSections.push(current);
      } else if (line.startsWith('- ') && current) {
        current.bullets.push(line.slice(2).trim());
      }
    }
  } catch {
    // Ignore missing changelog
  }

  return {
    version,
    tag,
    latestDate,
    commits,
    changelogSections,
  };
}

function reefVersionPlugin() {
  const changelogPath = path.resolve(__dirname, 'CHANGELOG.md');
  const mainRefPath = path.resolve(__dirname, '.git', 'refs', 'heads', 'main');
  return {
    name: 'reef-version-sync',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return `export default ${JSON.stringify(readVersionPayload())};`;
      }
      return null;
    },
    configureServer(server) {
      server.watcher.add(changelogPath);
      if (fs.existsSync(mainRefPath)) {
        server.watcher.add(mainRefPath);
      }
      const onFileUpdate = (file) => {
        const resolved = path.resolve(file);
        if (resolved === changelogPath || resolved === mainRefPath) {
          const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: 'full-reload' });
          }
        }
      };
      server.watcher.on('change', onFileUpdate);
      server.watcher.on('add', onFileUpdate);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [reefVersionPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
