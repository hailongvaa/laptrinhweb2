# Handoff Report — Explorer 2: Frontend Architecture & UI Freeze Mapping (R1 & R3)

**Agent**: Explorer 2 (`teamwork_preview_explorer`)  
**Working Directory**: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_survey_2`  
**Parent Orchestrator ID**: `8d541fff-80dd-457d-bc7c-cd842c463674`  
**Authoritative References**: `d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md` (R1 UI Freeze, R2 ACID Transaction, R3 Client/Admin Sync)

---

## 1. Observation

### 1.1 File Existence & Architecture Scope
- **File Search (`find_by_name` pattern `*checkout*`)**:
  - Command: `find_by_name` with `Pattern: "*checkout*"` on `d:\laptrinhweb - Copy`.
  - Result: `Found 0 results`. No standalone `checkout.html` exists in the repository.
  - Inspection of `cart.html` (lines 108–140, 201–212, 427–516): Checkout is implemented as an inline modal (`<div id="checkoutModal">`) directly within `cart.html`. All references in the original request to "checkout" correspond to `#checkoutModal` and its form `#orderForm` inside `cart.html`.

### 1.2 `account.html`: Order Fetching, Rendering, and Cancellation
- **Path**: `d:\laptrinhweb - Copy\account.html` (Total 359 lines)
- **DOM Structure & Selectors**:
  - Profile Section:
    - Avatar: `#userAvatar` (`<div id="userAvatar">U</div>`, line 71)
    - Name: `#userName` (`<h3 id="userName">Họ và tên</h3>`, line 73)
    - Role: `#userRole` (`<span id="userRole">Khách hàng</span>`, line 74)
    - Email: `#userEmail` (`<div id="userEmail">email@domain.com</div>`, line 80)
    - Phone: `#userPhone` (`<div id="userPhone">---</div>`, line 85)
    - Address: `#userAddress` (`<div id="userAddress">---</div>`, line 90)
    - Logout link: `#btnAccountLogout` (line 93)
  - Order History Section:
    - Refresh button: `#btnRefreshOrders` (line 103)
    - Loading indicator: `#accountLoading` (line 106)
    - Empty state: `#accountEmptyOrders` (line 110)
    - Table wrapper: `#ordersTableWrap` (line 117)
    - Table element: `<table class="data-table">` (line 118)
    - Table body: `#accountOrdersTableBody` (line 129)
  - Modal Cập Nhật Trạng Thái (Cancellation / Status Update):
    - Modal container: `#updateStatusModal` (line 139)
    - Modal title: `#modalOrderCodeTitle` (line 143)
    - Close button: `#btnCloseStatusModal` (line 143)
    - Status select: `#userStatusSelect` (line 149) with options `pending`, `confirmed`, `cancelled`
    - Cancel button: `#btnCancelStatusModal` (line 156)
    - Save button: `#btnSaveUserStatus` (line 157)
- **Direct Code Observation (Lines 254–260)**:
  ```javascript
  // Gọi API lấy đơn hàng theo customer_id
  const endpoint = user.id ? `/api/orders?customer_id=${encodeURIComponent(user.id)}` : '/api/orders';
  const res = await apiFetch(endpoint);

  loading.style.display = 'none';

  if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
  ```
- **Backend Response Mismatch in `server.js` (Lines 341–344)**:
  ```javascript
  const result = await request.query(queryStr);
  res.json({
      success: true,
      orders: result.recordset
  });
  ```
  `res.data` returned by `apiFetch` is an object `{ success: true, orders: [...] }`. Therefore `Array.isArray(res.data)` strictly evaluates to `false`. The order table is never shown in `account.html`!
- **Cancellation Execution in `account.html` (Lines 336–340)**:
  ```javascript
  const res = await apiFetch('/api/orders/' + encodeURIComponent(currentSelectedOrderCode) + '/status', {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus })
  });
  ```
  In `server.js` (lines 408–419), when `status === 'cancelled'`, the backend restores product stock:
  `UPDATE p SET p.stock_quantity = p.stock_quantity + oi.quantity FROM products p INNER JOIN order_items oi ON p.id = oi.product_id WHERE oi.order_id = @orderId`.

