/**
 * 글 상세 페이지 — 추천(좋아요) 박스
 * initViewpostLike({ entryId, likes, apiBaseUrl, board })
 */
(function () {
    function isValidObjectId(id) {
        return /^[a-f0-9]{24}$/i.test(String(id || ''));
    }

    function hasUserLiked(entryId) {
        return localStorage.getItem('gb-like-' + entryId) === '1';
    }

    function mountLikeBox() {
        const postContainer = document.getElementById('post-container');
        if (!postContainer) return null;

        let row = postContainer.querySelector('.viewpost-like-row');
        if (!row) {
            row = document.createElement('div');
            row.className = 'viewpost-like-row';
            postContainer.appendChild(row);
        }

        let container = row.querySelector('#viewpost-like-box');
        if (!container) {
            container = document.createElement('div');
            container.id = 'viewpost-like-box';
            container.className = 'viewpost-like-box';
            container.setAttribute('aria-live', 'polite');
            row.appendChild(container);
        }

        const external = document.body.querySelector(':scope > .text-center #viewpost-like-box, :scope > #viewpost-like-box');
        if (external && external !== container) {
            external.closest('.text-center')?.remove();
        }

        return container;
    }

    window.initViewpostLike = function (options) {
        const container = mountLikeBox();
        if (!container) return;

        options = options || {};
        const entryId = String(options.entryId || '');
        const apiBase = options.apiBaseUrl || '';
        const board = options.board || 'guestbook';
        const canLike = isValidObjectId(entryId);
        const liked = canLike && hasUserLiked(entryId);
        let count = parseInt(options.likes, 10) || 0;

        container.innerHTML =
            '<button type="button" class="vp-like-btn' + (liked ? ' is-active' : '') + '"' +
            ' aria-label="추천"' + ((liked || !canLike) ? ' disabled' : '') + '>' +
            '<span class="vp-like-icon" aria-hidden="true">👍</span>' +
            '<span class="vp-like-label">추천</span>' +
            '<strong class="vp-like-count">' + count + '</strong>' +
            '</button>';

        const btn = container.querySelector('.vp-like-btn');
        const countEl = container.querySelector('.vp-like-count');
        if (!btn || !canLike || !apiBase) return;

        function applyLikedState(likes) {
            localStorage.setItem('gb-like-' + entryId, '1');
            btn.classList.add('is-active');
            btn.disabled = true;
            if (countEl) countEl.textContent = likes;
            const metaLikesEl = document.querySelector('#post-meta .post-meta-likes-num');
            if (metaLikesEl) metaLikesEl.textContent = likes;
        }

        btn.addEventListener('click', function () {
            if (btn.disabled || hasUserLiked(entryId)) return;
            btn.disabled = true;

            fetch(apiBase + '/' + board + '/' + entryId + '/like', {
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
                    const likes = result.data.likes != null ? result.data.likes : count + 1;
                    applyLikedState(likes);
                })
                .catch(function (err) {
                    console.error('추천 저장 실패:', err);
                    btn.disabled = false;
                    alert('추천을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
                });
        });
    };
})();
