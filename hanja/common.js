// 공통: 데이터 읽기·쓰기(로컬 서버 / GitHub), 진행 상황 저장, 한자 조각 렌더링
//
// 두 가지 방식으로 같은 화면이 돈다.
//  - 로컬: hanja/server.js가 서빙(맥 localhost·같은 와이파이 IP). 그냥 fetch, 단어장 수정은 /api/dict
//  - GitHub: *.github.io(공개 Pages)에서 열리거나 주소에 ?gh=1 을 붙였을 때.
//    데이터는 비공개 레포의 hanja-data 브랜치에 있고, 영어 앱 설정(../setup.html)에서 저장한
//    토큰(localStorage 'noah.gh', 같은 Pages 출처라 공유됨)으로 GitHub contents API를 통해 읽고 쓴다.
//    ?gh=0 이면 다시 로컬 방식.
const H = {
  ls: {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 사생활 보호 모드 등 */ }
    },
  },
};

// ---------- 방식 판별 ----------
(() => {
  const f = new URLSearchParams(location.search).get('gh');
  if (f === '1') H.ls.set('hanja:gh', true);
  else if (f === '0') H.ls.set('hanja:gh', false);
})();
H.GH = /\.github\.io$/.test(location.hostname) || H.ls.get('hanja:gh', false) === true;