### 1.3 `admin/dashboard.html`: Statistics, Recent Orders, and Real-Time Sync
- **Path**: `d:\laptrinhweb - Copy\admin\dashboard.html` (Total 666 lines)
- **DOM Structure & Selectors**:
  - Card 1 (Revenue): `.stat-card--revenue .stat-card__value` (lines 196–199)
  - Card 2 (Products): `.stat-card--products .stat-card__value` (lines 218–221)
  - Card 3 (Orders): `.stat-card--orders .stat-card__value` (lines 242–245), and Pending Orders description `.stat-card--orders .trend-desc` (lines 251–253)
  - Card 4 (Brands): `.stat-card--brands .stat-card__value` (lines 265–268)
  - Pure CSS 12-Month Chart: `.chart-card .css-chart` (lines 285–463)
  - Top 5 Recent Orders Table:
    - Container: `.table-card` (line 466)
    - Link to all orders: `.table-card__header a` (line 472: `<a href="orders.html" class="btn btn-outline btn-sm">Xem tất cả 42 đơn &rarr;</a>`)
    - Table body: `.table-card tbody` (line 488)
- **Direct Code Observation (Lines 587–621)**:
  ```javascript
  const res = await apiFetch('/api/dashboard/stats');
  if (res.ok && res.data && res.data.success) {
      const stats = res.data.stats || {};
      const recentOrders = res.data.recentOrders || [];

      // 1. Đồng bộ 4 Card KPI Doanh thu và Số liệu
      const revEl = document.querySelector('.stat-card--revenue .stat-card__value');
      if (revEl && stats.total_revenue !== undefined) {
          revEl.textContent = Number(stats.total_revenue).toLocaleString('vi-VN') + '₫';
      }
      // ... stats.total_products, stats.total_orders, stats.pending_orders, stats.total_brands
      // 2. Đồng bộ bảng 5 đơn hàng mới nhất
      const tbody = document.querySelector('.table-card tbody');
  ```
- **Backend Query Observation in `server.js` (Lines 139–160)**:
  `statsQuery` returns `total_products`, `total_orders`, `pending_orders`, `total_brands`, `total_revenue`.
  `recentOrdersQuery` returns `TOP 5 o.id, o.order_code, o.customer_id, o.recipient_name, o.recipient_phone, o.shipping_address, o.total_amount, o.order_status, o.tracking_code, o.created_at, first_item_name FROM orders o ORDER BY o.created_at DESC`.

### 1.4 `contact.html`: Parcel Tracking & PII Masking
- **Path**: `d:\laptrinhweb - Copy\contact.html` (Total 297 lines)
- **DOM Structure & Selectors**:
  - Lookup Form: `#trackingLookupForm` (line 109)
  - Input: `#trackingCodeInput` (line 110)
  - Button: `#btnTrackOrder` (line 111)
  - Alert container: `#trackingAlert` (line 114)
  - Result Box: `#trackingResultBox` (line 116)
  - Tracking code display: `#trackResTrackingCode` (line 120)
  - Order code display: `#trackResOrderCode` (line 124)
  - Status badge: `#trackResStatusBadge` (line 127)
  - Carrier: `#trackResCarrier` (line 132)
  - Current location: `#trackResLocation` (line 133)
  - Estimated delivery date: `#trackResEstDate` (line 134)
  - Recipient field: `#trackResRecipient` (line 135)
  - Total payment: `#trackResTotal` (line 136)
  - Shipment notes: `#trackResNotes` (line 137)
  - Items list: `#trackResItemsList` (line 142)
- **Direct Code Observation (Lines 234–260)**:
  ```javascript
  const res = await apiFetch('/api/tracking/' + encodeURIComponent(code));
  // ...
  document.getElementById('trackResRecipient').textContent = `${d.recipient_name || ''} (${d.recipient_phone || ''})`;
  ```
- **Observation on PII Masking in `server.js` (Lines 587–606)**:
  `server.js` queries:
  ```sql
  SELECT o.id as order_id, o.order_code, o.tracking_code, o.recipient_name, o.recipient_phone, o.shipping_address, ...
  ```
  Backend directly returns raw `recipient_name`, `recipient_phone`, and `shipping_address` with **NO masking**. Frontend `contact.html` also injects raw strings without masking.

