// API 베이스 URL 설정 (로컬/프로덕션 자동 전환)
// URL 파라미터로 강제 설정 가능: ?api=local 또는 ?api=prod
let API_BASE_URL;
const urlParams = new URLSearchParams(window.location.search);
const apiMode = urlParams.get('api'); // 'local' 또는 'prod'로 강제 설정 가능

if (apiMode === 'prod') {
    // URL 파라미터로 프로덕션 강제 지정
    API_BASE_URL = 'https://port-0-englishwitheasyword-backend-1272llwoib16o.sel5.cloudtype.app';
    console.log('🟢 Production 모드 (강제) - API_BASE_URL:', API_BASE_URL);
} else if (apiMode === 'local') {
    // URL 파라미터로 로컬 강제 지정
    API_BASE_URL = `http://${window.location.hostname}:3000`;
    console.log('🔵 Localhost 모드 (강제) - API_BASE_URL:', API_BASE_URL);
} else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // 자동 감지: 로컬 호스트면 로컬 API 사용
    API_BASE_URL = `http://${window.location.hostname}:3000`;
    console.log('🔵 Localhost 모드 (자동) - API_BASE_URL:', API_BASE_URL);
    console.log('💡 프로덕션 API를 사용하려면 URL에 ?api=prod 를 추가하세요');
} else {
    // 자동 감지: 프로덕션 호스트면 프로덕션 API 사용
    API_BASE_URL = 'https://port-0-englishwitheasyword-backend-1272llwoib16o.sel5.cloudtype.app';
    console.log('🟢 Production 모드 (자동) - API_BASE_URL:', API_BASE_URL);
}

// HTML 이스케이프 헬퍼 함수 (전역)
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// News Voca 시맨틱 HTML + 기본 서식 태그 허용
const NV_ALLOWED_TAGS = [
    'article', 'header', 'footer', 'section', 'nav', 'aside', 'main',
    'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 'mark', 'small', 'sub', 'sup', 'abbr', 'cite', 'q',
    'ol', 'ul', 'li', 'dl', 'dt', 'dd',
    'span', 'div', 'a', 'img', 'button', 'time', 'figure', 'figcaption', 'blockquote',
];
const NV_ALLOWED_ATTRS = [
    'class', 'id', 'href', 'target', 'rel', 'src', 'alt', 'loading', 'decoding',
    'datetime', 'role', 'aria-label', 'aria-hidden', 'aria-labelledby', 'title',
    'itemscope', 'itemtype', 'itemprop', 'data-vv-tts',
    'style', 'onerror',
];

function sanitizeHtml(html) {
    if (!html) return html;
    const div = document.createElement('div');
    div.innerHTML = html;

    const allElements = div.querySelectorAll('*');
    allElements.forEach((el) => {
        const tag = el.tagName.toLowerCase();
        if (!NV_ALLOWED_TAGS.includes(tag)) {
            el.replaceWith(el.textContent);
            return;
        }
        Array.from(el.attributes).forEach((attr) => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') && name !== 'onerror') {
                el.removeAttribute(attr.name);
                return;
            }
            if (!NV_ALLOWED_ATTRS.includes(name)) {
                el.removeAttribute(attr.name);
            }
        });
    });

    return div.innerHTML;
}

const NV_SITE_ORIGIN = 'https://englisheasystudy.com';

function nvPlainText(html, maxLen = 160) {
    const t = vvStripTagsToText(html || '');
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen - 1).trim() + '…';
}

function nvSetMeta(attr, value, useProperty = false) {
    if (!value) return;
    const key = useProperty ? 'property' : 'name';
    let el = document.querySelector(`meta[${key}="${attr}"]`);
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute(key, attr);
        document.head.appendChild(el);
    }
    el.setAttribute('content', value);
}

function nvSetCanonical(url) {
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.appendChild(link);
    }
    link.href = url;
}

