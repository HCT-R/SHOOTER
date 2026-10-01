/* Ships this working tree to your server over SSH and rebuilds it there with
   Docker Compose, then checks a duel through the public HTTPS address.
   Local: git, tar, ssh. Server: Docker. Settings in .env: DEPLOY_HOST,
   DEPLOY_DOMAIN, optional DEPLOY_PATH and DEPLOY_SSH. See DEPLOY.md. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { checkServer } = require('./duelcheck.js');

const root = path.join(__dirname, '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = (...lines) => { console.error('✗ ' + lines.join('\n  ')); process.exit(1); };

const host = (process.env.DEPLOY_HOST || '').trim(), domain = (process.env.DEPLOY_DOMAIN || '').trim().toLowerCase();
const dir = (process.env.DEPLOY_PATH || 'pixel-protocol').trim().replace(/\/+$/, '');
const ssh = (process.env.DEPLOY_SSH || 'ssh').trim().split(/\s+/);
if (!host || !domain) fail('Заполните в .env DEPLOY_HOST (например root@203.0.113.10) и DEPLOY_DOMAIN (например game.example.com).', 'Подробности: DEPLOY.md');
if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(domain)) fail('DEPLOY_DOMAIN: только имя домена, без https:// и пути');
// The remote script replaces this directory, so it must be a plain, named path.
if (!/^[\w./-]+$/.test(dir) || dir.split('/').some(part => part === '.' || part === '..') || !/[A-Za-z0-9]/.test(path.posix.basename(dir))) {
  fail('DEPLOY_PATH: папка на сервере из латиницы, цифр и / . _ -, без . и ..');
}

// Everything git would commit, including uncommitted edits; .gitignore keeps
// node_modules, dist and .env at home. Files deleted locally are skipped.
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(file => file && fs.existsSync(path.join(root, file)));

// Unpacks next to the old copy and swaps, so modules removed locally do not
// linger in src/ and end up in the bundle. The marker guards unrelated folders.
const quote = value => "'" + value + "'";
const remote = [
  'set -eu',
  'case ' + quote(dir) + ' in /*) app=' + quote(dir) + ' ;; *) app="$HOME"/' + quote(dir) + ' ;; esac',
  'docker compose version >/dev/null 2>&1 || { echo "На сервере нет Docker с Compose. Установите: curl -fsSL https://get.docker.com | sh" >&2; exit 3; }',
  'docker info >/dev/null 2>&1 || { echo "Нет доступа к Docker. Подключайтесь как root или выполните: sudo usermod -aG docker $(id -un)" >&2; exit 3; }',
  'if [ -e "$app" ] && [ ! -f "$app/.pixel-deploy" ]; then echo "$app уже существует и не создан этим скриптом. Укажите другой DEPLOY_PATH" >&2; exit 4; fi',
  'rm -rf "$app.incoming" && mkdir -p "$app.incoming"',
  'tar -xzf - -C "$app.incoming"',
  // the server keeps its own settings (Discord keys and so on); only DOMAIN follows the local .env
  '{ grep -v "^DOMAIN=" "$app/.env" 2>/dev/null || true; echo DOMAIN=' + domain + '; } > "$app.incoming/.env"',
  'touch "$app.incoming/.pixel-deploy"',
  'rm -rf "$app" && mv "$app.incoming" "$app" && cd "$app"',
  'docker compose up -d --build --remove-orphans'
].join('\n');
// POSIX sh whatever the login shell is; base64 needs no quoting
const command = 'sh -c "$(echo ' + Buffer.from(remote).toString('base64') + ' | base64 -d)"';

const exited = (child, name) => new Promise(resolve => {
  child.on('error', error => fail(name + ' не запустился: ' + error.message));
  child.on('exit', (code, signal) => resolve(code ?? signal));
});

async function main() {
  console.log('→ ' + files.length + ' файлов → ' + host + ':' + dir);
  // COPYFILE_DISABLE stops macOS tar from adding ._* files: build.js would bundle src/._*.js
  const tar = spawn('tar', ['--no-xattrs', '--no-acls', '-czf', '-', '--null', '-T', '-'], { cwd: root, env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['pipe', 'pipe', 'inherit'] });
  const shell = spawn(ssh[0], [...ssh.slice(1), host, command], { stdio: [tar.stdout, 'inherit', 'inherit'] });
  // ssh has its own copy of the archive pipe; ours would keep tar writing forever if ssh died
  tar.stdout.destroy();
  tar.stdin.end(files.join('\0'));
  const [tarCode, shellCode] = await Promise.all([exited(tar, 'tar'), exited(shell, ssh[0])]);
  if (shellCode === 255) fail('Не удалось подключиться по SSH. Проверьте вход командой: ' + ssh.join(' ') + ' ' + host);
  if (shellCode !== 0) fail('Сборка на сервере не удалась (код ' + shellCode + '), подробности выше.');
  if (tarCode !== 0) fail('tar завершился с кодом ' + tarCode);

  const base = 'https://' + domain, logs = ssh.join(' ') + ' ' + host + ' "cd ' + dir + ' && docker compose logs --tail=50 caddy game"';
  console.log('… жду ' + base + ' (при первом запуске Caddy получает сертификат)');
  for (const deadline = Date.now() + 120000; ;) {
    let reason;
    try { const response = await fetch(base + '/health', { signal: AbortSignal.timeout(5000) }); if (response.ok) break; reason = 'HTTP ' + response.status; }
    catch (e) { reason = e.cause?.code || e.cause?.message || e.message; }
    if (Date.now() > deadline) fail(base + ' не отвечает: ' + reason, 'Проверьте, что A-запись домена указывает на сервер, а порты 80 и 443 открыты.', 'Логи: ' + logs);
    await sleep(2000);
  }
  try {
    const result = await checkServer(base);
    console.log('✓ дуэль 1×1 через ' + base + ': задержка ' + Math.round(result.rtt) + ' мс, снимки ' + result.rates.map(Math.round).join(' и ') + ' в секунду');
  } catch (e) { fail('Сервер запущен, но проверка дуэли не прошла: ' + e.message, 'Логи: ' + logs); }
  console.log('\nГотово: ' + base);
  console.log('Режим «Дуэль» → СОЗДАТЬ → ПРИГЛАСИТЬ, отправьте ссылку другу. Оба жмут «ГОТОВ К БОЮ», создатель — «НАЧАТЬ МАТЧ».');
  process.exit(0);
}
// main() ends with process.exit; an empty event loop before that means a lost child
process.on('beforeExit', () => fail('Деплой остановился, не дождавшись tar или ssh'));
main().catch(error => fail(error.stack || error.message));