### 1.5 `cart.html`: Cart Persistence & Modal Checkout Flow
- **Path**: `d:\laptrinhweb - Copy\cart.html` (Total 525 lines)
- **DOM Structure & Selectors**:
  - Cart Table Body: `#cartTableBody` (line 71)
  - Cart Empty Alert: `#cartEmptyNotice` (line 74)
  - Cart Login Required Alert: `#cartLoginNotice` (line 78)
  - Cart Subtotal: `#cartSubtotal` (line 87)
  - Cart Total: `#cartTotal` (line 89)
  - Checkout Button: `#btnOpenCheckout` (line 90)
  - Server Status Info: `#serverStatusBadge` (line 96), `#customBackendUrl` (line 99), `#btnSaveBackendUrl` (line 100)
  - Checkout Modal: `#checkoutModal` (line 108)
    - Close button: `#btnCloseCheckout` (line 112)
    - Order Form: `#orderForm` (line 114)
    - Recipient Name: `#recipientName` (line 117)
    - Recipient Phone: `#recipientPhone` (line 121)
    - Shipping Address: `#shippingAddress` (line 125)
    - Modal Total: `#modalCheckoutTotal` (line 130)
    - Order Alert: `#orderAlert` (line 133)
    - Cancel Button: `#btnCancelCheckout` (line 135)
    - Submit Button: `#btnSubmitOrder` (line 136)
  - Success Modal: `#successModal` (line 143)
    - Order Code: `#successOrderCode` (line 149)
    - Tracking Code: `#successTrackingCode` (line 150)
    - Order Total: `#successOrderTotal` (line 151)
    - Back to Home Button: `#btnBackToHome` (line 154)

### 1.6 Script & Helper Observations (`assets/js/`)
- **`config.js` (`apiFetch`)**:
  Lines 36–57: `apiFetch` does not check if `options.body` is a raw object. If passed `{ ... }` (as in `login.html` line 156 and `register.html` line 145), standard browser `fetch` converts the body to string `"[object Object]"`, causing `SyntaxError: Unexpected token o in JSON` on Express `express.json()`.
- **`admin-auth.js` (`AdminAuth.login`)**:
  Lines 78–84: Sets `customerUser = { email, name, role: 'customer', loginAt }`. Notably, `customerUser.id` is omitted. When `account.html` checks `user.id`, it is `undefined`, causing `account.html` to query `/api/orders` without `customer_id`, exposing all orders.

---

## 2. Logic Chain

1. **Premise 1 (R1 Mandate)**:
   Per `ORIGINAL_REQUEST.md` (R1), 100% of HTML/CSS markup, classes, styling, colors, and fonts are frozen. All bug fixes and feature enhancements must occur in script logic, API query parameters, payload structures, event handlers, and data transformations.
2. **Premise 2 (Order Rendering Bug in `account.html`)**:
   - `account.html` line 259 guards table population with `if (res.ok && Array.isArray(res.data) && res.data.length > 0)`.
   - `server.js` line 341 returns `{ success: true, orders: result.recordset }`.
   - In `config.js`, `apiFetch` parses the response body into `res.data`. Thus `res.data` is an Object with key `orders`, NOT an Array.
   - Deduction: `Array.isArray(res.data)` evaluates to `false`. Therefore, the table never renders and the empty notice `#accountEmptyOrders` is displayed even when orders exist in the database.
   - Resolution: Update `account.html` script to extract orders via:
     `const orderList = Array.isArray(res.data) ? res.data : (res.data?.orders || []);`
3. **Premise 3 (Customer Order Scoping & Privacy)**:
   - In `account.html` line 254: `const endpoint = user.id ? '/api/orders?customer_id=' + encodeURIComponent(user.id) : '/api/orders'`.
   - If a customer logs in without an `id` attribute in `cms_auth_user`, `/api/orders` is called without parameters, returning orders belonging to ALL users.
   - Deduction: Customer scoping must be resilient: if `user.id` is available, filter by `customer_id`; if not, pass `email=${user.email}`. Backend `/api/orders` should support filtering by either `customer_id` or `email`.
