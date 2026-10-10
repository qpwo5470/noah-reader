# 노아 영어 읽기 (화면)

숙제 사진 → 글자 인식 → 음성 → 단어 하이라이트 리더. 이 레포는 **화면(정적 파일)만** 담고 GitHub Pages로 서빙한다.
사진·음성·텍스트는 비공개 데이터 레포(`qpwo5470/noah-school-studies`)에 저장되고, 처리는 그 레포의 GitHub Actions가 한다.

## 구조
```
태블릿(이 사이트) ──토큰으로 GitHub API──▶ 데이터 레포 inbox/<id>.jpg
                                              │ push → Actions(process-inbox)
                                              ▼ Claude OCR + ElevenLabs TTS
                                         pages/<id>/{page.jpg, thumb.jpg, audio-*.mp3, page.json}
                                         pages/index.json
```
- 업로드: `inbox/<id>.jpg` 커밋 (브라우저에서 긴 변 2000px JPEG로 줄임)
- 텍스트 수정: `inbox/<id>.regen.json` 커밋 → 음성만 다시
- 삭제: `inbox/<id>.delete.json` 커밋 → `pages/<id>` 삭제 (git 기록에는 남음)

## 한자 만화 (`hanja/`)
목차 오른쪽 위 **漢** 버튼. 화면 파일은 데이터 레포 `hanja/web/`이 원본이고 `hanja/tools/sync-web.sh`로 여기 `hanja/`에 복사한다(직접 고치지 말 것).
책 이미지·`book.json`·`dict.json`은 데이터 레포의 `hanja-data` 브랜치에 있고, 위 설정의 같은 토큰으로 읽는다(단어장 뜻 수정은 `dict.json`을 sha와 함께 다시 커밋).

## 기기 설정 (한 번)
1. https://github.com/settings/personal-access-tokens/new 에서 fine-grained 토큰 생성
   - Repository access: Only select repositories → `noah-school-studies`
   - 권한은 링크로 미리 채움: https://github.com/settings/personal-access-tokens/new?name=noah-reader-tablet&contents=write&expires_in=366
2. 사이트의 ⚙️ 설정에 토큰 저장. 토큰은 그 기기 브라우저 localStorage에만 저장된다.
3. 태블릿 홈 화면에 추가 (iPad: Safari 공유 메뉴, 안드로이드: Chrome ⋮ 메뉴).

## 로컬 시험 (외부 API 없이)
```
DATA=/tmp/noah-data PROCESS_CMD="cd ../noah-school-studies && ROOT=/tmp/noah-data MOCK_MODE=1 node app/scripts/process-inbox.js" node dev/mock-github.js
# http://localhost:8787 열고 콘솔에서:
# localStorage['noah.gh']=JSON.stringify({token:'x',api:'http://localhost:8787'})
# 한자 만화: DATA=<hanja-data 내용 폴더> node dev/mock-github.js → http://localhost:8787/hanja/?gh=1
```
