/**
 * CTISLAND - Hệ thống Điểm Yêu Thương, Chuỗi Điểm Danh, Nhiệm Vụ Hằng Ngày (UTC+7) & Lịch Sử Điểm (quest.js)
 * - 7 nhiệm vụ hằng ngày gắn liền với Khu vườn, Nhà chung, Thú cưng & Tương tác đôi lứa.
 * - Làm mới tự động lúc 00:00 theo múi giờ Việt Nam (UTC+7).
 * - Ghi nhận Chuỗi ngày lên đảo liên tiếp (`loginStreak`).
 * - Chống nhận thưởng trùng tuyệt đối bằng Transaction nguyên tử + ID giao dịch cố định.
 */

import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp
} from './firebase.js';
import { SHARED_WORLD_ID } from './world.js';

/** Danh sách 7 nhiệm vụ hằng ngày của CTISLAND */
export const DAILY_QUEST_DEFS = [
  {
    id: 'daily_login',
    icon: '🌅',
    title: 'Điểm danh hôm nay',
    description: 'Đặt chân lên hòn đảo CTISLAND trong ngày mới.',
    target: 1,
    reward: 15,
    zoneId: null
  },
  {
    id: 'water_plants',
    icon: '💧',
    title: 'Tưới mát khu vườn',
    description: 'Vào Khu Vườn và tưới nước cho 3 ô cây đang lớn.',
    target: 3,
    reward: 20,
    zoneId: 'garden'
  },
  {
    id: 'harvest_crops',
    icon: '🧺',
    title: 'Thu hoạch mùa màng',
    description: 'Thu hoạch 2 ô cây trồng chín mọng tại Khu Vườn.',
    target: 2,
    reward: 25,
    zoneId: 'garden'
  },
  {
    id: 'care_pet_zone',
    icon: '🐾',
    title: 'Cưng nựng thú cưng',
    description: 'Vào Khu Thú Cưng cho ăn, vuốt ve hoặc chơi đùa (2 lần).',
    target: 2,
    reward: 20,
    zoneId: 'pet'
  },
  {
    id: 'tidy_house',
    icon: '🏡',
    title: 'Chăm chút tổ ấm',
    description: 'Ghé Khu Nhà Chung dọn nhà, đổi tường/sàn hoặc bày nội thất.',
    target: 1,
    reward: 15,
    zoneId: 'house'
  },
  {
    id: 'couple_moment',
    icon: '💌',
    title: 'Gửi lời yêu thương',
    description: 'Gửi 1 câu chat bong bóng, thả biểu cảm hoặc viết Lưu bút Kỷ niệm.',
    target: 1,
    reward: 20,
    zoneId: null
  },
  {
    id: 'island_harmony',
    icon: '💞',
    title: 'Tâm đầu ý hợp',
    description: 'Cùng nhau hoàn thành ít nhất 4 nhiệm vụ trên đảo trong hôm nay.',
    target: 4,
    reward: 35,
    zoneId: null
  }
];

const QUEST_DEF_MAP = Object.fromEntries(DAILY_QUEST_DEFS.map((q) => [q.id, q]));
const BASE_QUEST_IDS = [
  'daily_login',
  'water_plants',
  'harvest_crops',
  'care_pet_zone',
  'tidy_house',
  'couple_moment'
];

/**
 * Lấy mã ngày theo múi giờ Việt Nam (UTC+7), định dạng `YYYY-MM-DD`.
 * @param {number} [offsetDays=0]
 * @returns {string}
 */
export function getVietnamDateKey(offsetDays = 0) {
  const vnTimeMs = Date.now() + 7 * 60 * 60 * 1000 + offsetDays * 86400000;
  return new Date(vnTimeMs).toISOString().slice(0, 10);
}

/**
 * Định dạng `YYYY-MM-DD` sang `DD/MM/YYYY`.
 */
