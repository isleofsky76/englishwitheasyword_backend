/**
 * page30 guestbook / viewpost 계열 공통 API 베이스 URL
 * 라이브(englisheasystudy.com 등)에서는 항상 프로덕션 백엔드로 연결됩니다.
 * URL만 바뀌면 이 파일의 PRODUCTION_API_BASE 한 줄만 수정하면 됩니다.
 */
(function () {
    var PRODUCTION_API_BASE = 'https://port-0-englishwitheasyword-backend-1272llwoib16o.sel5.cloudtype.app';

    function isLocalHost(hostname) {
        return hostname === 'localhost' || hostname === '127.0.0.1';
    }

    /**
     * @returns {string} API origin (no trailing slash)
     */
    function getPage30ApiBaseUrl() {
        var params = new URLSearchParams(window.location.search);
        var customBase = params.get('apiBase');
        if (customBase) {
            try {
                var parsed = new URL(customBase);
                if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                    return parsed.origin;
                }
            } catch (e) { /* ignore */ }
        }
        if (params.get('api') === 'prod') return PRODUCTION_API_BASE;
        if (params.get('api') === 'local') {
            return 'http://' + window.location.hostname + ':3000';
        }
        var h = window.location.hostname;
        if (isLocalHost(h)) {
            return 'http://' + h + ':3000';
        }
        return PRODUCTION_API_BASE;
    }

    window.PAGE30_PRODUCTION_API_BASE = PRODUCTION_API_BASE;
    window.getPage30ApiBaseUrl = getPage30ApiBaseUrl;
})();
