-- =============================================================================
-- BÀI TẬP THỰC HÀNH CSDL - CARMODEL STORE
-- File 01: Thiết kế cấu trúc các bảng (DDL - Data Definition Language)
-- Thiết kế: Thành viên 03 (Thanh Mai) & Nhóm 01
-- =============================================================================

-- 1. Tạo Cơ sở dữ liệu CarModelStoreDB
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'CarModelStoreDB')
BEGIN
    CREATE DATABASE CarModelStoreDB;
END
GO

USE CarModelStoreDB;
GO

-- 2. Bảng Người dùng & Khách hàng (users)
IF OBJECT_ID('users', 'U') IS NULL
CREATE TABLE users (
    id INT IDENTITY(1,1) PRIMARY KEY,
    username VARCHAR(50) NULL UNIQUE,
    password VARCHAR(255) NOT NULL DEFAULT '123456',
    full_name NVARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(15) NULL,
    address NVARCHAR(MAX) NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('admin', 'customer', 'staff')),
    created_at DATETIME DEFAULT GETDATE()
);
GO

-- VIEW customers để tương thích ngược
IF OBJECT_ID('customers', 'V') IS NOT NULL DROP VIEW customers;
GO
CREATE VIEW customers AS
SELECT id, full_name, email, phone, address, created_at FROM users;
GO

-- 3. Bảng Thương hiệu xe (brands)
IF OBJECT_ID('brands', 'U') IS NULL
CREATE TABLE brands (
    id INT IDENTITY(1,1) PRIMARY KEY,
    brand_code VARCHAR(30) NOT NULL UNIQUE,
    name NVARCHAR(100) NOT NULL UNIQUE,
    country NVARCHAR(50) NOT NULL DEFAULT N'Ý',
    description NVARCHAR(MAX) NULL,
    total_models INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT GETDATE()
);
GO

-- 4. Bảng Sản phẩm xe mô hình (products)
IF OBJECT_ID('products', 'U') IS NULL
CREATE TABLE products (
    id INT IDENTITY(1,1) PRIMARY KEY,
    product_code VARCHAR(50) NOT NULL UNIQUE,
    name NVARCHAR(255) NOT NULL,
    scale VARCHAR(10) NOT NULL,
    brand_id INT NULL,
    manufacturer NVARCHAR(100) NOT NULL,
    car_brand NVARCHAR(100) NOT NULL,
    price DECIMAL(12, 2) NOT NULL DEFAULT 0,
    stock_quantity INT NOT NULL DEFAULT 0,
    status NVARCHAR(20) CHECK (status IN ('in_stock', 'pre_order', 'out_of_stock', 'bestseller')) DEFAULT 'in_stock',
    image_url NVARCHAR(500) NULL,
    description NVARCHAR(MAX) NULL,
    rating DECIMAL(2,1) DEFAULT 5.0,
    reviews INT DEFAULT 0,
    created_at DATETIME DEFAULT GETDATE(),

    CONSTRAINT fk_products_brands FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
    CONSTRAINT CK_products_stock_quantity CHECK (stock_quantity >= 0)
);
GO

-- 5. Bảng Phụ kiện trưng bày (accessories)
IF OBJECT_ID('accessories', 'U') IS NULL
CREATE TABLE accessories (
    id INT IDENTITY(1,1) PRIMARY KEY,
    accessory_code VARCHAR(50) NOT NULL UNIQUE,
    name NVARCHAR(255) NOT NULL,
    category NVARCHAR(50) NOT NULL,
    compatible_scale NVARCHAR(100) NOT NULL DEFAULT N'Mọi tỉ lệ',
    price DECIMAL(12, 2) NOT NULL DEFAULT 0,
    stock_quantity INT NOT NULL DEFAULT 0,
    image_url NVARCHAR(500) NULL,
    description NVARCHAR(MAX) NULL,
    created_at DATETIME DEFAULT GETDATE()
);
GO

-- 6. Bảng Đơn hàng (orders)
IF OBJECT_ID('orders', 'U') IS NULL
CREATE TABLE orders (
    id INT IDENTITY(1,1) PRIMARY KEY,
    order_code VARCHAR(30) NOT NULL UNIQUE,
    customer_id INT NOT NULL,
    customer_name NVARCHAR(100) NULL,
    customer_email VARCHAR(100) NULL,
    customer_phone VARCHAR(15) NULL,
    recipient_name NVARCHAR(100) NOT NULL,
    recipient_phone VARCHAR(15) NOT NULL,
    shipping_address NVARCHAR(MAX) NOT NULL,
    total_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
    tracking_code VARCHAR(50) NULL,
    order_status NVARCHAR(20) DEFAULT 'pending',
    created_at DATETIME DEFAULT GETDATE(),
    
    CONSTRAINT fk_orders_users FOREIGN KEY (customer_id) REFERENCES users(id),
    CONSTRAINT UQ_orders_tracking_code UNIQUE (tracking_code),
    CONSTRAINT CK_orders_order_status CHECK (order_status IN ('pending', 'confirmed', 'shipping', 'delivered', 'completed', 'cancelled'))
);
GO

-- 7. Bảng Chi tiết đơn hàng (order_items)
IF OBJECT_ID('order_items', 'U') IS NULL
CREATE TABLE order_items (
    id INT IDENTITY(1,1) PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0) DEFAULT 1,
    unit_price DECIMAL(12, 2) NOT NULL,

    CONSTRAINT fk_items_orders FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_items_products FOREIGN KEY (product_id) REFERENCES products(id)
);
GO

-- 8. Bảng Vận đơn & Hành trình giao hàng (shipments)
IF OBJECT_ID('shipments', 'U') IS NULL
CREATE TABLE shipments (
    id INT IDENTITY(1,1) PRIMARY KEY,
    order_id INT NOT NULL,
    tracking_code VARCHAR(50) NOT NULL UNIQUE,
    carrier NVARCHAR(100) NOT NULL DEFAULT N'VNPost Tiết Kiệm',
    shipping_status NVARCHAR(50) NOT NULL DEFAULT N'pending',
    current_location NVARCHAR(255) NULL,
    estimated_delivery DATETIME NULL,
    notes NVARCHAR(MAX) NULL,
    created_at DATETIME DEFAULT GETDATE(),
    updated_at DATETIME DEFAULT GETDATE(),

    CONSTRAINT fk_shipments_orders FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
GO

-- 9. Chỉ mục (Indexes) tối ưu hóa tra cứu
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_orders_tracking_code')
    CREATE NONCLUSTERED INDEX idx_orders_tracking_code ON orders(tracking_code);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_orders_customer_id')
    CREATE NONCLUSTERED INDEX idx_orders_customer_id ON orders(customer_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_order_items_order_id')
    CREATE NONCLUSTERED INDEX idx_order_items_order_id ON order_items(order_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_order_items_product_id')
    CREATE NONCLUSTERED INDEX idx_order_items_product_id ON order_items(product_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_shipments_order_id')
    CREATE NONCLUSTERED INDEX idx_shipments_order_id ON shipments(order_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_products_brand_id')
    CREATE NONCLUSTERED INDEX idx_products_brand_id ON products(brand_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_products_scale')
    CREATE NONCLUSTERED INDEX idx_products_scale ON products(scale);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_products_car_brand')
    CREATE NONCLUSTERED INDEX idx_products_car_brand ON products(car_brand);
GO