export function formatVietnamDate(dateKey) {
  if (!dateKey || dateKey.length !== 10) return '';
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

export function getQuestDocId(dateKey = getVietnamDateKey()) {
  return `${SHARED_WORLD_ID}_${dateKey}`;
}

/**
 * Tạo cấu trúc 7 nhiệm vụ mặc định cho ngày mới.
 */
export function buildInitialQuestItems() {
  return {
    daily_login: {
      progress: 1,
      target: 1,
      reward: 15,
      completed: true,
      claimed: false
    },
    water_plants: {
      progress: 0,
      target: 3,
      reward: 20,
      completed: false,
      claimed: false
    },
    harvest_crops: {
      progress: 0,
      target: 2,
      reward: 25,
      completed: false,
      claimed: false
    },
    care_pet_zone: {
      progress: 0,
      target: 2,
      reward: 20,
      completed: false,
      claimed: false
    },
    tidy_house: {
      progress: 0,
      target: 1,
      reward: 15,
      completed: false,
      claimed: false
    },
    couple_moment: {
      progress: 0,
      target: 1,
      reward: 20,
      completed: false,
      claimed: false
    },
    island_harmony: {
      progress: 1,
      target: 4,
      reward: 35,
      completed: false,
      claimed: false
    }
  };
}

/**
 * Chuẩn hóa dữ liệu nhiệm vụ để tương thích mượt với bản ghi cũ trong cùng ngày.
 */
export function normalizeQuestItems(rawItems = {}) {
  const defaults = buildInitialQuestItems();
  const merged = {};
  for (const def of DAILY_QUEST_DEFS) {
    merged[def.id] = {
      ...defaults[def.id],
      ...(rawItems[def.id] || {})
    };
  }
  return merged;
}

/**
 * Đồng bộ chuỗi ngày điểm danh liên tiếp (`loginStreak`) trên hòn đảo chung.
 */
export async function syncDailyLoginStreak(worldData) {
  const todayKey = getVietnamDateKey(0);
  const yesterdayKey = getVietnamDateKey(-1);
  const streak = worldData?.loginStreak || { count: 0, lastDateKey: '' };

  if (streak.lastDateKey === todayKey) {
    return streak.count || 1;
  }

  const nextCount = streak.lastDateKey === yesterdayKey ? (Number(streak.count || 0) + 1) : 1;
  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  await updateDoc(worldRef, {
    loginStreak: {
      count: nextCount,
      lastDateKey: todayKey
    },
    updatedAt: serverTimestamp()
  });

  return nextCount;
}

/**
 * Khởi tạo nhiệm vụ hôm nay theo giờ Việt Nam UTC+7 (chỉ ghi nếu chưa có).
 */
export async function ensureTodayQuestsInitialized() {
  const dateKey = getVietnamDateKey();
  const questDocId = getQuestDocId(dateKey);
  const questRef = doc(db, 'quests', questDocId);

  const snap = await getDoc(questRef);
  if (snap.exists()) {
    return dateKey;
  }

  await runTransaction(db, async (tx) => {
    const freshSnap = await tx.get(questRef);
    if (freshSnap.exists()) return;

    tx.set(questRef, {
      worldId: SHARED_WORLD_ID,
      dateKey,
      items: buildInitialQuestItems(),
      updatedAt: serverTimestamp()
    });
  });

  return dateKey;
}

/**
 * Ghi nhận tiến độ nhiệm vụ hằng ngày.
 * @param {'water_plants'|'harvest_crops'|'care_pet_zone'|'tidy_house'|'couple_moment'} questId
 */
export async function progressIslandQuest(questId) {
  const def = QUEST_DEF_MAP[questId];
  if (!def) throw new Error('Nhiệm vụ không hợp lệ.');

  const dateKey = getVietnamDateKey();
  const questRef = doc(db, 'quests', getQuestDocId(dateKey));

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(questRef);
    const items = snap.exists() ? normalizeQuestItems(snap.data().items) : buildInitialQuestItems();

    const current = items[questId];
    if (current.completed) {
      return {
        alreadyCompleted: true,
        progress: current.progress,
        target: def.target,
        justCompleted: false,
        harmonyJustCompleted: false
      };
    }

    const nextProgress = Math.min(def.target, (current.progress || 0) + 1);
    const nowCompleted = nextProgress >= def.target;

    items[questId] = {
      ...current,
      progress: nextProgress,
      target: def.target,
      reward: def.reward,
      completed: nowCompleted
    };

    const completedCount = BASE_QUEST_IDS.filter((id) => items[id]?.completed).length;
    const prevHarmony = items.island_harmony;
    const harmonyTarget = QUEST_DEF_MAP.island_harmony.target;
    const nextHarmonyProgress = Math.min(harmonyTarget, completedCount);
    const harmonyNowCompleted = prevHarmony.completed || nextHarmonyProgress >= harmonyTarget;
    const harmonyJustCompleted = !prevHarmony.completed && harmonyNowCompleted;

    items.island_harmony = {
      ...prevHarmony,
      progress: Math.max(prevHarmony.progress || 0, nextHarmonyProgress),
      target: harmonyTarget,
      reward: QUEST_DEF_MAP.island_harmony.reward,
      completed: harmonyNowCompleted
    };

    if (snap.exists()) {
      tx.update(questRef, {
        items,
        updatedAt: serverTimestamp()
      });
    } else {
      tx.set(questRef, {
        worldId: SHARED_WORLD_ID,
        dateKey,
        items,
        updatedAt: serverTimestamp()
      });
    }

    return {
      alreadyCompleted: false,
      progress: nextProgress,
      target: def.target,
      justCompleted: nowCompleted,
      harmonyJustCompleted
    };
  });
}

