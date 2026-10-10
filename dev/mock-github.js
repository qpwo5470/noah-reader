// 로컬 시험용: GitHub contents API 일부를 흉내 내고 이 폴더의 정적 파일도 서빙한다.
//   DATA=<데이터 레포 경로> PROCESS_CMD="<처리 명령>" node dev/mock-github.js   → http://localhost:8787
// 브라우저 콘솔: localStorage['noah.gh']=JSON.stringify({token:'x',api:'http://localhost:8787'})
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const STATIC = path.join(__dirname, '..');
const DATA = path.resolve(process.env.DATA || '.');
const PROCESS = process.env.PROCESS_CMD;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS' };
// 한자 만화(hanja/)를 시험할 때는 DATA를 hanja-data 브랜치 내용(library.json, dict.json, books/…)이 든 폴더로.
//   http://localhost:8787/hanja/?gh=1  (?gh=1 이 localhost에서도 GitHub 방식으로 돌게 함)
let timer = null;
// git blob sha (GitHub와 같은 값) — PUT의 sha 확인(낙관적 잠금) 시험용
const blobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const blobs = new Map(); // sha → 내용 (git/blobs 흉내)
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const bl = u.pathname.match(/^\/repos\/[^/]+\/[^/]+\/git\/blobs\/([0-9a-f]+)$/);
  if (bl) {
    const b = blobs.get(bl[1]);
    res.writeHead(b ? 200 : 404, { ...cors, 'Content-Type': 'application/octet-stream' });
    return res.end(b || '');
  }
  const m = u.pathname.match(/^\/repos\/[^/]+\/[^/]+(?:\/contents\/(.*))?$/);
  if (m) {
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { ...cors, 'Content-Type': type }); res.end(body); };
    if (m[1] === undefined) return send(200, JSON.stringify({ full_name: 'mock/repo' }));
    const rel = decodeURIComponent(m[1]);
    const f = path.join(DATA, rel);
    if (!f.startsWith(DATA)) return send(400, '{}');
    if (req.method === 'PUT') {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
        const j = JSON.parse(b);
        // sha를 보냈는데 현재 파일과 다르면 GitHub처럼 409 (sha 없이 보내면 예전처럼 그냥 덮어씀)
        if (j.sha && fs.existsSync(f) && blobSha(fs.readFileSync(f)) !== j.sha) return send(409, JSON.stringify({ message: 'is at ' + blobSha(fs.readFileSync(f)) + ' but expected ' + j.sha }));
        fs.mkdirSync(path.dirname(f), { recursive: true });
        const buf = Buffer.from(j.content, 'base64');
        fs.writeFileSync(f, buf);
        send(201, JSON.stringify({ content: { path: rel, sha: blobSha(buf) } }));
        console.log('[put]', rel, fs.statSync(f).size, 'bytes');
        if (PROCESS) { clearTimeout(timer); timer = setTimeout(() => execFile('sh', ['-c', PROCESS], (e, o, er) => console.log('[process]', o, er)), 1500); }
      });
      return;
    }
    if (!fs.existsSync(f)) return send(404, JSON.stringify({ message: 'Not Found' }));
    if (fs.statSync(f).isDirectory()) return send(200, JSON.stringify(fs.readdirSync(f).map((name) => ({ name, path: rel + '/' + name }))));
    if ((req.headers.accept || '').includes('raw')) return send(200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
    const buf = fs.readFileSync(f), sha = blobSha(buf);
    blobs.set(sha, buf);
    // GitHub처럼 1MB 넘는 파일은 내용 없이(encoding none) → git/blobs로 받아야 함
    const big = buf.length > 1024 * 1024 || process.env.MOCK_BIG === '1';
    return send(200, JSON.stringify({ sha, path: rel, encoding: big ? 'none' : 'base64', content: big ? '' : buf.toString('base64') }));
  }
  const p = path.join(STATIC, decodeURIComponent(u.pathname).endsWith('/') ? decodeURIComponent(u.pathname) + 'index.html' : decodeURIComponent(u.pathname));
  if (!p.startsWith(STATIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
}).listen(8787, () => console.log('mock github on http://localhost:8787  DATA=' + DATA));
