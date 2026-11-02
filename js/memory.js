/**
 * CTISLAND - Hệ thống Sổ Lưu Bút Kỷ Niệm & Đếm Ngày Yêu (memory.js)
 * - Đếm số ngày bên nhau (`loveStartDate` lưu trên `worlds/ctisland_main`).
 * - Lưu trữ & đồng bộ các trang kỷ niệm chung của hai người trong bảng `memories`.
 */

import {
  db,
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch
} from './firebase.js';
import { SHARED_WORLD_ID } from './world.js';

export const MEMORY_MOODS = {
  sweet: { id: 'sweet', label: 'Ngọt ngào', icon: '🥰', bg: '#fff0f5' },
  date: { id: 'date', label: 'Hẹn hò', icon: '🌸', bg: '#fef6e4' },
  milestone: { id: 'milestone', label: 'Cột mốc', icon: '🎂', bg: '#e9f7ef' },
  note: { id: 'note', label: 'Nhắn nhủ', icon: '💌', bg: '#f3effe' }
};

/**
 * Lấy mã ngày Việt Nam UTC+7 (`YYYY-MM-DD`).
 */
function getTodayVnDateStr() {
  const vnMs = Date.now() + 7 * 3600 * 1000;
  return new Date(vnMs).toISOString().slice(0, 10);
}

/**
 * Tính số ngày yêu nhau tính từ `loveStartDate` (`YYYY-MM-DD`) tới hôm nay (UTC+7).
 * Ngày đầu tiên tính là Ngày 1.
 * @param {string|null|undefined} loveStartDate
 * @returns {number|null}
 */
export function calculateLoveDays(loveStartDate) {
  if (!loveStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(loveStartDate)) {
    return null;
  }
  const [y, m, d] = loveStartDate.split('-').map(Number);
  const startUtcMs = Date.UTC(y, m - 1, d);

  const todayStr = getTodayVnDateStr();
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const todayUtcMs = Date.UTC(ty, tm - 1, td);

  const diffDays = Math.floor((todayUtcMs - startUtcMs) / 86400000);
  return Math.max(1, diffDays + 1);
}

/**
 * Cập nhật ngày bắt đầu yêu nhau của hai đứa trên đảo chung.
 * @param {string} dateStr - Định dạng `YYYY-MM-DD`
 */
export async function saveLoveStartDate(dateStr) {
  const clean = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw new Error('Vui lòng chọn ngày kỷ niệm hợp lệ.');
  }

  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  await updateDoc(worldRef, {
    loveStartDate: clean,
    updatedAt: serverTimestamp()
  });
  return calculateLoveDays(clean);
}

/**
 * Tải danh sách kỷ niệm chung mới nhất từ bảng `memories` (tiết kiệm lượt đọc Spark Plan).
 * @param {number} [maxCount=30]
 */
export async function fetchSharedMemories(maxCount = 30) {
  const q = query(
    collection(db, 'memories'),
    orderBy('createdAtMs', 'desc'),
    limit(maxCount)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((item) => !item.deleted);
}

/**
 * Tạo mới 1 trang kỷ niệm / lời nhắn yêu thương vào bảng `memories`.
 * @param {{ title: string, content: string, mood: string, userProfile: Object }} params
 */
export async function createSharedMemory({ title, content, mood = 'sweet', userProfile }) {
  const cleanTitle = String(title || '').trim();
  const cleanContent = String(content || '').trim();
  const moodInfo = MEMORY_MOODS[mood] || MEMORY_MOODS.sweet;

  if (cleanTitle.length < 2 || cleanTitle.length > 60) {
    throw new Error('Tiêu đề kỷ niệm cần từ 2 đến 60 ký tự.');
  }
  if (cleanContent.length < 2 || cleanContent.length > 400) {
    throw new Error('Nội dung lời nhắn cần từ 2 đến 400 ký tự.');
  }

  const memoryId = `mem_${Date.now()}_${userProfile.uid.slice(0, 5)}`;
  const memRef = doc(db, 'memories', memoryId);
  const nowMs = Date.now();

  const record = {
    memoryId,
    worldId: SHARED_WORLD_ID,
    title: cleanTitle,
    content: cleanContent,
    mood: moodInfo.id,
    dateKey: getTodayVnDateStr(),
    authorUid: userProfile.uid,
    authorName: userProfile.displayName,
    authorStyle: userProfile.characterStyle || 'mint',
    createdAt: serverTimestamp(),
    createdAtMs: nowMs
  };

  await setDoc(memRef, record);
  return record;
}

/**
 * Xóa 1 kỷ niệm bằng batch (hoặc đánh dấu xóa an toàn).
 * @param {string} memoryId
 */
export async function deleteSharedMemory(memoryId) {
  if (!memoryId) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'memories', memoryId));
  await batch.commit();
}