4. **Premise 4 (Order Cancellation State Machine & Row Locking)**:
   - In `account.html` lines 329–354, changing status to `cancelled` calls `PUT /api/orders/:code/status`.
   - In `server.js` lines 369–421, the status update runs in a transaction:
     - Updates `orders.order_status = 'cancelled'`.
     - Updates `shipments.shipping_status = 'cancelled'`.
     - Automatically returns product quantities: `UPDATE p SET p.stock_quantity = p.stock_quantity + oi.quantity FROM products p INNER JOIN order_items oi ON p.id = oi.product_id WHERE oi.order_id = @orderId`.
   - Deduction: The cancellation logic matches R2 and R3. To uphold UX and business integrity in `account.html` without changing HTML:
     - When the user selects `cancelled`, prompt for confirmation (`confirm(...)`).
     - Disable status modification if the order is already in `shipping`, `delivered`, or `cancelled` state.
5. **Premise 5 (PII Masking Requirement in R3)**:
   - `ORIGINAL_REQUEST.md` (R3) specifies: "API tra cứu hành trình vận đơn (`/api/tracking/:code`) trả về đúng thông tin kiện hàng, mã đơn, sản phẩm và che mờ thông tin nhạy cảm (PII masking)."
   - Direct observation shows both `server.js` lines 587–606 and `contact.html` line 259 expose raw customer name, phone, and address.
   - Deduction: Both tiers should ensure PII masking:
     - Backend `/api/tracking/:code` must mask `recipient_name` (e.g., `Nguyễn Văn A` -> `Nguyễn V** A`) and `recipient_phone` (e.g., `0912345678` -> `0912***678`).
     - Frontend `contact.html` must include a defensive fallback masking utility to guarantee no plain PII is rendered on screen.
6. **Premise 6 (Admin Dashboard Synchronization)**:
   - `admin/dashboard.html` lines 586–658 dynamically bind data from `/api/dashboard/stats`.
   - The backend `/api/dashboard/stats` query accurately computes `total_revenue`, `total_products`, `total_orders`, `pending_orders`, `total_brands`, and `recentOrders`.
   - Deduction: The data pipeline between `server.js` and `admin/dashboard.html` is structurally intact. To complete R3 compliance, the text link "Xem tất cả 42 đơn" can be dynamically updated to reflect `stats.total_orders`.
7. **Premise 7 (`apiFetch` Payload Robustness)**:
   - In `assets/js/config.js`, `apiFetch` lacks automatic body serialization.
   - Deduction: Adding automatic JSON serialization for non-string, non-FormData object bodies in `apiFetch` prevents serialization bugs across `login.html`, `register.html`, and any future callers without modifying any UI markup.

---

## 3. Caveats

1. **Non-existence of `checkout.html`**:
   The prompt and dispatch list mentioned `checkout.html`. Comprehensive file searches confirmed no file named `checkout.html` exists in this repository. Checkout is an embedded modal (`#checkoutModal`) inside `cart.html`. All cataloging and migration instructions treat `cart.html` as the authoritative checkout entry point.
2. **Cross-Tab & Multi-Device Session State**:
   User sessions rely on `localStorage` keys (`cms_auth_user` and `carModelStoreCurrentUser`). If the user clears browser data or switches browsers, `user.id` is lost until they log in again.
3. **Database Connection Requirement for Verification**:
   Full end-to-end data flow verification requires SQL Server (LocalDB or Docker instance) running with `CarModelStoreDB` schema migrated.

---

## 4. Conclusion & Actionable Blueprint

### 4.1 Strict R1 100% UI Freeze Catalog
Under R1, the following DOM structures, CSS classes, IDs, and layouts must **NEVER** be modified in markup:

