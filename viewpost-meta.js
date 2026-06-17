/**
 * 글 상세 — 제목 아래 메타 (날짜 · 조회 · 추천수)
 */
(function () {
    function escapeMetaHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function escapeMetaAttr(text) {
        return escapeMetaHtml(text).replace(/"/g, '&quot;');
    }

    function formatPostMetaDateTime(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '-';
            const y = d.getFullYear();
            const m = ('0' + (d.getMonth() + 1)).slice(-2);
            const day = ('0' + d.getDate()).slice(-2);
            const h = ('0' + d.getHours()).slice(-2);
            const min = ('0' + d.getMinutes()).slice(-2);
            return y + '.' + m + '.' + day + '  ' + h + ':' + min;
        } catch {
            return '-';
        }
    }

    window.buildPostMetaHtml = function (post) {
        const dateTimeStr = formatPostMetaDateTime(post && post.date);
        const views = (post && post.views) || 0;
        const likes = parseInt(post && post.likes, 10) || 0;
        let isoMeta = '';
        if (post && post.date) {
            const d = new Date(post.date);
            if (!isNaN(d.getTime())) isoMeta = d.toISOString();
        }

        return '<p id="post-meta">' +
            '<time datetime="' + escapeMetaAttr(isoMeta) + '">' + escapeMetaHtml(dateTimeStr) + '</time>' +
            '<span class="post-meta-sep" aria-hidden="true"> · </span>' +
            '<span class="post-meta-part">조회 <span class="post-meta-views-num">' + views + '</span></span>' +
            '<span class="post-meta-sep" aria-hidden="true"> · </span>' +
            '<span class="post-meta-part">추천수 <span class="post-meta-likes-num">' + likes + '</span></span>' +
            '</p>';
    };
})();
