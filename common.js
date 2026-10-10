// 데이터는 비공개 레포에 있고, 이 기기에 저장한 fine-grained 토큰으로 GitHub API를 통해 읽고 쓴다.
const CFG_KEY = 'noah.gh';
const DEFAULT_REPO = 'qpwo5470/noah-school-studies';
const BRANCH = 'main';
function cfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; } }
function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {} }
function repoName() { return cfg().repo || DEFAULT_REPO; }
function apiBase() { return cfg().api || 'https://api.github.com'; }
function requireSetup() {
  if (cfg().token) return true;
  location.href = 'setup.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
  return false;
}
async function gh(path, opts = {}) {
  const headers = { Authorization: 'Bearer ' + cfg().token, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) };
  const res = await fetch(apiBase() + path, { cache: 'no-store', ...opts, headers });
  if (res.status === 401) throw new Error('토큰이 만료됐거나 틀렸어요. 설정에서 다시 넣어 주세요.');
  return res;
}
const contentsPath = (p) => `/repos/${repoName()}/contents/${p}`;
async function httpErr(res) { let m = ''; try { m = (await res.json()).message; } catch (e) {} return new Error(`GitHub ${res.status} ${m}`); }
async function getJson(p) {
  const r = await gh(contentsPath(p) + `?ref=${BRANCH}&t=${Date.now()}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw await httpErr(r);
  return r.json();
}
const blobCache = new Map();
async function getBlobUrl(p) {
  if (blobCache.has(p)) return blobCache.get(p);
  const r = await gh(contentsPath(p) + `?ref=${BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'default' });
  if (!r.ok) throw await httpErr(r);
  const url = URL.createObjectURL(await r.blob());
  blobCache.set(p, url);
  return url;
}
async function listDir(p) {
  const r = await gh(contentsPath(p) + `?ref=${BRANCH}&t=${Date.now()}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return [];
  if (!r.ok) throw await httpErr(r);
  const j = await r.json();
  return Array.isArray(j) ? j.map((f) => f.name) : [];
}
// 파일 생성/덮어쓰기. base64 내용.
async function putFile(p, base64, message) {
  const body = { message, content: base64, branch: BRANCH };
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await gh(contentsPath(p), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    if (r.status === 422 || r.status === 409) { // 같은 이름 파일 존재 또는 경합 → sha 받아 재시도
      const g = await gh(contentsPath(p) + `?ref=${BRANCH}&t=${Date.now()}`);
      if (g.ok) body.sha = (await g.json()).sha; else delete body.sha;
      await new Promise((res) => setTimeout(res, 800));
      continue;
    }
    if (r.status === 403 || r.status === 404) throw new Error('쓰기 권한이 없어요. 토큰에 Contents: Read and write 권한이 있는지 확인하세요.');
    throw await httpErr(r);
  }
  throw new Error('저장에 실패했어요. 잠시 후 다시 시도하세요.');
}
function utf8ToB64(s) { return btoa(String.fromCharCode(...new TextEncoder().encode(s))); }
function putJson(p, obj, message) { return putFile(p, utf8ToB64(JSON.stringify(obj)), message); }
function newId() { return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`; }
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