| File | DOM Elements / Classes / IDs to Freeze | Styling / Structure Invariant |
|---|---|---|
| `account.html` | `#userName`, `#userAvatar`, `#userRole`, `#userEmail`, `#userPhone`, `#userAddress`, `#btnAccountLogout`, `#btnRefreshOrders`, `#accountLoading`, `#accountEmptyOrders`, `#ordersTableWrap`, `.data-table`, `#accountOrdersTableBody`, `#updateStatusModal`, `#modalOrderCodeTitle`, `#btnCloseStatusModal`, `#userStatusSelect`, `#btnCancelStatusModal`, `#btnSaveUserStatus` | Two-column grid (`320px 1fr`), Dark Slate profile card (`#1e293b`), Pure White order table card (`#fff`), Badges (`.status-badge`), Monospace order code formatting. |
| `admin/dashboard.html` | `.admin-layout`, `.admin-sidebar`, `.admin-main`, `.admin-topbar`, `.stat-card--revenue`, `.stat-card--products`, `.stat-card--orders`, `.stat-card--brands`, `.stat-card__value`, `.trend-desc`, `.chart-card`, `.css-chart`, `.table-card`, `.data-table`, `tbody`, `.badge` | Fixed 260px sidebar (`var(--sidebar-width)`), 4-card KPI grid (`.stat-grid`), pure CSS bar chart columns, table responsive wrapper. |
| `contact.html` | `#contactForm`, `#name`, `#email`, `#message`, `#contactSuccess`, `#trackingLookupForm`, `#trackingCodeInput`, `#btnTrackOrder`, `#trackingAlert`, `#trackingResultBox`, `#trackResTrackingCode`, `#trackResOrderCode`, `#trackResStatusBadge`, `#trackResCarrier`, `#trackResLocation`, `#trackResEstDate`, `#trackResRecipient`, `#trackResTotal`, `#trackResNotes`, `#trackResItemsList`, `.map-card` | Wide card containers (`.form-card--wide`), Green monospace tracking badge (`#trackResTrackingCode`), Blue monospace order badge (`#trackResOrderCode`), Embedded Google Maps iframe. |
| `cart.html` | `#cartTableBody`, `#cartEmptyNotice`, `#cartLoginNotice`, `#cartSubtotal`, `#cartTotal`, `#btnOpenCheckout`, `#checkoutModal`, `#orderForm`, `#recipientName`, `#recipientPhone`, `#shippingAddress`, `#modalCheckoutTotal`, `#orderAlert`, `#btnCancelCheckout`, `#btnSubmitOrder`, `#successModal`, `#successOrderCode`, `#successTrackingCode`, `#successOrderTotal`, `#btnBackToHome` | Cart layout with aside summary card, 2-column flex, dark-themed server status badge, fixed overlay modal dialogs (`z-index: 9999` and `10000`). |

### 4.2 Exact Script & Logic Changes Required for R3 (Zero HTML/CSS Changes)

#### Action 1: Fix `account.html` Order History Rendering & Order Scoping
- **Target File**: `d:\laptrinhweb - Copy\account.html`
- **Location**: Script block around lines 253–262
- **Change**:
  ```javascript
  // Trước:
  const endpoint = user.id ? `/api/orders?customer_id=${encodeURIComponent(user.id)}` : '/api/orders';
  const res = await apiFetch(endpoint);
  if (res.ok && Array.isArray(res.data) && res.data.length > 0) { ... }

  // Sau (Sửa đổi logic):
  let endpoint = '/api/orders';
  if (user.id) {
      endpoint += `?customer_id=${encodeURIComponent(user.id)}`;
  } else if (user.email) {
      endpoint += `?customer_email=${encodeURIComponent(user.email)}`;
  }
  const res = await apiFetch(endpoint);
  const orders = Array.isArray(res.data) ? res.data : (res.data?.orders || []);

  if (res.ok && orders.length > 0) {
      // Render orders table using 'orders'
      // Trong cột Mã vận đơn, liên kết trực tiếp sang contact.html với query param:
      // <a href="contact.html?code=${encodeURIComponent(trackCode)}" ...>${trackCode}</a>
  } else {
      emptyNotice.style.display = 'block';
  }
  ```

#### Action 2: Enhance Cancellation Guard in `account.html`
- **Target File**: `d:\laptrinhweb - Copy\account.html`
- **Location**: Event listener for `#btnSaveUserStatus` (lines 329–354)
- **Change**:
  - If `newStatus === 'cancelled'`, add confirmation prompt:
    `if (!confirm('Bạn có chắc chắn muốn hủy đơn hàng này? Số lượng xe mô hình sẽ được hoàn lại vào kho.')) return;`
  - In row action buttons, disable editing or alert if order is already `cancelled` or `completed`:
    `if (['cancelled', 'completed', 'delivered'].includes(curStatus)) { alert('Đơn hàng ở trạng thái này không thể thay đổi!'); return; }`

