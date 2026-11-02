/**
 * CTISLAND - Hệ thống Tài khoản & Xác thực (auth.js)
 * Bao gồm: Đăng ký, Đăng nhập, Đăng xuất, Quên mật khẩu & Bảo vệ trang.
 * Tuyệt đối không lưu mật khẩu trong Cloud Firestore.
 */

import {
  auth,
  db,
  isFirebaseConfigured,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from './firebase.js';
import { normalizeCharacterStyle } from './player.js';
import {
  initNetworkMonitor,
  showToast,
  showConfirm,
  setButtonLoading,
  showFirebaseSetupAlert
} from './ui.js';

/** Cờ ngăn chuyển trang sớm khi đang trong quá trình tạo hồ sơ Firestore lúc đăng ký */
let isSubmittingAuth = false;

/**
 * Chuyển mã lỗi Firebase sang thông báo tiếng Việt thân thiện, dễ hiểu.
 * @param {any} error
 * @returns {string}
 */
export function translateAuthError(error) {
  const code = error?.code || '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'Email này đã được đăng ký rồi. Bạn hãy chuyển sang trang Đăng nhập nhé!';
    case 'auth/invalid-email':
      return 'Địa chỉ email chưa đúng định dạng.';
    case 'auth/weak-password':
      return 'Mật khẩu quá ngắn, cần ít nhất 6 ký tự nhé.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email hoặc mật khẩu chưa chính xác. Vui lòng kiểm tra lại.';
    case 'auth/too-many-requests':
      return 'Bạn đã thao tác quá nhiều lần liên tiếp. Vui lòng đợi ít phút rồi thử lại.';
    case 'auth/network-request-failed':
    case 'unavailable':
      return 'Không thể kết nối mạng. Vui lòng kiểm tra Internet của bạn.';
    case 'permission-denied':
      return 'Không có quyền truy cập dữ liệu. Hãy kiểm tra lại Firestore Security Rules.';
    default:
      return error?.message || 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.';
  }
}

/**
 * Đảm bảo tài khoản đã có hồ sơ trong collection `users/{uid}`.
 * Chỉ thực hiện 1 lượt đọc; chỉ ghi khi hồ sơ chưa tồn tại.
 * @param {import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js').User} user
 * @param {{ displayName?: string, characterStyle?: string }} [defaults]
 * @returns {Promise<Object>}
 */
export async function ensureUserProfile(user, defaults = {}) {
  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    return snap.data();
  }

  const rawName = (defaults.displayName || user.displayName || user.email?.split('@')[0] || 'Cư dân Đảo').trim();
  const safeName = rawName.length >= 2 ? rawName.slice(0, 24) : `${rawName} 🌸`;
  const characterStyle = normalizeCharacterStyle(defaults.characterStyle);

  const newProfile = {
    uid: user.uid,
    email: (user.email || '').toLowerCase(),
    displayName: safeName,
    characterStyle,
    worldId: 'ctisland_main',
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp()
  };

  await setDoc(userRef, newProfile);
  return {
    ...newProfile,
    worldId: 'ctisland_main'
  };
}

/**
 * Đăng ký tài khoản mới và khởi tạo hồ sơ người chơi trên Firestore.
 * @param {{ displayName: string, email: string, password: string, characterStyle: string }} payload
 */
export async function registerAccount({ displayName, email, password, characterStyle }) {
  const cleanName = displayName.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (cleanName.length < 2 || cleanName.length > 24) {
    throw new Error('Tên hiển thị cần từ 2 đến 24 ký tự.');
  }
  if (!cleanEmail.includes('@')) {
    throw new Error('Vui lòng nhập địa chỉ email hợp lệ.');
  }
  if (password.length < 6) {
    throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
  }

  isSubmittingAuth = true;
  try {
    const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    await updateProfile(credential.user, { displayName: cleanName });
    await ensureUserProfile(credential.user, {
      displayName: cleanName,
      characterStyle
    });
    return credential.user;
  } finally {
    isSubmittingAuth = false;
  }
}

/**
 * Đăng nhập bằng Email và Mật khẩu.
 * @param {{ email: string, password: string }} payload
 */
export async function loginAccount({ email, password }) {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !password) {
    throw new Error('Vui lòng nhập đầy đủ email và mật khẩu.');
  }

  isSubmittingAuth = true;
  try {
    const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
    await ensureUserProfile(credential.user);
    return credential.user;
  } finally {
    isSubmittingAuth = false;
  }
}

/**
 * Gửi email đặt lại mật khẩu qua Firebase Authentication.
 * @param {string} email
 */
export async function requestPasswordReset(email) {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Vui lòng nhập địa chỉ email hợp lệ để nhận liên kết đặt lại mật khẩu.');
  }
  await sendPasswordResetEmail(auth, cleanEmail);
}

/**
 * Đăng xuất tài khoản (kèm hộp thoại xác nhận).
 * @returns {Promise<boolean>} true nếu đã đăng xuất
 */
