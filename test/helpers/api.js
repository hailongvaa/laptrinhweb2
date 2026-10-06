const { API_BASE_URL } = require('./config');

async function request(path, options = {}) {
    const url = `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
    const headers = {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        ...(options.headers || {})
    };

    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof String)) {
        body = JSON.stringify(body);
    }

    const res = await fetch(url, {
        ...options,
        headers,
        body
    });

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        try {
            data = await res.json();
        } catch {
            data = null;
        }
    } else {
        data = await res.text();
    }

    return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        data
    };
}

const api = {
    health: () => request('/api/health'),
    getProducts: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return request(`/api/products${query ? '?' + query : ''}`);
    },
    getProduct: (id) => request(`/api/products/${id}`),
    getBrands: () => request('/api/brands'),
    getAccessories: () => request('/api/accessories'),
    createOrder: (payload) => request('/api/orders', { method: 'POST', body: payload }),
    updateOrderStatus: (code, status) => request(`/api/orders/${encodeURIComponent(code)}/status`, {
        method: 'PUT',
        body: { status }
    }),
    cancelOrder: (code) => request(`/api/orders/${encodeURIComponent(code)}/status`, {
        method: 'PUT',
        body: { status: 'cancelled' }
    }),
    getTracking: (code) => request(`/api/tracking/${encodeURIComponent(code)}`),
    getOrders: (customerId) => {
        const query = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : '';
        return request(`/api/orders${query}`);
    },
    getDashboardStats: () => request('/api/dashboard/stats'),
    register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
    login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
    contact: (payload) => request('/api/contact', { method: 'POST', body: payload }),
    raw: request
};

module.exports = api;