// ---------- GitHub 접근 (영어 앱 common.js와 같은 설정 키) ----------
const GH = {
  BRANCH: 'hanja-data',
  cfg() { try { return JSON.parse(localStorage.getItem('noah.gh')) || {}; } catch { return {}; } },
  repo() { return GH.cfg().repo || 'qpwo5470/noah-school-studies'; },
  api() { return GH.cfg().api || 'https://api.github.com'; },
  // 논리 경로(로컬 서버 기준) → hanja-data 브랜치 안의 경로
  remote(p) { return p === 'books/library.json' ? 'library.json' : p; },
  url(p, q = '') { return `${GH.api()}/repos/${GH.repo()}/contents/${GH.remote(p).split('/').map(encodeURIComponent).join('/')}?ref=${GH.BRANCH}${q}`; },
  async fetch(url, opts = {}) {
    const headers = { Authorization: 'Bearer ' + GH.cfg().token, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) };
    const r = await fetch(url, { cache: 'no-store', ...opts, headers });
    if (r.status === 401) throw new Error('토큰이 만료됐거나 틀렸어요. 설정에서 다시 넣어 주세요.');
    return r;
  },
  async err(r) { let m = ''; try { m = (await r.json()).message; } catch {} return new Error(`GitHub ${r.status} ${m}`); },
  b64ToUtf8(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(u8);
  },
  utf8ToB64(s) {
    const u8 = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  },
  /** 파일 내용과 sha를 함께(같은 버전) 받는다. 1MB 넘는 파일은 contents API가 내용을 안 주므로 blob API로. */
  async getWithSha(p) {
    const r = await GH.fetch(GH.url(p, `&t=${Date.now()}`), { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw await GH.err(r);
    const j = await r.json();
    if (j.encoding === 'base64' && j.content) return { sha: j.sha, text: GH.b64ToUtf8(j.content) };
    const b = await GH.fetch(`${GH.api()}/repos/${GH.repo()}/git/blobs/${j.sha}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!b.ok) throw await GH.err(b);
    return { sha: j.sha, text: await b.text() };
  },
};

// 토큰이 없으면 영어 앱의 설정 화면으로 (저장 뒤 이 화면으로 돌아옴)
H.requireSetup = () => {
  if (!H.GH || GH.cfg().token) return true;
  location.href = '../setup.html?next=' + encodeURIComponent('hanja/' + (location.pathname.split('/').pop() || 'index.html') + location.search);
  return false;
};

/** JSON 읽기. 경로는 로컬 서버 기준('books/library.json', 'dict.json', 'books/<id>/book.json') */
H.json = async (p) => {
  if (!H.GH) {
    const r = await fetch(p, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  }
  const r = await GH.fetch(GH.url(p, `&t=${Date.now()}`), { headers: { Accept: 'application/vnd.github.raw+json' } });
  if (!r.ok) throw await GH.err(r);
  return r.json();
};

// ---------- 이미지 ----------
// GitHub 방식은 이미지를 blob URL로 받는다. 아이패드 메모리를 생각해 개수를 제한하고(오래된 것부터 해제),
// 리더가 멀리 떨어진 쪽의 이미지를 뗄 때 H.dropImg로 바로 해제한다.
const IMG_MAX = 24;
const imgCache = new Map(); // 경로 → Promise<blob URL> (Map 순서 = 최근 사용 순)
H.img = (p) => {
  if (!H.GH) return Promise.resolve(p);
  if (imgCache.has(p)) {
    const v = imgCache.get(p);
    imgCache.delete(p);
    imgCache.set(p, v);
    return v;
  }
  const v = (async () => {
    const r = await GH.fetch(GH.url(p), { headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'default' });
    if (!r.ok) throw await GH.err(r);
    return URL.createObjectURL(await r.blob());
  })();
  v.catch(() => imgCache.get(p) === v && imgCache.delete(p)); // 실패는 캐시하지 않음
  imgCache.set(p, v);
  while (imgCache.size > IMG_MAX) H.dropImg(imgCache.keys().next().value);
  return v;
};
H.dropImg = (p) => {
  if (!H.GH || !imgCache.has(p)) return;
  const v = imgCache.get(p);
  imgCache.delete(p);
  v.then((u) => URL.revokeObjectURL(u), () => {});
};

// ---------- 단어장 수정 ----------
/**
 * 단어 하나 고치기. patch = {m:'뜻'} 또는 {hidden:true}. 고친 항목을 돌려준다.
 * 로컬: PUT/DELETE /api/dict/:key
 * GitHub: dict.json을 sha와 함께 받아 고친 뒤 PUT. 그 사이 다른 저장이 있으면(409/422) 다시 받아 같은 수정을 다시 적용.
 */
H.saveWord = async (key, patch) => {
  if (!H.GH) {
    const url = `/api/dict/${encodeURIComponent(key)}`;
    const r = patch.hidden
      ? await fetch(url, { method: 'DELETE' })
      : await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ m: patch.m }) });
    if (!r.ok) throw new Error('저장 실패 (서버가 켜져 있나요?)');
    const j = await r.json();
    return patch.hidden ? { hidden: true, user: true } : j;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const { sha, text } = await GH.getWithSha('dict.json');
    const dict = JSON.parse(text);
    const e = dict[key];
    if (!e) throw new Error('없는 단어예요 (단어장이 바뀌었을 수 있어요. 새로고침해 보세요).');
    if (patch.hidden) e.hidden = true;
    else e.m = String(patch.m ?? '').trim();
    e.user = true; // 사람이 고침 → 파이프라인이 덮어쓰지 않음
    // 로컬 dict.js save와 같은 모양(키 정렬, 들여쓰기 1)으로 저장해 변경 내역을 작게
    const sorted = Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b, 'ko')));
    const body = {
      message: `hanja: 단어장 ${patch.hidden ? '숨김' : '뜻 수정'} ${key}`,
      content: GH.utf8ToB64(JSON.stringify(sorted, null, 1)),
      sha,
      branch: GH.BRANCH,
    };
    const r = await GH.fetch(GH.url('dict.json').split('?')[0], { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return e;
    if (r.status === 409 || r.status === 422) { await new Promise((res) => setTimeout(res, 600 + attempt * 600)); continue; }
    if (r.status === 403 || r.status === 404) throw new Error('쓰기 권한이 없어요. 토큰에 Contents: Read and write 권한이 있는지 확인하세요.');
    throw await GH.err(r);
  }
  throw new Error('저장에 실패했어요. 잠시 후 다시 시도하세요.');
};

// ---------- 진행 상황·렌더링 ----------
Object.assign(H, {
  progress(bookId, page) {
    if (page === undefined) return H.ls.get(`hanja:progress:${bookId}`, 0);
    H.ls.set(`hanja:progress:${bookId}`, page);
    H.ls.set('hanja:last', bookId);
  },
  esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  },
  /** 뜻이 아직 비어 있으면(파이프라인이 채우는 중) 자리 표시 */
  meaning(e) {
    return e && e.m ? e.m : '뜻 준비 중';
  },
  /** segs → HTML. 한자어는 <span class="hj" data-k data-h>한자</span> */
  segsHTML(segs, dict) {
    return segs
      .map((s) => {
        if (!s.h) return H.esc(s.t);
        const e = dict[`${s.t}|${s.h}`];
        if (e && e.hidden) return H.esc(s.t); // 단어장에서 뺀 단어는 한글로
        return `<span class="hj" data-k="${H.esc(s.t)}" data-h="${H.esc(s.h)}">${H.esc(s.h)}</span>`;
      })
      .join('');
  },
  plain(segs) {
    return segs.map((s) => s.t).join('');
  },
  tapped(key) {
    const arr = H.ls.get('hanja:tapped', []);
    if (key) {
      const i = arr.findIndex((x) => x.k === key);
      if (i >= 0) arr.splice(i, 1);
      arr.unshift({ k: key, t: Date.now() });
      H.ls.set('hanja:tapped', arr.slice(0, 500));
    }
    return arr;
  },
});