#### Action 3: PII Masking Implementation in `contact.html` & `server.js`
- **Frontend Target**: `d:\laptrinhweb - Copy\contact.html` (lines 255–262)
- **Masking Logic**:
  ```javascript
  function maskPIIName(name) {
      if (!name) return '***';
      const words = name.trim().split(/\s+/);
      return words.map(w => w.length <= 2 ? w : w[0] + '*'.repeat(Math.max(1, w.length - 2)) + w[w.length - 1]).join(' ');
  }
  function maskPIIPhone(phone) {
      if (!phone) return '***';
      const clean = phone.trim();
      return clean.length >= 7 ? clean.slice(0, 4) + '***' + clean.slice(-3) : '***';
  }

  // Gán vào DOM:
  document.getElementById('trackResRecipient').textContent = 
      `${maskPIIName(d.recipient_name)} (${maskPIIPhone(d.recipient_phone)})`;
  ```
- **Backend Target**: `car-store-backend/server.js` (`/api/tracking/:code` endpoint)
  Mask `recipient_name` and `recipient_phone` prior to sending JSON response.

#### Action 4: Auto-Stringify Body in `assets/js/config.js`
- **Target File**: `d:\laptrinhweb - Copy\assets\js\config.js`
- **Location**: `apiFetch` function (lines 40–50)
- **Change**:
  ```javascript
  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
      body = JSON.stringify(body);
  }
  const response = await fetch(url, {
      ...options,
      body,
      headers
  });
  ```

#### Action 5: Dynamic Counter Sync in `admin/dashboard.html`
- **Target File**: `d:\laptrinhweb - Copy\admin\dashboard.html` (line 618)
- **Change**:
  ```javascript
  const allOrdersLink = document.querySelector('.table-card__header a');
  if (allOrdersLink && stats.total_orders !== undefined) {
      allOrdersLink.innerHTML = `Xem tất cả ${stats.total_orders} đơn &rarr;`;
  }
  ```

---

## 5. Verification Method

### 5.1 Verification Checklist & Commands

1. **Verify Non-Existence of `checkout.html`**:
   - Command (PowerShell):
     ```powershell
     Get-ChildItem -Path "d:\laptrinhweb - Copy" -Filter "*checkout*.html" -Recurse
     ```
   - Expected Output: Empty (0 files found).

2. **Verify `account.html` Order Array Extraction**:
   - Inspect `d:\laptrinhweb - Copy\account.html` line 259.
   - Condition: Must check `orders.length > 0` where `orders = Array.isArray(res.data) ? res.data : (res.data?.orders || [])`.
   - Invalidation Condition: If code strictly checks `Array.isArray(res.data)`, the orders table will fail to render when backend returns `{ success: true, orders: [...] }`.

3. **Verify PII Masking in `contact.html` & Tracking API**:
   - Trigger lookup on `contact.html` with test code: `VNPOST-ORD-2026-0001` or `ORD-2026-0001`.
   - Inspect `#trackResRecipient` text content.
   - Expected Output: Must display masked strings (e.g., `Nguyễn V*** H*** (0912***678)`), NOT raw phone numbers or full cleartext names.

4. **Verify Admin Dashboard Real-Time Statistics**:
   - Inspect `admin/dashboard.html` with live backend.
   - Observe `.stat-card--revenue .stat-card__value`, `.stat-card--products .stat-card__value`, `.stat-card--orders .stat-card__value`, `.table-card tbody`.
   - Expected Output: All values synchronize with `/api/dashboard/stats` recordsets without throwing runtime errors.

5. **Verify UI Freeze Compliance**:
   - Compare `git diff` on all `.html` and `.css` files after implementation.
   - Expected Output: Zero modifications to HTML tags, class attributes, ID names, and CSS stylesheet rules. Only embedded `<script>` logic or external `.js` files may contain edits.