/**
 * Nhận thưởng Điểm yêu thương cho nhiệm vụ đã hoàn thành (chống nhận trùng nguyên tử).
 */
export async function claimQuestReward({ questId, userProfile }) {
  const def = QUEST_DEF_MAP[questId];
  if (!def) throw new Error('Không tìm thấy thông tin nhiệm vụ.');

  const dateKey = getVietnamDateKey();
  const questDocId = getQuestDocId(dateKey);
  const txId = `claim_${dateKey}_${questId}`;

  const questRef = doc(db, 'quests', questDocId);
  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  const txRef = doc(db, 'transactions', txId);

  return runTransaction(db, async (transaction) => {
    const [questSnap, worldSnap, txSnap] = await Promise.all([
      transaction.get(questRef),
      transaction.get(worldRef),
      transaction.get(txRef)
    ]);

    if (txSnap.exists()) {
      throw new Error('Phần thưởng nhiệm vụ này đã được nhận hôm nay rồi!');
    }
    if (!questSnap.exists()) {
      throw new Error('Dữ liệu nhiệm vụ hôm nay chưa sẵn sàng. Hãy thử lại nhé!');
    }
    if (!worldSnap.exists()) {
      throw new Error('Không tìm thấy dữ liệu hòn đảo.');
    }

    const items = normalizeQuestItems(questSnap.data().items);
    const targetItem = items[questId];

    if (!targetItem || !targetItem.completed) {
      throw new Error('Nhiệm vụ này chưa hoàn thành đủ tiến độ.');
    }
    if (targetItem.claimed) {
      throw new Error('Phần thưởng này đã được nhận rồi!');
    }

    const currentPoints = Number(worldSnap.data().lovePoints || 0);
    const reward = def.reward;
    const newBalance = currentPoints + reward;

    items[questId] = {
      ...targetItem,
      reward,
      claimed: true,
      claimedBy: userProfile.displayName,
      claimedAtMs: Date.now()
    };

    transaction.update(questRef, {
      items,
      updatedAt: serverTimestamp()
    });

    transaction.set(txRef, {
      txId,
      worldId: SHARED_WORLD_ID,
      questDocId,
      type: 'earn',
      source: 'quest',
      questId,
      dateKey,
      amount: reward,
      balanceAfter: newBalance,
      description: `Nhiệm vụ: ${def.title}`,
      actorUid: userProfile.uid,
      actorName: userProfile.displayName,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    });

    transaction.update(worldRef, {
      lovePoints: newBalance,
      lastTxId: txId,
      updatedAt: serverTimestamp()
    });

    return {
      reward,
      newBalance,
      title: def.title
    };
  });
}

/**
 * Lắng nghe thay đổi tiến độ nhiệm vụ hôm nay giữa 2 người qua 1 listener onSnapshot.
 */
export function subscribeTodayQuests(dateKey, onData, onError) {
  const questRef = doc(db, 'quests', getQuestDocId(dateKey));
  return onSnapshot(
    questRef,
    (snap) => {
      if (!snap.exists()) {
        onData({
          worldId: SHARED_WORLD_ID,
          dateKey,
          items: buildInitialQuestItems()
        });
        return;
      }
      const data = snap.data();
      onData({
        ...data,
        items: normalizeQuestItems(data.items)
      });
    },
    (err) => onError?.(err)
  );
}

/**
 * Tải lịch sử cộng & trừ điểm gần nhất.
 */
export async function fetchPointTransactions(maxCount = 40) {
  const txQuery = query(
    collection(db, 'transactions'),
    orderBy('createdAtMs', 'desc'),
    limit(maxCount)
  );
  const snap = await getDocs(txQuery);
  return snap.docs.map((d) => d.data());
}
