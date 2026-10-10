// 로컬 시험용: GitHub contents API 일부를 흉내 내고 이 폴더의 정적 파일도 서빙한다.
//   DATA=<데이터 레포 경로> PROCESS_CMD="<처리 명령>" node dev/mock-github.js   → http://localhost:8787
// 브라우저 콘솔: localStorage['noah.gh']=JSON.stringify({token:'x',api:'http://localhost:8787'})
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const STATIC = path.join(__dirname, '..');
const DATA = path.resolve(process.env.DATA || '.');
const PROCESS = process.env.PROCESS_CMD;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS' };
let timer = null;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
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
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, Buffer.from(j.content, 'base64'));
        send(201, JSON.stringify({ content: { path: rel } }));
        console.log('[put]', rel, fs.statSync(f).size, 'bytes');
        if (PROCESS) { clearTimeout(timer); timer = setTimeout(() => execFile('sh', ['-c', PROCESS], (e, o, er) => console.log('[process]', o, er)), 1500); }
      });
      return;
    }
    if (!fs.existsSync(f)) return send(404, JSON.stringify({ message: 'Not Found' }));
    if (fs.statSync(f).isDirectory()) return send(200, JSON.stringify(fs.readdirSync(f).map((name) => ({ name, path: rel + '/' + name }))));
    if ((req.headers.accept || '').includes('raw')) return send(200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
    return send(200, JSON.stringify({ sha: 'mock', path: rel }));
  }
  const p = path.join(STATIC, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!p.startsWith(STATIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
}).listen(8787, () => console.log('mock github on http://localhost:8787  DATA=' + DATA));
