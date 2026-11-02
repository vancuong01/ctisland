/**
 * CTISLAND - Tiện ích Giao diện dùng chung (Toast, Confirm Modal, Loading, Network)
 */

/**
 * Làm sạch chuỗi để chống XSS khi chèn vào HTML.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Hiển thị thông báo ngắn (Toast) ở góc trên bên phải.
 * @param {string} message - Nội dung thông báo
 * @param {'success'|'error'|'warning'|'info'} type - Loại thông báo
 * @param {number} duration - Thời gian hiển thị (ms)
 */
export function showToast(message, type = 'info', duration = 3800) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }

  const icons = {
    success: '✅',
    error: '🌸',
    warning: '⚠️',
    info: '💌'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-fadeout');
    setTimeout(() => toast.remove(), 240);
  }, duration);
}

/**
 * Hiển thị hộp thoại xác nhận trước khi thực hiện thao tác quan trọng.
 * @param {Object} options
 * @param {string} options.title - Tiêu đề hộp thoại
 * @param {string} options.message - Nội dung cần xác nhận
 * @param {string} [options.confirmText='Xác nhận'] - Nhãn nút đồng ý
 * @param {string} [options.cancelText='Quay lại'] - Nhãn nút hủy
 * @param {'primary'|'mint'|'danger'} [options.variant='primary'] - Kiểu nút xác nhận
 * @returns {Promise<boolean>}
 */
export function showConfirm({
  title,
  message,
  confirmText = 'Xác nhận',
  cancelText = 'Quay lại',
  variant = 'primary'
}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');

    const btnClass =
      variant === 'danger'
        ? 'btn btn-danger-soft'
        : variant === 'mint'
          ? 'btn btn-mint'
          : 'btn btn-primary';

    backdrop.innerHTML = `
      <div class="modal-card">
        <h3 class="modal-title">${escapeHtml(title)}</h3>
        <p class="modal-body">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-outline" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="${btnClass}" data-action="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    const cleanup = (result) => {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      resolve(result);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') cleanup(false);
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup(false);
    });

    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => cleanup(false));
    const confirmBtn = backdrop.querySelector('[data-action="confirm"]');
    confirmBtn.addEventListener('click', () => cleanup(true));

    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(backdrop);
    confirmBtn.focus();
  });
}

/**
 * Bật/tắt trạng thái đang tải cho nút bấm (chống bấm đúp nhiều lần).
 * @param {HTMLButtonElement} button
 * @param {boolean} isLoading
 * @param {string} [loadingText='Đang xử lý...']
 */
export function setButtonLoading(button, isLoading, loadingText = 'Đang xử lý...') {
  if (!button) return;
  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }
    button.disabled = true;
    button.innerHTML = `<span class="spinner-inline" aria-hidden="true"></span><span>${escapeHtml(loadingText)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

/**
 * Theo dõi kết nối mạng Online / Offline theo thời gian thực.
 */
export function initNetworkMonitor() {
  let banner = document.getElementById('networkBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'networkBanner';
    banner.className = 'network-banner hidden';
    banner.textContent = '📡 Mất kết nối Internet — Vui lòng kiểm tra mạng để đồng bộ dữ liệu cùng người ấy.';
    document.body.prepend(banner);
  }

  const updateBanner = () => {
    if (navigator.onLine) {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
    }
  };

  window.addEventListener('offline', () => {
    updateBanner();
    showToast('Bạn vừa mất kết nối mạng. Các thao tác lưu sẽ tạm dừng.', 'warning', 4500);
  });

  window.addEventListener('online', () => {
    updateBanner();
    showToast('Đã kết nối Internet trở lại! Dữ liệu đang tự động đồng bộ.', 'success', 3200);
  });

  updateBanner();
}

/**
 * Hiển thị hộp hướng dẫn khi chưa điền Firebase Config.
 * @param {HTMLElement|null} targetEl
 */
export function showFirebaseSetupAlert(targetEl) {
  if (!targetEl) return;
  targetEl.classList.remove('hidden');
  targetEl.innerHTML = `
    <strong>🌱 Chưa kết nối Firebase Config!</strong>
    Hãy mở file <code>js/firebase.js</code> và điền thông tin Web App từ Firebase Console (miễn phí gói Spark) theo hướng dẫn trong <code>README.md</code> để bắt đầu đăng ký &amp; tạo đảo nhé.
  `;
}

