# Original User Request

## Initial Request — 2026-10-06T19:03:25Z

Hệ thống E-Commerce mô hình xe (CarModelStore) cần tái cấu trúc và đồng bộ dữ liệu tuyệt đối giữa SQL Database, Backend API và Frontend Client (Local-first và sẵn sàng deploy Vercel), bảo đảm 100% ACID Transaction, tính toàn vẹn dữ liệu và đóng băng 100% giao diện (UI Freeze).

Working directory: d:\laptrinhweb - Copy
Integrity mode: development

## Requirements

### R1. UI Freeze & Interface Integrity (100% Frozen UI)
Giữ nguyên toàn bộ layout, HTML/CSS class, màu sắc, font chữ và cấu trúc DOM hiện có. Chỉ can thiệp vào logic xử lý dữ liệu, state, API routes, event handlers và error feedback.

### R2. Synchronization Matrix & ACID Transaction
Mọi thao tác ghi liên quan từ 2 bảng trở lên (Đặt hàng, trừ kho xe, sinh mã vận đơn, hủy đơn hoàn kho) PHẢI chạy trong Database Transaction có Row-Locking (`UPDLOCK, ROWLOCK`):
- Snapshot thông tin khách hàng vào đơn hàng.
- Kiểm tra tồn kho và trừ tồn kho xe nguyên tử trong transaction; nếu thiếu hàng lập tức rollback và trả về lỗi.
- Sinh mã vận đơn duy nhất (`VNPOST-...`) và tạo bản ghi shipment đồng bộ.
- State Machine 2 chiều: Huỷ đơn (Cancelled) tự động hoàn trả tồn kho sản phẩm và cập nhật trạng thái vận đơn sang Cancelled.

### R3. Client & Admin End-to-End Synchronization
- Khách hàng xem lịch sử đơn và cập nhật trạng thái đơn tại `account.html`.
- Quản trị viên theo dõi doanh thu thực tế, số đơn, trạng thái và 5 đơn mới nhất tại `admin/dashboard.html` đồng bộ trực tiếp từ Database (`/api/dashboard/stats`).
- API tra cứu hành trình vận đơn (`/api/tracking/:code`) trả về đúng thông tin kiện hàng, mã đơn, sản phẩm và che mờ thông tin nhạy cảm (PII masking).

### R4. Production & Serverless Readiness (Vercel)
- Thiết lập Connection Pooling singleton cho SQL Client nhằm chống cạn kiệt connection pool trong môi trường Serverless.
- Chuẩn hóa cấu hình biến môi trường (`.env` / `.env.example`).
- Không để tồn tại bất kỳ unhandled promise rejection, SQL injection hay crash trong runtime.

## Acceptance Criteria

### Data Integrity & Concurrency
- [ ] Đặt hàng thành công tạo đúng 1 bản ghi `orders`, các bản ghi `order_items`, và 1 bản ghi `shipments` liên kết chuẩn khóa ngoại trong 1 transaction duy nhất.
- [ ] Thao tác mua hàng vượt số lượng tồn kho bị chặn 100%, trả về lỗi rõ ràng và không sinh bản ghi rác.
- [ ] Hủy đơn hàng tự động hoàn lại đúng số lượng tồn kho cho các sản phẩm trong đơn và cập nhật `shipments.shipping_status = 'cancelled'`.

### End-to-End Real-time Sync
- [ ] Sau khi tạo đơn, truy cập `account.html` hiển thị ngay đơn vừa đặt.
- [ ] `admin/dashboard.html` cập nhật chính xác tổng doanh thu, số đơn và danh sách 5 đơn mới nhất từ DB.
- [ ] Tra cứu mã vận đơn tại `contact.html` trả về thông tin lộ trình, đơn vị vận chuyển và danh sách xe mô hình tương ứng.

### Verification & Local Stability
- [ ] Server local khởi động trơn tru không lỗi cảnh báo đỏ.
- [ ] Kịch bản test luồng tự động (Đặt hàng -> Trừ kho -> Sinh tracking -> Hủy đơn hoàn kho -> Tra cứu tracking) vượt qua 100%.