function nvInjectArticleJsonLd(post, isoDate, description) {
    const id = 'nv-article-jsonld';
    document.getElementById(id)?.remove();
    const script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    const params = new URLSearchParams(window.location.search);
    const index = params.get('index');
    const pageUrl = index
        ? `${NV_SITE_ORIGIN}/news-voca.html?index=${index}`
        : `${NV_SITE_ORIGIN}/news-voca.html`;
    script.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title || 'News Voca',
        description,
        datePublished: isoDate || undefined,
        author: {
            '@type': 'Organization',
            name: post.nickname || 'English Easy Study',
        },
        publisher: {
            '@type': 'Organization',
            name: 'English Easy Study',
            url: NV_SITE_ORIGIN,
        },
        mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
        inLanguage: ['ko', 'en'],
        keywords: 'News Voca, CNN English, 뉴스 영어 어휘',
    });
    document.head.appendChild(script);
}

function updatePageSeo(post, formattedDate) {
    const title = (post.title || 'News Voca').trim();
    const desc = nvPlainText(post.message, 155);
    const fullTitle = `${title} | News Voca · English Easy Study`;

    document.title = fullTitle;
    nvSetMeta('description', desc);
    nvSetMeta('og:title', title, true);
    nvSetMeta('og:description', desc, true);
    nvSetMeta('twitter:title', title);
    nvSetMeta('twitter:description', desc);

    const params = new URLSearchParams(window.location.search);
    const index = params.get('index');
    const canonical = index
        ? `${NV_SITE_ORIGIN}/news-voca.html?index=${index}`
        : `${NV_SITE_ORIGIN}/news-voca.html`;
    nvSetCanonical(canonical);
    nvSetMeta('og:url', canonical, true);

    let isoDate;
    if (post.date) {
        const d = new Date(post.date);
        if (!isNaN(d.getTime())) isoDate = d.toISOString();
    }
    nvInjectArticleJsonLd(post, isoDate, desc);
}

/** Guestbook View: Web Speech API(브라우저 TTS) */
function vvEscapeAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function vvStripTagsToText(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

function vvNormalizeSpeakText(text) {
    let t = String(text || '').trim();
    // leading keycap numbers/emojis: 1️⃣ 2️⃣ ...
    t = t.replace(/^\s*[0-9#*]\uFE0F?\u20E3\s*/u, '');
    // leading numbered list markers: 1. / 1) / (1)
    t = t.replace(/^\s*(?:\(\d+\)|\d+[.)])\s*/, '');
    // leading bullets/symbols
    t = t.replace(/^[\s\-•·▪▫▶►★☆※]+\s*/, '');
    return t.trim();
}

function vvIsMostlyEnglish(text) {
    const t = String(text || '').trim();
    if (t.length < 8) return false;
    if (/[가-힣]/.test(t)) return false;
    const letters = t.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 6) return false;
    const nonLatin = t.replace(/[a-zA-Z0-9\s.,;:'"!?\-—–…()[\]{}«»‹›\/\\\u2018\u2019\u201c\u201d]/g, '').length;
    return letters.length / (letters.length + nonLatin + 1) > 0.6;
}

function vvStartEnglishTTS(text, btn) {
    if (!text || !window.speechSynthesis) return;
    try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = 0.92;
        u.volume = 1;
        u.pitch = 1;
        const voices = speechSynthesis.getVoices();
        const en =
            voices.find((v) => v.lang && /^en-US/i.test(v.lang)) ||
            voices.find((v) => v.lang && /^en(-|$)/i.test(v.lang));
        if (en) u.voice = en;
        const done = () => {
            if (btn) btn.classList.remove('vv-tts-playing');
        };
        u.onend = done;
        u.onerror = done;
        speechSynthesis.speak(u);
    } catch (e) {
        if (btn) btn.classList.remove('vv-tts-playing');
        console.warn('Guestbook TTS:', e);
    }
}

function vvTtsButtonHtml(speakText) {
    const t = String(speakText || '').trim();
    if (!t) return '';
    const icon =
        '<svg class="vv-tts-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
    return `<button type="button" class="vv-tts-btn" data-vv-tts="${vvEscapeAttr(t)}" aria-label="영어 읽기, 다시 누르면 멈춤" title="듣기 / 다시 누르면 멈춤" style="margin-left:6px;border:0;background:transparent;cursor:pointer;vertical-align:middle;color:#2f80ed;padding:0;">${icon}</button>`;
}

function vvAppendTtsInlineAfterEnglish(lineHtml, speak) {
    if (/vv-tts-btn/i.test(lineHtml)) return lineHtml;
    const btn = vvTtsButtonHtml(speak);
    if (!btn) return lineHtml;
    const s = lineHtml.trimEnd();
    const endRe = /([.!?])((?:\s*<\/[a-zA-Z][a-zA-Z0-9]*\s*>\s*)*)$/;
    const m = s.match(endRe);
    if (m) {
        const prefix = s.slice(0, s.length - m[0].length);
        return prefix + m[1] + btn + m[2];
    }
    return s + btn;
}

function vvBindTtsButtons(container) {
    if (!container) return;
    container.querySelectorAll('.vv-tts-btn').forEach((btn) => {
        if (btn.dataset.vvTtsListener === '1') return;
        btn.dataset.vvTtsListener = '1';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const raw = btn.getAttribute('data-vv-tts');
            if (!raw) return;
            if (!window.speechSynthesis) {
                alert('현재 모바일 브라우저에서는 음성 읽기를 지원하지 않습니다.');
                return;
            }

            const playing =
                btn.classList.contains('vv-tts-playing') &&
                (speechSynthesis.speaking || speechSynthesis.pending);
            if (playing) {
                speechSynthesis.cancel();
                btn.classList.remove('vv-tts-playing');
                return;
            }

            speechSynthesis.cancel();
            container.querySelectorAll('.vv-tts-btn.vv-tts-playing').forEach((b) =>
                b.classList.remove('vv-tts-playing')
            );
            btn.classList.add('vv-tts-playing');
            vvStartEnglishTTS(raw, btn);
        });
    });
}

