/**

 * 게시판 목록 공통 테이블 렌더러

 * 사용: renderGuestbookTable(container, messages, { postPage, apiMode, board, apiBaseUrl })

 */

(function () {

    function escapeHtml(text) {

        if (!text) return '';

        const div = document.createElement('div');

        div.textContent = text;

        return div.innerHTML;

    }



    function escapeAttr(text) {

        return escapeHtml(text).replace(/"/g, '&quot;');

    }



    function formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return '-';
            const y = date.getFullYear();
            const m = ('0' + (date.getMonth() + 1)).slice(-2);
            const d = ('0' + date.getDate()).slice(-2);
            return y + '/' + m + '/' + d;
        } catch {
            return '-';
        }
    }

    function formatDateTime(dateStr) {
        if (!dateStr) return '-';
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return '-';
            const y = date.getFullYear();
            const m = ('0' + (date.getMonth() + 1)).slice(-2);
            const d = ('0' + date.getDate()).slice(-2);
            const h = ('0' + date.getHours()).slice(-2);
            const min = ('0' + date.getMinutes()).slice(-2);
            return y + '.' + m + '.' + d + '  ' + h + ':' + min;
        } catch {
            return '-';
        }
    }

    function buildTitleMetaLine(dateTimeStr, views, likeCount) {
        return '<div class="gb-title-meta">' +
            '<time class="gb-meta-date">' + escapeHtml(dateTimeStr) + '</time>' +
            '<span class="gb-meta-sep" aria-hidden="true"> · </span>' +
            '<span class="gb-meta-part">조회 <span class="gb-meta-views">' + views + '</span></span>' +
            '<span class="gb-meta-sep" aria-hidden="true"> · </span>' +
            '<span class="gb-meta-part">추천수 <span class="gb-meta-likes">' + likeCount + '</span></span>' +
            '</div>';
    }



    function isMobileView() {

        return window.matchMedia('(max-width: 767px)').matches;

    }



    function isValidObjectId(id) {

        return /^[a-f0-9]{24}$/i.test(String(id || ''));

    }



    function hasUserLiked(entryId) {

        return localStorage.getItem('gb-like-' + entryId) === '1';

    }



    function getLikeDisplayCount(serverLikes) {

        return parseInt(serverLikes, 10) || 0;

    }



    function entryHasImage(entry) {

        const msg = entry && entry.message ? String(entry.message) : '';

        if (!msg) return false;

        return /<img[\s>]/i.test(msg) || /data:image\//i.test(msg);

    }



    const IMAGE_BADGE_HTML =

        '<span class="gb-img-badge" title="이미지 포함" aria-label="이미지 포함">' +

        '<svg class="gb-img-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">' +

        '<rect x="1.5" y="0.5" width="13" height="15" rx="1" fill="#ffffff" stroke="#a0a0a0" stroke-width="0.7"/>' +

        '<path d="M1.5 0.5h3.2v3.2H1.5z" fill="#e8e8e8" stroke="#a0a0a0" stroke-width="0.5"/>' +

        '<rect x="3.2" y="4.2" width="9.6" height="7.2" rx="0.4" fill="#7eb6f7"/>' +

        '<circle cx="5.4" cy="6.1" r="1" fill="#f5c842"/>' +

        '<path d="M3.2 10.8 L5.9 8.1 L7.8 9.6 L10.2 7 L12.8 9.1 V11.4 H3.2 Z" fill="#5cb85c"/>' +

        '</svg></span>';



    function buildShareLinks(url, title) {

        const xUrl = 'https://twitter.com/intent/tweet?text=' +

            encodeURIComponent(title + ' ') + '&url=' + encodeURIComponent(url);

        const mailUrl = 'mailto:?subject=' +

            encodeURIComponent(title) + '&body=' + encodeURIComponent(url);

        return '<span class="gb-share-group">' +

            '<a class="gb-action-btn gb-share-x" href="' + escapeAttr(xUrl) + '" target="_blank" rel="noopener noreferrer" title="X에 공유">𝕏</a>' +

            '<a class="gb-action-btn gb-share-email" href="' + escapeAttr(mailUrl) + '" title="이메일로 공유">✉</a>' +

            '</span>';

    }



    window.renderGuestbookTable = function (container, messages, options) {

        if (!container) return;



        options = options || {};

        const postPage = options.postPage || 'news-voca.html';

        const apiMode = options.apiMode || null;

        const apiParam = apiMode ? '&api=' + apiMode : '';

        const hideViewsAndLikes = options.hideViewsAndLikes === true;

        const colCount = hideViewsAndLikes ? 4 : 7;



        window._gbTableLikeConfig = {

            apiBaseUrl: options.apiBaseUrl || '',

            board: options.board || 'guestbook'

        };



        if (!messages || !messages.entries || messages.entries.length === 0) {

            const emptyClass = hideViewsAndLikes ? ' gb-no-stats' : '';

            container.innerHTML =

                '<div class="gb-table-wrap' + emptyClass + '"><table class="gb-table' + emptyClass + '"><tbody>' +

                '<tr class="gb-empty-row"><td colspan="' + colCount + '">게시글이 없습니다.</td></tr>' +

                '</tbody></table></div>';

            return;

        }



        const total = messages.entries.length;

        const reversedEntries = messages.entries.slice().reverse();

        const rows = reversedEntries.map(function (entry, idx) {

            const originalIndex = total > 0 ? total - 1 - idx : 0;

            if (originalIndex < 0 || originalIndex >= total) return '';



            const number = total - idx;

            const title = escapeHtml(entry.title || '제목 없음');

            const rawTitle = entry.title || '제목 없음';

            const author = escapeHtml(entry.nickname || '익명');

            const dateStr = formatDate(entry.date);
            const dateTimeStr = formatDateTime(entry.date);

            const entryId = String(entry._id || ('idx-' + originalIndex));

            const postUrl = new URL(postPage + '?index=' + originalIndex + apiParam, window.location.href).href;

            const imageBadge = entryHasImage(entry) ? IMAGE_BADGE_HTML : '';

            const views = entry.views || 0;
            const likeCount = getLikeDisplayCount(entry.likes);

            const titleMetaLine = hideViewsAndLikes
                ? buildTitleMetaLine(dateTimeStr, views, likeCount)
                : '';

            const metaMobile =
                '<span class="gb-meta-part gb-meta-author">' + author + '</span>' +
                '<span class="gb-meta-sep" aria-hidden="true">|</span>' +
                '<span class="gb-meta-part gb-meta-date">' + dateStr + '</span>' +
                '<span class="gb-meta-sep" aria-hidden="true">|</span>' +
                '<span class="gb-meta-part">조회 <span class="gb-meta-views">' + views + '</span></span>' +
                '<span class="gb-meta-sep" aria-hidden="true">|</span>' +
                '<span class="gb-meta-part">추천수 <span class="gb-meta-likes">' + likeCount + '</span></span>';

            let statsCells = '';
            if (!hideViewsAndLikes) {
                statsCells = '<td class="gb-col-views">' + views + '</td>';
            }

            if (!hideViewsAndLikes) {
                const canLike = isValidObjectId(entryId);
                const liked = canLike && hasUserLiked(entryId);
                const likeBtnClass = 'gb-action-btn gb-like-btn' + (liked ? ' is-active' : '');
                const likeDisabled = (liked || !canLike) ? ' disabled' : '';
                const likeTitle = !canLike ? '좋아요 불가' : (liked ? '이미 좋아요를 눌렀습니다' : '좋아요 (한 번만 가능)');

                statsCells +=
                    '<td class="gb-col-likes">' +
                    '<span class="gb-like-wrap">' +
                    '<button type="button" class="' + likeBtnClass + '" data-gb-like="' + escapeAttr(entryId) + '" title="' + escapeAttr(likeTitle) + '"' + likeDisabled + '>👍</button>' +
                    '<span class="gb-like-count">' + likeCount + '</span>' +
                    '</span>' +
                    '</td>';
            }

            const metaUnderTitle = hideViewsAndLikes
                ? titleMetaLine
                : '<div class="gb-col-meta-mobile">' + metaMobile + '</div>';

            const dateCell = hideViewsAndLikes ? '' : '<td class="gb-col-date">' + dateStr + '</td>';

            return '<tr data-gb-entry="' + escapeAttr(entryId) + '">' +
                '<td class="gb-col-num">' + number + '</td>' +
                '<td class="gb-col-title">' +
                '<div class="gb-title-stack">' +
                '<span class="gb-title-cell">' +
                '<a href="' + postPage + '?index=' + originalIndex + apiParam + '" title="' + title + '">' + title + '</a>' +
                imageBadge +
                '</span>' +
                metaUnderTitle +
                '</div></td>' +
                '<td class="gb-col-author">' + author + '</td>' +
                dateCell +
                statsCells +
                '<td class="gb-col-share">' + buildShareLinks(postUrl, rawTitle) + '</td>' +
                '</tr>';

        }).join('');



        const mobile = isMobileView();

        const thDate = mobile ? '일자' : '작성일';

        const statsHeaders = hideViewsAndLikes
            ? ''
            : '<th class="col-views">조회수</th>' +
              '<th class="col-likes">Likes</th>';

        const dateHeader = hideViewsAndLikes ? '' : '<th class="col-date">' + thDate + '</th>';

        const noStatsClass = hideViewsAndLikes ? ' gb-no-stats' : '';

        container.innerHTML =

            '<div class="gb-table-wrap' + noStatsClass + '">' +

            '<table class="gb-table' + noStatsClass + '">' +

            '<thead><tr>' +

            '<th class="col-num">번호</th>' +

            '<th class="col-title">제목</th>' +

            '<th class="col-author">작성자</th>' +

            dateHeader +

            statsHeaders +

            '<th class="col-share">공유</th>' +

            '</tr></thead>' +

            '<tbody>' + rows + '</tbody>' +

            '</table></div>';

    };



    if (!window._guestbookTableActionsInit) {

        window._guestbookTableActionsInit = true;

        function handleLikeClick(e) {

            const likeBtn = e.target.closest('.gb-like-btn');

            if (!likeBtn || likeBtn.disabled) return;

            e.preventDefault();

            e.stopPropagation();



            const id = likeBtn.dataset.gbLike;

            if (!id || !isValidObjectId(id) || hasUserLiked(id)) return;



            const config = window._gbTableLikeConfig || {};

            const apiBase = config.apiBaseUrl;

            const board = config.board || 'guestbook';

            if (!apiBase) {

                console.warn('좋아요 API URL이 설정되지 않았습니다.');

                return;

            }



            likeBtn.disabled = true;



            fetch(apiBase + '/' + board + '/' + id + '/like', {

                method: 'POST',

                headers: { 'Content-Type': 'application/json' }

            })

                .then(function (res) {

                    return res.json().then(function (data) {

                        return { ok: res.ok, data: data };

                    });

                })

                .then(function (result) {

                    if (!result.ok) {

                        throw new Error((result.data && result.data.error) || 'Like request failed');

                    }

                    const likes = result.data.likes != null ? result.data.likes : 0;

                    localStorage.setItem('gb-like-' + id, '1');

                    likeBtn.classList.add('is-active');

                    likeBtn.title = '이미 좋아요를 눌렀습니다';

                    const countEl = likeBtn.closest('tr') && likeBtn.closest('tr').querySelector('.gb-like-count');
                    if (countEl) countEl.textContent = likes;

                    const metaLikesEl = likeBtn.closest('tr') && likeBtn.closest('tr').querySelector('.gb-meta-likes');
                    if (metaLikesEl) metaLikesEl.textContent = likes;

                })

                .catch(function (err) {

                    console.error('좋아요 저장 실패:', err);

                    likeBtn.disabled = false;

                    alert('좋아요를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');

                });

        }

        document.addEventListener('click', handleLikeClick);

        document.addEventListener('touchend', function (e) {

            const likeBtn = e.target.closest('.gb-like-btn');

            if (!likeBtn || likeBtn.disabled) return;

            e.preventDefault();

            e.stopPropagation();

            handleLikeClick(e);

        }, { passive: false });

    }

})();


