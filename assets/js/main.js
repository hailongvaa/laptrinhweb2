// CarModelStore - tương tác UI phía client (demo, chưa nối server)
// 1) Wishlist: lưu danh sách mô hình yêu thích vào localStorage của trình duyệt
// 2) View toggle: chuyển giữa "Xem dạng lưới" và "Xem dạng bộ sưu tập" trên trang sản phẩm

document.addEventListener("DOMContentLoaded", function () {
  initWishlistButtons();
  initViewToggle();
  initContactForm();
  updateHeaderAuthState();
  updateHeaderCartBadge();
});

// ==========================================
// QUẢN LÝ TÀI KHOẢN VÀ ĐĂNG NHẬP / ĐĂNG XUẤT
// ==========================================
function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem("cms_auth_user") || localStorage.getItem("carModelStoreCurrentUser") || "null");
  } catch (e) {
    return null;
  }
}

function updateHeaderAuthState() {
  var topAuth = document.querySelector(".top-auth");
  if (!topAuth) return;

  var user = getCurrentUser();
  if (user && user.email) {
    var displayName = user.name || user.fullname || user.email.split("@")[0];
    var isAdmin = user.role === "admin";
    topAuth.innerHTML = 
      '<a href="account.html" style="color:#d4af37; font-size:0.82rem; margin-right:8px; text-decoration:none;" title="Xem thông tin tài khoản & đơn đã đặt">👋 ' + displayName + (isAdmin ? ' (Admin)' : '') + '</a>' +
      '<a href="account.html" class="top-login-link" style="margin-right:8px; color:#e2e8f0;">[Đơn đã đặt]</a>' +
      (isAdmin ? '<a href="admin/dashboard.html" class="top-login-link" style="margin-right:8px; color:#38bdf8;">[Quản trị]</a>' : '') +
      '<a href="#" id="headerLogoutBtn" class="top-login-link" style="color:#f87171;">Đăng xuất</a>';

    var logoutBtn = document.getElementById("headerLogoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function (e) {
        e.preventDefault();
        localStorage.removeItem("cms_auth_user");
        localStorage.removeItem("carModelStoreCurrentUser");
        alert("Đã đăng xuất tài khoản!");
        window.location.reload();
      });
    }
  }
}

// ==========================================
// QUẢN LÝ GIỎ HÀNG (PERSISTENT CART STORAGE - CHỈ KHI ĐĂNG NHẬP)
// ==========================================
function getCartStorageKey() {
  var user = getCurrentUser();
  // Chỉ khi đã đăng nhập mới có khóa lưu giỏ hàng
  return (user && user.email) ? "cms_cart_" + user.email.toLowerCase() : null;
}

function getCartItems() {
  var user = getCurrentUser();
  if (!user || !user.email) return [];
  try {
    var key = getCartStorageKey();
    if (!key) return [];
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch (e) {
    return [];
  }
}

function saveCartItems(items) {
  var user = getCurrentUser();
  if (!user || !user.email) return false;
  var key = getCartStorageKey();
  if (!key) return false;
  localStorage.setItem(key, JSON.stringify(items || []));
  updateHeaderCartBadge();
  return true;
}

function updateHeaderCartBadge() {
  var user = getCurrentUser();
  var totalQty = 0;
  if (user && user.email) {
    var items = getCartItems();
    totalQty = items.reduce(function (sum, it) { return sum + (Number(it.quantity) || 1); }, 0);
  }
  document.querySelectorAll(".cart-badge, .cart-pill").forEach(function (badge) {
    badge.textContent = totalQty;
  });
}

function getWishlist() {
  try {
    return JSON.parse(localStorage.getItem("cms_wishlist") || "[]");
  } catch (e) {
    return [];
  }
}

function saveWishlist(list) {
  localStorage.setItem("cms_wishlist", JSON.stringify(list));
}

function initWishlistButtons() {
  var buttons = document.querySelectorAll(".wishlist-btn");
  var wishlist = getWishlist();

  buttons.forEach(function (btn) {
    var id = btn.getAttribute("data-product-id");
    if (id && wishlist.indexOf(id) !== -1) {
      btn.classList.add("is-active");
      btn.textContent = "♥";
    }
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var list = getWishlist();
      var idx = list.indexOf(id);
      if (idx === -1) {
        list.push(id);
        btn.classList.add("is-active");
        btn.textContent = "♥";
      } else {
        list.splice(idx, 1);
        btn.classList.remove("is-active");
        btn.textContent = "♡";
      }
      saveWishlist(list);
    });
  });
}

function initViewToggle() {
  var toggle = document.querySelector(".view-toggle");
  var grid = document.querySelector("[data-product-grid]");
  if (!toggle || !grid) return;

  toggle.querySelectorAll("button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      toggle.querySelectorAll("button").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      if (btn.dataset.view === "collection") {
        grid.classList.add("grid--collection");
      } else {
        grid.classList.remove("grid--collection");
      }
    });
  });
}

// Trang liên hệ: HTML5 (required, type=email) kiểm tra trước; khi hợp lệ gửi POST /api/contact.
// Nếu chưa bật server (mở file trực tiếp) thì chạy chế độ demo: vẫn hiện thông báo nhưng ghi rõ chưa gửi.
function initContactForm() {
  var form = document.getElementById("contactForm");
  var box = document.getElementById("contactSuccess");
  if (!form || !box) return;
  var text = document.getElementById("contactSuccessText");
  var title = box.querySelector("strong");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = {
      name: form.elements["name"].value.trim(),
      email: form.elements["email"].value.trim(),
      message: form.elements["message"].value.trim()
    };
    function done(t, msg) {
      title.textContent = t;
      text.textContent = msg;
      form.reset();
      box.hidden = false;
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    var baseUrl = "";
    if (typeof window.getApiBaseUrl === "function") {
      baseUrl = window.getApiBaseUrl();
    } else if (window.API_BASE) {
      baseUrl = window.API_BASE;
    }

    fetch((baseUrl || "") + "/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
      body: JSON.stringify(data)
    })
      .then(function (r) {
        if (r.ok) return done("Đã gửi thành công!", "Cảm ơn " + data.name + " đã liên hệ. Chúng tôi sẽ phản hồi qua email trong thời gian sớm nhất.");
        return r.json().then(function (j) { alert(j.message || j.error || "Gửi không thành công, vui lòng thử lại."); });
      })
      .catch(function () {
        done("Chế độ demo", "Chưa kết nối máy chủ nên liên hệ của bạn chưa được lưu. Hãy bật backend: cd car-store-backend rồi node server.js");
      });
  });

  form.addEventListener("input", function () { box.hidden = true; });
}

