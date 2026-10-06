/**
 * CarModelStore - Cấu hình kết nối API
 * Hỗ trợ chuyển đổi linh hoạt giữa Localhost và Production/Vercel (Same-Origin).
 */

// 1. URL Mặc định của Backend
// Khi chạy ở localhost (127.0.0.1, localhost hoặc file:), ưu tiên http://localhost:5000
// Khi deploy lên Vercel hoặc remote hosting, tự động sử dụng window.location.origin (same-origin relative)
const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
);

window.DEFAULT_API_URL = isLocalhost 
    ? 'http://localhost:5000' 
    : (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : '');

// 2. Lấy API URL từ localStorage nếu đã được cấu hình trước đó, ngược lại dùng mặc định
// Tự động loại bỏ và làm sạch các URL ngrok cũ/hết hạn đã lưu trong cache
function getApiBaseUrl() {
    try {
        const savedUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('CMS_BACKEND_URL') : null;
        if (savedUrl && savedUrl.trim() !== '') {
            const trimmed = savedUrl.trim();
            if (trimmed.includes('ngrok-free.dev') || trimmed.includes('ngrok.io')) {
                localStorage.removeItem('CMS_BACKEND_URL');
            } else {
                return trimmed.replace(/\/+$/, '');
            }
        }
    } catch (_) {}
    return (window.DEFAULT_API_URL || '').replace(/\/+$/, '');
}

// 3. Hàm lưu URL Backend mới
function setApiBaseUrl(url) {
    try {
        if (!url) {
            localStorage.removeItem('CMS_BACKEND_URL');
        } else {
            localStorage.setItem('CMS_BACKEND_URL', url.trim().replace(/\/+$/, ''));
        }
    } catch (_) {}
    window.API_BASE = getApiBaseUrl();
}

// 4. Wrapper gọi API chuyên dụng
async function apiFetch(endpoint, options = {}) {
    const baseUrl = getApiBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${cleanEndpoint}`;

    // Tự động serialize body nếu là Plain Object
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
        body = JSON.stringify(body);
    }

    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    try {
        const fetchOptions = {
            ...options,
            headers
        };
        if (body !== undefined) {
            fetchOptions.body = body;
        }

        const response = await fetch(url, fetchOptions);
        const data = await response.json().catch(() => null);
        return { ok: response.ok, status: response.status, data };
    } catch (err) {
        console.error('API Fetch Error:', err);
        return { ok: false, status: 0, error: err.message, data: null };
    }
}

window.getApiBaseUrl = getApiBaseUrl;
window.setApiBaseUrl = setApiBaseUrl;
window.apiFetch = apiFetch;
window.API_BASE = getApiBaseUrl();
