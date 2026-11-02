/**
 * CTISLAND - Kết nối Firebase (Authentication & Cloud Firestore)
 * Sử dụng Firebase Web SDK Modular thông qua CDN chính thức (Gói miễn phí Spark Plan).
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  writeBatch,
  runTransaction,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

/* ==========================================================================
   HƯỚNG DẪN ĐIỀN CẤU HÌNH FIREBASE THẬT:
   1. Vào https://console.firebase.google.com/ -> Tạo project mới -> Thêm Web App (</>)
   2. Copy đối tượng firebaseConfig của bạn và dán đè vào bên dưới.
   ========================================================================== */
export const firebaseConfig = {
  apiKey : "AIzaSyBHVJ-1bDgf1jc118phdWiMgbytI-o2u-c" , 
  authDomain : "ctisland-88123.firebaseapp.com" , 
  projectId : "ctisland-88123" , 
  storageBucket : "ctisland-88123.firebasestorage.app" , 
  messagingSenderId : "726218851844" , 
  appId : "1:726218851844:web:48b0e149bbf1c5b9335751" , 
  measurementId : "G-13LQS6M2MD" 
};

/**
 * Kiểm tra xem người dùng đã điền cấu hình Firebase thật hay chưa.
 * @returns {boolean}
 */
export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    !firebaseConfig.apiKey.startsWith('DIEN_') &&
    !firebaseConfig.projectId.startsWith('DIEN_')
  );
}

let app = null;
let auth = null;
let db = null;

if (isFirebaseConfigured()) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

export {
  app,
  auth,
  db,
  // Auth helpers
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  // Firestore helpers
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  writeBatch,
  runTransaction,
  serverTimestamp
};