function attachVocabularyWebTTS(container) {
    if (!container) return;
    try {
        if (window.speechSynthesis) speechSynthesis.getVoices();
    } catch (_) {}

    const paragraphs = container.querySelectorAll(
        'p, .nv-sentence-en, .nv-term, .nv-source-title'
    );
    paragraphs.forEach((p) => {
        if (p.getAttribute('data-vv-tts') === '1') return;

        const lines = p.innerHTML.split(/<br\s*\/?>/i);
        const newLines = lines.map((lineHtml) => {
            if (/class\s*=\s*["'][^"']*vv-tts-btn/i.test(lineHtml)) return lineHtml;
            const plain = vvNormalizeSpeakText(vvStripTagsToText(lineHtml));
            if (!plain) return lineHtml;
            if (!vvIsMostlyEnglish(plain)) return lineHtml;
            if (/^Source\b/i.test(plain) || /^https?:\/\//i.test(plain)) return lineHtml;
            return vvAppendTtsInlineAfterEnglish(lineHtml, plain);
        });

        p.innerHTML = newLines.join('<br>');
        p.setAttribute('data-vv-tts', '1');
    });

    vvBindTtsButtons(container);
}

const NV_URL_IN_TEXT = /(https?:\/\/[^\s<>"'\n\r()]+)/g;

/** 단일 URL → 임베드/링크 HTML (href 속성 안에서는 호출하지 않음) */
function buildMediaHtmlForUrl(url) {
    const youtubeRegex = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/;
    const youtubeMatch = url.match(youtubeRegex);
    if (youtubeMatch) {
        const videoId = youtubeMatch[1];
        const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
        const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
        return `<div class="video-preview-container" style="position: relative; max-width: 100%; margin: 10px 0; cursor: pointer; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1;">
                <a href="${youtubeUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: block; -webkit-tap-highlight-color: rgba(0, 0, 0, 0.3); touch-action: manipulation; position: relative; z-index: 10;">
                    <div class="video-thumbnail" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; background: #000;">
                        <img src="${thumbnailUrl}" alt="YouTube Video" loading="lazy" decoding="async" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none;" onerror="this.src='https://img.youtube.com/vi/${videoId}/hqdefault.jpg'">
                        <div class="play-button" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 68px; height: 48px; background: rgba(23, 35, 34, 0.9); border-radius: 14px; display: flex; align-items: center; justify-content: center; cursor: pointer; pointer-events: none; z-index: 2;">
                            <div style="width: 0; height: 0; border-left: 24px solid white; border-top: 14px solid transparent; border-bottom: 14px solid transparent; margin-left: 6px;"></div>
                        </div>
                    </div>
                </a>
            </div>`;
    }

    const vimeoRegex = /vimeo\.com\/(\d+)/;
    const vimeoMatch = url.match(vimeoRegex);
    if (vimeoMatch) {
        const videoId = vimeoMatch[1];
        const vimeoUrl = `https://vimeo.com/${videoId}`;
        return `<div class="video-preview-container" style="position: relative; max-width: 100%; margin: 10px 0; cursor: pointer; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1;">
                <a href="${vimeoUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: block;">
                    <div class="video-thumbnail" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; background: #000;">
                        <div style="position: absolute; inset: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);"></div>
                        <div style="position: absolute; bottom: 10px; left: 10px; color: white; font-size: 14px; font-weight: 600;">Vimeo Video</div>
                    </div>
                </a>
            </div>`;
    }

    if (url.startsWith('data:image/')) {
        return `<img src="${url}" alt="Image" style="max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0; display: block;">`;
    }

    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i;
    if (imageExtensions.test(url)) {
        return `<img src="${url}" alt="Image" loading="lazy" decoding="async" style="max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0; display: block;" onerror="this.style.display='none';">`;
    }

    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 4px 6px; margin: 2px;">${url}</a>`;
}

/** 텍스트 노드 안의 URL만 변환 (&lt;a href&gt; 속성은 건드리지 않음) */
function convertUrlsInTextNode(textNode) {
    const raw = textNode.nodeValue || '';
    if (!/https?:\/\//.test(raw)) return;

    const parent = textNode.parentElement;
    if (!parent) return;
    if (parent.closest('a')) return;

    NV_URL_IN_TEXT.lastIndex = 0;
    if (!NV_URL_IN_TEXT.test(raw)) return;
    NV_URL_IN_TEXT.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = NV_URL_IN_TEXT.exec(raw)) !== null) {
        if (match.index > lastIndex) {
            frag.appendChild(document.createTextNode(raw.slice(lastIndex, match.index)));
        }
        const box = document.createElement('div');
        box.innerHTML = buildMediaHtmlForUrl(match[1]);
        while (box.firstChild) frag.appendChild(box.firstChild);
        lastIndex = NV_URL_IN_TEXT.lastIndex;
    }
    if (lastIndex < raw.length) {
        frag.appendChild(document.createTextNode(raw.slice(lastIndex)));
    }
    parent.replaceChild(frag, textNode);
}

function convertMediaLinksInHtmlDom(html) {
    const root = document.createElement('div');
    root.innerHTML = html;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);
    textNodes.forEach(convertUrlsInTextNode);
    return root.innerHTML;
}

// 이미지/동영상 링크를 HTML로 변환
function convertMediaLinks(text) {
    if (!text) return text;

    const hasHtml = /<[^>]+>/.test(text);
    let result;

    if (hasHtml) {
        result = convertMediaLinksInHtmlDom(text);
    } else {
        result = escapeHtml(text).replace(NV_URL_IN_TEXT, (url) => buildMediaHtmlForUrl(url));
    }

    result = result.replace(/\n/g, '<br>');
    return sanitizeHtml(result);
}

// 로딩 상태 표시 함수
function showLoading() {
    const postContainer = document.getElementById('post-container');
    postContainer.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <div class="spinner-border text-primary" role="status" style="width: 3rem; height: 3rem;">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p style="margin-top: 15px; color: #666;">게시글을 불러오는 중...</p>
        </div>
    `;
}

// 에러 메시지 표시 함수
function showError(message, details = '') {
    const postContainer = document.getElementById('post-container');
    const apiParam = apiMode ? `?api=${apiMode}` : '';
    postContainer.innerHTML = `
        <div style="text-align: center; padding: 30px; color: #d32f2f; background-color: #ffebee; border-radius: 8px; margin: 20px;">
            <p style="font-size: 1.2em; font-weight: bold; margin-bottom: 10px;">⚠️ ${message}</p>
            ${details ? `<p style="font-size: 0.9em; color: #666; margin-top: 10px;">${details}</p>` : ''}
            <button class="btn btn-primary mt-3" onclick="window.location.href='news-voca-list.html${apiParam}'">목록으로 돌아가기</button>
        </div>
    `;
}

async function loadPost() {
    const params = new URLSearchParams(window.location.search);
    const index = params.get('index');

    if (!index) {
        showError('게시글을 찾을 수 없습니다', 'index 파라미터가 없습니다.');
        return;
    }

    // 로딩 상태 표시
    showLoading();

    try {
        const url = `${API_BASE_URL}/guestbook`;
        console.log('📡 API 요청 URL:', url);
        const response = await fetch(url);
        console.log('📥 응답 상태:', response.status, response.statusText);

        if (!response.ok) {
            if (response.status === 503) {
                const errorData = await response.json();
                showError('데이터베이스 연결 오류', 
                    `${errorData.error || 'MongoDB 연결이 되지 않았습니다.'}<br><br>
                    <strong>해결 방법:</strong><br>
                    1. MongoDB 서비스가 실행 중인지 확인<br>
                    2. backend/.env 파일의 MONGO_URI 설정 확인<br>
                    3. 백엔드 서버를 재시작`);
                return;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const messages = await response.json();
        console.log('📦 응답 데이터:', messages);

        // API 응답 형식 확인 및 정규화
        let entries = [];
        if (Array.isArray(messages)) {
            entries = messages;
        } else if (messages.entries && Array.isArray(messages.entries)) {
            entries = messages.entries;
        } else if (messages.data && Array.isArray(messages.data)) {
            entries = messages.data;
        } else {
            console.error('⚠️ 예상치 못한 응답 형식:', messages);
            showError('게시글을 불러올 수 없습니다', '서버 응답 형식이 올바르지 않습니다.');
            return;
        }

        const indexNum = parseInt(index, 10);
        if (isNaN(indexNum)) {
            showError('게시글을 찾을 수 없습니다', `잘못된 인덱스 파라미터입니다: "${index}". 목록으로 돌아가주세요.`);
            return;
        }
        
        if (indexNum < 0 || indexNum >= entries.length) {
            showError('게시글을 찾을 수 없습니다', `인덱스 ${indexNum}에 해당하는 게시글이 없습니다. (총 ${entries.length}개)`);
            return;
        }

        // 목록에서 전달된 index는 원본 배열 기준이므로 직접 사용
        // 목록에서는 역순으로 표시하지만, index는 total - 1 - idx로 계산되어 원본 배열의 인덱스입니다
        const post = entries[indexNum];
        
        if (!post) {
            showError('게시글을 찾을 수 없습니다', `인덱스 ${indexNum}에 해당하는 게시글이 없습니다.`);
            return;
        }
        
        console.log(`📌 인덱스 ${indexNum}로 게시글 찾기 (총 ${entries.length}개)`);

        // 조회수 증가 API 호출
        try {
            const viewResponse = await fetch(`${API_BASE_URL}/guestbook/${post._id}/view`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (viewResponse.ok) {
                const viewData = await viewResponse.json();
                // 조회수가 업데이트된 경우 게시글 정보 업데이트
                if (viewData.entry && viewData.entry.views !== undefined) {
                    post.views = viewData.entry.views;
                    console.log('👁️ 조회수 업데이트:', post.views);
                }
            }
        } catch (viewError) {
            console.warn('조회수 증가 실패 (무시):', viewError);
            // 조회수 증가 실패해도 게시글은 표시
        }

        console.log('📝 로드된 게시글:', post);
        console.log('📅 게시글 날짜 정보:', post.date, typeof post.date);

        // 게시글 표시 - HTML 구조를 다시 생성
        const postContainer = document.getElementById('post-container');
        
        let postDate;
        let formattedDate = 'Date not available';
        
        if (post.date) {
            try {
                postDate = new Date(post.date);
                console.log('📅 파싱된 날짜:', postDate);
                // 유효한 날짜인지 확인
                if (isNaN(postDate.getTime())) {
                    console.warn('유효하지 않은 날짜:', post.date);
                    formattedDate = 'Date not available';
                } else {
                    // 형식: "2025.12.29  17:00" (날짜와 시간 사이 공백 2개)
                    const year = postDate.getFullYear();
                    const month = ('0' + (postDate.getMonth() + 1)).slice(-2);
                    const day = ('0' + postDate.getDate()).slice(-2);
                    const hours = ('0' + postDate.getHours()).slice(-2);
                    const minutes = ('0' + postDate.getMinutes()).slice(-2);
                    formattedDate = `${year}.${month}.${day}  ${hours}:${minutes}`;
                    console.log('📅 포맷된 날짜:', formattedDate);
                }
            } catch (e) {
                console.error('날짜 파싱 오류:', e, post.date);
                formattedDate = 'Date not available';
            }
        } else {
            console.warn('게시글에 날짜 정보가 없습니다:', post);
            // 날짜가 없으면 현재 시간 사용 (임시)
            const now = new Date();
            const year = now.getFullYear();
            const month = ('0' + (now.getMonth() + 1)).slice(-2);
            const day = ('0' + now.getDate()).slice(-2);
            const hours = ('0' + now.getHours()).slice(-2);
            const minutes = ('0' + now.getMinutes()).slice(-2);
            formattedDate = `${year}.${month}.${day}  ${hours}:${minutes}`;
        }

        // 이미지/동영상 링크 변환하여 표시
        const convertedMessage = convertMediaLinks(post.message || '');
        console.log('원본 메시지:', post.message);
        console.log('변환된 메시지:', convertedMessage);
        
        const metaHtml = typeof buildPostMetaHtml === 'function'
            ? buildPostMetaHtml(post)
            : `<p id="post-meta">조회 ${post.views || 0} · 추천수 ${parseInt(post.likes, 10) || 0}</p>`;

        updatePageSeo(post, formattedDate);

        postContainer.innerHTML = `
            <header id="post-header">
                <h1 id="post-title">${escapeHtml(post.title || '제목 없음')}</h1>
                ${metaHtml}
            </header>
            <article id="post-content">
                <div id="post-message" class="post-message-body">${convertedMessage || '<p class="nv-empty">내용이 없습니다.</p>'}</div>
            </article>
        `;
        
        // 게시글 내용 복사 시 HTML 태그 제거하고 순수 텍스트만 복사
        const postMessage = document.getElementById('post-message');
        if (postMessage) {
            postMessage.addEventListener('copy', (e) => {
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    // 선택된 영역의 순수 텍스트만 추출
                    const selectedText = range.toString();
                    
                    // 클립보드에 순수 텍스트만 넣기
                    e.clipboardData.setData('text/plain', selectedText);
                    e.preventDefault(); // 기본 동작 방지 (HTML 복사 방지)
                }
            });
        }
        const postContent = document.getElementById('post-content');
        if (postContent) attachVocabularyWebTTS(postContent);

        // 버튼 기능 연결
        document.getElementById('backBtn').onclick = () => {
            const apiParam = apiMode ? `?api=${apiMode}` : '';
            window.location.href = `news-voca-list.html${apiParam}`;
        };
        
        document.getElementById('editBtn').onclick = async () => {
            const password = prompt('비밀번호를 입력하세요:');
            if (!password) return;
            
            try {
                const response = await fetch(`${API_BASE_URL}/viewpost`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ id: post._id, password })
                });
                if (response.ok) {
                    const data = await response.json();
                    const entry = data.entry;
                    
                    // 수정 폼에 데이터 채우기
                    document.getElementById('edit-id').value = entry._id;
                    document.getElementById('edit-title').value = entry.title;
                    document.getElementById('edit-message').value = entry.message;
                    document.getElementById('edit-nickname').value = entry.nickname;
                    document.getElementById('edit-isSecret').checked = entry.isSecret;
                    
                    // 게시글 컨테이너 숨기고 수정 폼 표시
                    document.getElementById('post-container').style.display = 'none';
                    document.getElementById('viewpost-actions').style.display = 'none';
                    document.getElementById('edit-post-container').style.display = 'block';
                    
                    // 페이지 상단으로 스크롤 (수정 폼이 전체 화면을 차지하므로)
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    const errorData = await response.json();
                    alert(`오류: ${errorData.error || '게시글을 불러올 수 없습니다.'}`);
                }
            } catch (error) {
                console.error('Error while fetching post for edit:', error);
                alert('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
            }
        };
        
        // 수정 폼 제출 처리
        document.getElementById('edit-guestbook-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.target;
            const submitButton = form.querySelector('button[type="submit"]');
            const originalButtonText = submitButton.textContent;
            
            // 로딩 상태 표시
            submitButton.disabled = true;
            submitButton.textContent = '수정 중...';
            
            const id = document.getElementById('edit-id').value;
            const title = document.getElementById('edit-title').value.trim();
            const message = document.getElementById('edit-message').value.trim();
            const nickname = document.getElementById('edit-nickname').value.trim();
            const password = document.getElementById('edit-password').value;
            const isSecret = document.getElementById('edit-isSecret').checked;

            try {
                const response = await fetch(`${API_BASE_URL}/updatepost`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ id, password, title, message, nickname, isSecret })
                });

                if (response.ok) {
                    // 수정 완료 후 페이지 새로고침
                    const apiParam = apiMode ? `&api=${apiMode}` : '';
                    window.location.href = `${window.location.pathname}?index=${window.currentIndex}${apiParam}`;
                } else {
                    const errorData = await response.json();
                    alert(`오류: ${errorData.error || '게시글 수정에 실패했습니다.'}`);
                    submitButton.textContent = originalButtonText;
                }
            } catch (error) {
                console.error('Error while updating guestbook entry:', error);
                alert('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
                submitButton.textContent = originalButtonText;
            } finally {
                submitButton.disabled = false;
            }
        });
        
        // Cancel 버튼 처리
        document.getElementById('cancelEditBtn').onclick = () => {
            document.getElementById('edit-post-container').style.display = 'none';
            document.getElementById('post-container').style.display = 'block';
            document.getElementById('viewpost-actions').style.display = 'flex';
            document.getElementById('edit-guestbook-form').reset();
        };
        
        document.getElementById('deleteBtn').onclick = async () => {
            const password = prompt('비밀번호를 입력하세요:');
            if (!password) return;
            
            if (!confirm('정말로 이 게시글을 삭제하시겠습니까?')) return;
            
            try {
                const response = await fetch(`${API_BASE_URL}/deletepost`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ id: post._id, password })
                });
                if (response.ok) {
                    alert('게시글이 삭제되었습니다.');
                    const apiParam = apiMode ? `?api=${apiMode}` : '';
                    window.location.href = `news-voca-list.html${apiParam}`;
                } else {
                    const errorData = await response.json();
                    alert(`오류: ${errorData.error || '게시글 삭제에 실패했습니다.'}`);
                }
            } catch (error) {
                console.error('Error while deleting post:', error);
                alert('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
            }
        };

    } catch (error) {
        console.error('❌ Error while loading post:', error);
        showError('게시글을 불러올 수 없습니다', 
            `백엔드 서버(${API_BASE_URL})가 실행 중인지 확인해주세요.<br><br>
            <strong>에러 메시지:</strong> ${error.message}`);
    }
}

loadPost();
