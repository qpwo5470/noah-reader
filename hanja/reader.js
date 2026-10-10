// 한자 만화 리더
// - 가로 스냅 스크롤(옆으로 넘기기), 앞뒤 몇 쪽 미리 불러오기
// - 탭 영역: 양옆 = 넘기기, 가운데 = 메뉴. 한자 탭 = 발음·뜻 팝업
// - 멀리 이동(슬라이더/권 이동)하면 "돌아가기" 버튼으로 원래 자리로 (Kindle Page Flip 방식)
(async () => {
  const q = new URLSearchParams(location.search);
  const bookId = q.get('b');
  if (!bookId) return (location.href = 'index.html');
  if (!H.requireSetup()) return;

  let book, lib, dict;
  try {
    [book, lib, dict] = await Promise.all([
      H.json(`books/${bookId}/book.json`),
      H.json('books/library.json').catch(() => ({ series: [] })),
      H.json('dict.json').catch(() => ({})),
    ]);
  } catch (e) {
    document.body.innerHTML = `<div class="lib"><div class="empty">책을 불러오지 못했어요: ${H.esc(e.message)}<br><br><a class="btn" href="index.html">목차로</a></div></div>`;
    return;
  }
  const rtl = book.direction === 'rtl';
  const N = book.pages.length;
  const PRELOAD_AHEAD = 3, PRELOAD_BEHIND = 2, KEEP = 8;

  // 같은 시리즈의 앞뒤 권
  const vols = (lib.series.find((s) => s.slug === book.seriesSlug) || { volumes: [] }).volumes;
  const vi = vols.findIndex((v) => v.id === book.id);
  const prevVol = vi > 0 ? vols[vi - 1] : null;
  const nextVol = vi >= 0 && vi < vols.length - 1 ? vols[vi + 1] : null;

  const $ = (id) => document.getElementById(id);
  const strip = $('strip');
  const slider = $('slider');
  document.title = book.title;
  $('title').textContent = book.title;
  if (rtl) strip.classList.add('rtl');
  slider.max = N - 1;
  if (rtl) slider.style.direction = 'rtl';
  $('prevVol').disabled = !prevVol;
  $('nextVol').disabled = !nextVol;

  // ---------- 페이지 DOM ----------
  const frames = [];
  book.pages.forEach((p, i) => {
    const sec = document.createElement('section');
    sec.className = 'page';
    sec.dataset.i = i;
    const frame = document.createElement('div');
    frame.className = 'frame';
    frame.innerHTML = `<div class="spin">${i + 1}</div><img alt="" draggable="false"><div class="overlay"></div>`;
    const ov = frame.querySelector('.overlay');
    p.bubbles.forEach((b, bi) => {
      // OCR 상자를 조금 넓혀 원래 글자가 가장자리로 삐져나오지 않게 한다
      const PAD = 12; // 1000 기준
      const x1 = Math.max(0, b.box[0] - PAD), y1 = Math.max(0, b.box[1] - PAD);
      const x2 = Math.min(1000, b.box[2] + PAD), y2 = Math.min(1000, b.box[3] + PAD);
      const d = document.createElement('div');
      d.className = `bub ${b.kind || ''}`;
      d.style.cssText = `left:${x1 / 10}%;top:${y1 / 10}%;width:${(x2 - x1) / 10}%;height:${(y2 - y1) / 10}%`;
      d.dataset.bi = bi;
      d.innerHTML = `<span class="t">${H.segsHTML(b.segs, dict)}</span>`;
      ov.appendChild(d);
    });
    sec.appendChild(frame);
    strip.appendChild(sec);
    frames.push(frame);
  });
  // 끝 카드
  const end = document.createElement('section');
  end.className = 'page';
  end.dataset.i = N;
  end.innerHTML = `<div class="endcard"><h2>${H.esc(book.title)} 끝</h2>
    ${nextVol ? `<button class="btn primary" id="goNext">다음 권: ${H.esc(nextVol.title)} ▶</button>` : '<div>마지막 권입니다</div>'}
    <a class="btn" href="index.html">목차로</a></div>`;
  strip.appendChild(end);

  // ---------- 레이아웃 ----------
  function layout() {
    const vw = strip.clientWidth, vh = strip.clientHeight;
    book.pages.forEach((p, i) => {
      const ar = p.w / p.h;
      let w = Math.min(vw, vh * ar);
      let h = w / ar;
      frames[i].style.width = `${w}px`;
      frames[i].style.height = `${h}px`;
      // 말풍선 글자 크기: 상자 넓이와 글자 수로 맞춤
      frames[i].querySelectorAll('.bub').forEach((d, bi) => {
        const b = p.bubbles[bi];
        const [x1, y1, x2, y2] = b.box;
        const bw = ((x2 - x1) / 1000) * w, bh = ((y2 - y1) / 1000) * h;
        const chars = Math.max(4, H.plain(b.segs).length);
        const fs = Math.max(11, Math.min(40, Math.sqrt((bw * bh) / chars) * 0.78));
        d.style.fontSize = `${fs.toFixed(1)}px`;
      });
    });
    goTo(cur, 'instant');
  }

  // ---------- 이미지 미리 불러오기 ----------
  // 현재 쪽에서 가까운 순서로 앞 3쪽·뒤 2쪽만 받는다. KEEP쪽보다 멀어지면 이미지를 떼고(GitHub 방식은 blob 해제) 다시 숫자 표시.
  const pagePath = (i) => `books/${book.id}/${book.pages[i].file}`;
  const wanted = (i, center) => i - center >= -PRELOAD_BEHIND && i - center <= PRELOAD_AHEAD;
  function preload(center) {
    const order = [...Array(N).keys()].sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
    for (const i of order) {
      const img = frames[i].querySelector('img');
      const d = i - center;
      if (wanted(i, center) && !img.getAttribute('src') && !img.dataset.loading) {
        img.dataset.loading = 1;
        H.img(pagePath(i)).then((url) => {
          delete img.dataset.loading;
          if (Math.abs(i - cur) > KEEP) return H.dropImg(pagePath(i)); // 받는 사이 멀리 이동함
          img.onload = () => frames[i].querySelector('.spin')?.remove();
          img.src = url;
        }, () => {
          delete img.dataset.loading;
          const sp = frames[i].querySelector('.spin');
          if (sp) sp.textContent = `${i + 1} (불러오기 실패 — 넘겼다 돌아오면 다시)`;
        });
      } else if (Math.abs(d) > KEEP && img.getAttribute('src')) {
        img.removeAttribute('src');
        H.dropImg(pagePath(i));
        if (!frames[i].querySelector('.spin')) frames[i].insertAdjacentHTML('afterbegin', `<div class="spin">${i + 1}</div>`);
      }
    }
  }

  // ---------- 이동 ----------
  let cur = Math.min(N - 1, Math.max(0, parseInt(q.get('p') ?? H.progress(book.id), 10) || 0));
  let anchor = null; // 돌아갈 쪽
  const pageWidth = () => strip.clientWidth;
  function goTo(i, behavior = 'smooth') {
    i = Math.max(0, Math.min(N, i));
    const x = i * pageWidth() * (rtl ? -1 : 1);
    strip.scrollTo({ left: x, behavior });
    setCurrent(i);
  }
  function jump(i) {
    if (Math.abs(i - cur) > 1 && cur < N) setAnchor(cur);
    goTo(i);
  }
  function setAnchor(i) {
    anchor = i;
    $('back').textContent = `↩ ${i + 1}쪽으로 돌아가기`;
    $('back').classList.add('show');
  }
  function clearAnchor() {
    anchor = null;
    $('back').classList.remove('show');
  }
  function setCurrent(i) {
    if (i === cur && slider.dataset.init) return;
    slider.dataset.init = 1;
    cur = i;
    if (i < N) {
      H.progress(book.id, i);
      slider.value = i;
      $('pg').textContent = `${i + 1} / ${N}`;
      preload(i);
      history.replaceState(null, '', `?b=${encodeURIComponent(book.id)}&p=${i}`);
    } else $('pg').textContent = `끝`;
    if (anchor !== null && i === anchor) clearAnchor();
    closePop();
    $('sheet').classList.remove('show');
  }
  let scrollT;
  strip.addEventListener('scroll', () => {
    clearTimeout(scrollT);
    scrollT = setTimeout(() => setCurrent(Math.round(Math.abs(strip.scrollLeft) / pageWidth())), 80);
  }, { passive: true });

  const next = () => goTo(cur + 1);
  const prev = () => goTo(cur - 1);
  $('nextPg').onclick = next;
  $('prevPg').onclick = prev;
  slider.oninput = () => ($('pg').textContent = `${+slider.value + 1} / ${N}`);
  slider.onchange = () => jump(+slider.value);
  $('back').onclick = () => { const a = anchor; clearAnchor(); goTo(a); };
  const openVol = (v, page) => v && (location.href = `reader.html?b=${encodeURIComponent(v.id)}${page !== undefined ? `&p=${page}` : ''}`);
  $('prevVol').onclick = () => openVol(prevVol);
  $('nextVol').onclick = () => openVol(nextVol, 0);
  $('goNext')?.addEventListener('click', () => openVol(nextVol, 0));

  // ---------- 탭 처리 ----------
  let uiTimer;
  function showUI(on) {
    document.body.classList.toggle('ui', on);
    clearTimeout(uiTimer);
    if (on) uiTimer = setTimeout(() => document.body.classList.remove('ui'), 4000);
  }
  function hint(msg) {
    const h = $('hint');
    h.textContent = msg;
    h.classList.add('show');
    clearTimeout(h._t);
    h._t = setTimeout(() => h.classList.remove('show'), 1200);
  }
  strip.addEventListener('click', (e) => {
    const hj = e.target.closest('.hj');
    if (hj) return showPop(hj);
    const bub = e.target.closest('.bub');
    if (bub) {
      // 말풍선 배경 탭은 아무것도 하지 않는다(덮개는 절대 사라지지 않음). 열린 뜻 팝업만 닫는다.
      closePop();
      return;
    }
    if (e.target.closest('.endcard')) return;
    closePop();
    const x = e.clientX / strip.clientWidth;
    // 탭으로는 쪽을 넘기지 않는다(한자 누르다 넘어가는 문제). 넘기기는 스와이프·◀▶ 버튼·키보드. 탭은 메뉴 열고 닫기만.
    void x;
    showUI(!document.body.classList.contains('ui'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') (rtl ? prev : next)();
    else if (e.key === 'ArrowLeft') (rtl ? next : prev)();
    else if (e.key === ' ') next();
    else if (e.key === 'Escape') { closePop(); $('sheet').classList.remove('show'); }
  });

  // ---------- 한자/원본 모드 ----------
  const modeKey = 'hanja:mode';
  function applyMode(m) {
    document.body.classList.toggle('orig', m === 'orig');
    $('mode').classList.toggle('on', m !== 'orig');
    H.ls.set(modeKey, m);
  }
  applyMode(H.ls.get(modeKey, 'hanja'));
  $('mode').onclick = () => {
    const m = document.body.classList.contains('orig') ? 'hanja' : 'orig';
    applyMode(m);
    hint(m === 'orig' ? '원본 보기' : '한자 보기');
  };

  // ---------- 단어 팝업 ----------
  const pop = $('pop');
  function showPop(span) {
    const k = span.dataset.k, h = span.dataset.h;
    const e = dict[`${k}|${h}`];
    pop.innerHTML = `<div class="h">${H.esc(h)}</div><div class="k">${H.esc(k)}</div><div class="m${e?.m ? '' : ' wait'}">${H.esc(H.meaning(e))}</div>`;
    pop.classList.add('show');
    const r = span.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(innerWidth - pw - 8, left));
    let top = r.top - ph - 10;
    if (top < 8) top = r.bottom + 10;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    H.tapped(`${k}|${h}`);
  }
  function closePop() { pop.classList.remove('show'); }
  pop.onclick = closePop;

  // ---------- 글 보기 시트 ----------
  const sheet = $('sheet');
  $('text').onclick = () => {
    if (sheet.classList.contains('show')) return sheet.classList.remove('show');
    const bubbles = book.pages[cur]?.bubbles || [];
    sheet.innerHTML = `<button class="btn close" id="sheetClose">닫기</button><div style="font-size:15px;color:#777">${cur + 1}쪽</div>` +
      (bubbles.length ? bubbles.map((b) => `<div class="row ${b.kind || ''}">${H.segsHTML(b.segs, dict)}</div>`).join('') : '<div class="row">이 쪽에는 글이 없습니다</div>');
    sheet.classList.add('show');
    $('sheetClose').onclick = () => sheet.classList.remove('show');
  };
  sheet.addEventListener('click', (e) => {
    const hj = e.target.closest('.hj');
    if (hj) showPop(hj);
  });

  // ---------- 시작 ----------
  addEventListener('resize', layout);
  layout();
  showUI(true);
  if (cur > 0) hint(`${cur + 1}쪽부터 이어서`);
})();