export async function confirmAndLogout() {
  const confirmed = await showConfirm({
    title: 'Đăng xuất khỏi CTISLAND?',
    message: 'Bạn có chắc muốn tạm rời hòn đảo và đăng xuất tài khoản hiện tại không?',
    confirmText: 'Đăng xuất',
    cancelText: 'Ở lại đảo',
    variant: 'danger'
  });

  if (!confirmed) return false;

  await signOut(auth);
  return true;
}

/* ==========================================================================
   Khởi tạo giao diện cho trang login.html và register.html
   ========================================================================== */
function initAuthPages() {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  // Chỉ chạy logic form nếu đang ở trang login.html hoặc register.html
  if (!loginForm && !registerForm) return;

  initNetworkMonitor();

  const setupAlert = document.getElementById('firebaseSetupAlert');
  if (!isFirebaseConfigured()) {
    showFirebaseSetupAlert(setupAlert);
    return;
  }

  // Nếu người dùng đã đăng nhập sẵn thì chuyển thẳng vào game.html
  onAuthStateChanged(auth, (user) => {
    if (user && !isSubmittingAuth) {
      window.location.replace('./game.html');
    }
  });

  // 1. Xử lý Form Đăng nhập + Quên mật khẩu
  if (loginForm) {
    const submitBtn = document.getElementById('loginSubmitBtn');
    const forgotBtn = document.getElementById('forgotPasswordBtn');
    const resetModal = document.getElementById('resetPasswordModal');
    const resetForm = document.getElementById('resetPasswordForm');
    const closeResetBtn = document.getElementById('closeResetModalBtn');
    const resetSubmitBtn = document.getElementById('resetSubmitBtn');

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!navigator.onLine) {
        showToast('Bạn đang ngoại tuyến. Hãy kết nối Internet để đăng nhập nhé!', 'warning');
        return;
      }

      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;

      setButtonLoading(submitBtn, true, 'Đang vào đảo...');
      try {
        await loginAccount({ email, password });
        showToast('Đăng nhập thành công! Đang đưa bạn tới đảo...', 'success', 2000);
        setTimeout(() => {
          window.location.replace('./game.html');
        }, 450);
      } catch (err) {
        showToast(translateAuthError(err), 'error');
        setButtonLoading(submitBtn, false);
      }
    });

    // Mở / đóng hộp thoại Quên mật khẩu
    if (forgotBtn && resetModal) {
      forgotBtn.addEventListener('click', () => {
        const currentEmail = document.getElementById('loginEmail')?.value || '';
        const resetEmailInput = document.getElementById('resetEmailInput');
        if (resetEmailInput && currentEmail) {
          resetEmailInput.value = currentEmail;
        }
        resetModal.classList.remove('hidden');
        resetEmailInput?.focus();
      });

      closeResetBtn?.addEventListener('click', () => {
        resetModal.classList.add('hidden');
      });

      resetModal.addEventListener('click', (e) => {
        if (e.target === resetModal) resetModal.classList.add('hidden');
      });

      resetForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!navigator.onLine) {
          showToast('Cần có kết nối Internet để gửi email khôi phục mật khẩu.', 'warning');
          return;
        }

        const email = document.getElementById('resetEmailInput').value;
        setButtonLoading(resetSubmitBtn, true, 'Đang gửi...');
        try {
          await requestPasswordReset(email);
          resetModal.classList.add('hidden');
          showToast(
            'Đã gửi liên kết đặt lại mật khẩu! Bạn hãy kiểm tra hộp thư đến (và cả mục Spam/Thư rác) nhé.',
            'success',
            5500
          );
        } catch (err) {
          showToast(translateAuthError(err), 'error');
        } finally {
          setButtonLoading(resetSubmitBtn, false);
        }
      });
    }
  }

  // 2. Xử lý Form Đăng ký tài khoản
  if (registerForm) {
    const submitBtn = document.getElementById('registerSubmitBtn');

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!navigator.onLine) {
        showToast('Bạn đang ngoại tuyến. Hãy kết nối Internet để đăng ký nhé!', 'warning');
        return;
      }

      const displayName = document.getElementById('regDisplayName').value;
      const email = document.getElementById('regEmail').value;
      const password = document.getElementById('regPassword').value;
      const confirmPassword = document.getElementById('regConfirmPassword').value;
      const selectedStyle =
        registerForm.querySelector('input[name="characterStyle"]:checked')?.value || 'mint';

      if (password !== confirmPassword) {
        showToast('Mật khẩu nhập lại chưa khớp. Bạn kiểm tra lại nhé!', 'warning');
        return;
      }

      setButtonLoading(submitBtn, true, 'Đang tạo tài khoản...');
      try {
        await registerAccount({
          displayName,
          email,
          password,
          characterStyle: selectedStyle
        });
        showToast('Tạo tài khoản thành công! Chào mừng bạn đến với CTISLAND!', 'success', 2200);
        setTimeout(() => {
          window.location.replace('./game.html');
        }, 550);
      } catch (err) {
        showToast(translateAuthError(err), 'error');
        setButtonLoading(submitBtn, false);
      }
    });
  }
}

initAuthPages();

