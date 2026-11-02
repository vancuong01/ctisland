/**
 * CTISLAND - Hệ thống Cửa Hàng & Túi Đồ Chung Đầy Đủ (shop.js)
 * Gồm đầy đủ các danh mục:
 * 1. Hạt giống nông trại (5 loại)
 * 2. Nội thất, Cây cảnh, Giấy dán tường & Sàn nhà (15 món)
 * 3. Trang phục & Nón phụ kiện nhân vật (10 mẫu)
 * 4. Phụ kiện thú cưng dễ thương (5 mẫu)
 * Toàn bộ vật phẩm đã mua được lưu vào Túi đồ chung `inventory/ctisland_main`.
 */

import {
  db,
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from './firebase.js';
import { SHARED_WORLD_ID } from './world.js';

/** 1. Danh mục Hạt giống trồng trong Khu vườn */
export const SEED_CATALOG = [
  {
    id: 'seed_clover',
    name: 'Hạt Cỏ Bốn Lá',
    icon: '🍀',
    category: 'seed',
    price: 5,
    growSeconds: 45,
    harvestReward: 12,
    cropColor: '#52b788',
    description: 'Nảy mầm cực nhanh (45 giây), mang lại may mắn và +12 ❤️ khi thu hoạch.'
  },
  {
    id: 'seed_daisy',
    name: 'Hạt Cúc Họa Mi',
    icon: '🌼',
    category: 'seed',
    price: 12,
    growSeconds: 120,
    harvestReward: 26,
    cropColor: '#ffd166',
    description: 'Nở hoa trắng nhụy vàng sau 2 phút, thu hoạch nhận +26 ❤️.'
  },
  {
    id: 'seed_strawberry',
    name: 'Hạt Dâu Tây Ngọt',
    icon: '🍓',
    category: 'seed',
    price: 25,
    growSeconds: 240,
    harvestReward: 54,
    cropColor: '#ff6b8b',
    description: 'Quả chín đỏ mọng sau 4 phút, thu hoạch nhận +54 ❤️.'
  },
  {
    id: 'seed_sunflower',
    name: 'Hạt Hướng Dương',
    icon: '🌻',
    category: 'seed',
    price: 45,
    growSeconds: 480,
    harvestReward: 96,
    cropColor: '#f4a261',
    description: 'Rực rỡ ánh nắng sau 8 phút, thu hoạch nhận +96 ❤️.'
  },
  {
    id: 'seed_rose',
    name: 'Hạt Hồng Tình Yêu',
    icon: '🌹',
    category: 'seed',
    price: 80,
    growSeconds: 900,
    harvestReward: 175,
    cropColor: '#e63963',
    description: 'Hoa hồng đôi quý hiếm (15 phút), thu hoạch nhận +175 ❤️.'
  }
];

/** 2. Danh mục Đồ trang trí Nhà chung (Nội thất, Cây cảnh, Tường, Sàn) */
export const DECOR_CATALOG = [
  {
    id: 'sofa_pink',
    name: 'Sofa Đôi Hồng Phấn',
    icon: '🛋️',
    category: 'furniture',
    price: 35,
    w: 76,
    h: 42,
    color: '#ffc2d1',
    accent: '#ff8fab',
    description: 'Ghế sofa êm ái cho hai người ngồi tựa vai nhau.'
  },
  {
    id: 'table_tea',
    name: 'Bàn Trà Gỗ Kem',
    icon: '🍵',
    category: 'furniture',
    price: 25,
    w: 56,
    h: 40,
    color: '#faedcd',
    accent: '#d4a373',
    description: 'Bàn gỗ nhỏ bày sẵn ấm trà nóng và bánh ngọt.'
  },
  {
    id: 'bed_couple',
    name: 'Giường Đôi Mây Trắng',
    icon: '🛏️',
    category: 'furniture',
    price: 65,
    w: 78,
    h: 68,
    color: '#ffe5ec',
    accent: '#ff8fab',
    description: 'Giường đôi chăn bông hồng pastel ấm áp.'
  },
  {
    id: 'rug_heart',
    name: 'Thảm Lông Trái Tim',
    icon: '💗',
    category: 'furniture',
    price: 30,
    w: 72,
    h: 54,
    isRug: true,
    color: '#ffd6e0',
    accent: '#ff8fab',
    description: 'Thảm trải sàn hình trái tim mềm mại (nhân vật bước lên được).'
  },
  {
    id: 'plant_monstera',
    name: 'Chậu Cây Lá Xẻ',
    icon: '🪴',
    category: 'plant',
    price: 20,
    w: 38,
    h: 38,
    color: '#74c69d',
    accent: '#d4a373',
    description: 'Chậu cây xanh mát đặt góc phòng thêm sức sống.'
  },
  {
    id: 'plant_sakura',
    name: 'Bình Đào Phai Nhỏ',
    icon: '🌸',
    category: 'plant',
    price: 32,
    w: 38,
    h: 40,
    color: '#ffb3c6',
    accent: '#fffdf7',
    description: 'Nhành hoa đào hồng dịu dàng nở quanh năm trong nhà.'
  },
  {
    id: 'lamp_star',
    name: 'Đèn Ngủ Ánh Sao',
    icon: '🏮',
    category: 'furniture',
    price: 28,
    w: 34,
    h: 36,
    color: '#fff3b0',
    accent: '#e6b89c',
    description: 'Đèn cây tỏa ánh vàng ấm cúng mỗi tối.'
  },
  {
    id: 'bookshelf_wood',
    name: 'Kệ Sách Kỷ Niệm',
    icon: '📚',
    category: 'furniture',
    price: 45,
    w: 68,
    h: 36,
    color: '#e6ccb2',
    accent: '#b08968',
    description: 'Kệ gỗ lưu giữ sách và album ảnh của hai đứa.'
  },
  // Giấy dán tường
  {
    id: 'wall_cream',
    name: 'Tường Kem Nắng Sớm',
    icon: '🎨',
    category: 'wallpaper',
    price: 0,
    color: '#fff8ec',
    border: '#e6d5c3',
    description: 'Màu tường kem ấm mặc định của ngôi nhà.'
  },
  {
    id: 'wall_pink',
    name: 'Tường Hồng Dâu Sữa',
    icon: '🎀',
    category: 'wallpaper',
    price: 40,
    color: '#ffeef3',
    border: '#f7bfd0',
    description: 'Giấy dán tường hồng phấn ngọt ngào.'
  },
  {
    id: 'wall_mint',
    name: 'Tường Xanh Bạc Hà',
    icon: '🌿',
    category: 'wallpaper',
    price: 40,
    color: '#eafaf1',
    border: '#a8dfc0',
    description: 'Giấy dán tường xanh lá pastel dịu mắt.'
  },
  {
    id: 'wall_lavender',
    name: 'Tường Tím Mộng Mơ',
    icon: '🔮',
    category: 'wallpaper',
    price: 50,
    color: '#f3effe',
    border: '#cbc0f5',
    description: 'Giấy dán tường tím pastel lãng mạn.'
  },
  // Sàn nhà
  {
    id: 'floor_wood',
    name: 'Sàn Gỗ Sồi Ấm',
    icon: '🪵',
    category: 'floor',
    price: 0,
    color: '#f6e7d2',
    line: '#e5cfb4',
    description: 'Sàn gỗ sồi sáng màu mặc định.'
  },
  {
    id: 'floor_checker',
    name: 'Sàn Gạch Kem Hồng',
    icon: '🏁',
    category: 'floor',
    price: 45,
    color: '#fff5f8',
    line: '#ffdde6',
    description: 'Sàn lát gạch caro hồng kem xinh xắn.'
  },
  {
    id: 'floor_mintwood',
    name: 'Sàn Gỗ Rêu Xanh',
    icon: '🍃',
    category: 'floor',
    price: 45,
    color: '#edf8f0',
    line: '#cfead6',
    description: 'Sàn gỗ phong cách Bắc Âu tươi mát.'
  }
];

/** 3. Danh mục Trang phục & Phụ kiện đầu cho Nhân vật (Mặc lên đổi ngay trên bản đồ 2D) */
export const OUTFIT_CATALOG = [
  {
    id: 'outfit_default',
    name: 'Áo Đảo Mặc Định',
    icon: '👕',
    category: 'outfit',
    price: 0,
    shirt: null,
    shirtStroke: null,
    description: 'Trang phục pastel gốc theo nhân vật của bạn.'
  },
  {
    id: 'outfit_sailor',
    name: 'Áo Đôi Thủy Thủ Biển',
    icon: '⚓',
    category: 'outfit',
    price: 38,
    shirt: '#bde0fe',
    shirtStroke: '#4ea8de',
    description: 'Áo xanh biển mát lành dạo quanh bờ cát.'
  },
  {
    id: 'outfit_strawberry',
    name: 'Trang Phục Dâu Kem',
    icon: '🍓',
    category: 'outfit',
    price: 45,
    shirt: '#ffb3c6',
    shirtStroke: '#e63963',
    description: 'Sắc hồng dâu ngọt ngào nổi bật trên đảo.'
  },
  {
    id: 'outfit_sunshine',
    name: 'Áo Nắng Mật Ong',
    icon: '🌼',
    category: 'outfit',
    price: 42,
    shirt: '#fff3b0',
    shirtStroke: '#e09f3e',
    description: 'Sắc vàng ấm áp như nắng sớm mùa thu.'
  },
  {
    id: 'outfit_royal',
    name: 'Lễ Phục Đôi Hoàng Gia',
    icon: '✨',
    category: 'outfit',
    price: 70,
    shirt: '#e0c3fc',
    shirtStroke: '#7b2cbf',
    description: 'Bộ lễ phục sang trọng cho những dịp kỷ niệm đặc biệt.'
  },
  // Nón & Phụ kiện đầu nhân vật
  {
    id: 'hat_none',
    name: 'Tóc Tự Nhiên',
    icon: '💇',
    category: 'hat',
    price: 0,
    badgeEmoji: null,
    description: 'Kiểu tóc tự nhiên mặc định của nhân vật.'
  },
  {
    id: 'hat_flower',
    name: 'Vòng Hoa Cúc Trắng',
    icon: '🌼',
    category: 'hat',
    price: 32,
    badgeEmoji: '🌼',
    description: 'Vòng hoa nhỏ xinh cài trên mái tóc.'
  },
  {
    id: 'hat_heart',
    name: 'Kẹp Tim Lấp Lánh',
    icon: '💖',
    category: 'hat',
    price: 30,
    badgeEmoji: '💖',
    description: 'Trái tim hồng lung linh trên đầu nhân vật.'
  },
  {
    id: 'hat_bunny',
    name: 'Băng Đô Tai Thỏ',
    icon: '🐰',
    category: 'hat',
    price: 45,
    badgeEmoji: '🎀',
    description: 'Nơ tai thỏ đáng yêu khi đi dạo cùng nhau.'
  },
  {
    id: 'hat_crown',
    name: 'Vương Miện Đôi Vàng',
    icon: '👑',
    category: 'hat',
    price: 65,
    badgeEmoji: '👑',
    description: 'Vương miện dành riêng cho hai chủ nhân hòn đảo.'
  }
];

/** 4. Danh mục Phụ kiện dễ thương cho Thú Cưng */
export const PET_ACCESSORY_CATALOG = [
  {
    id: 'pet_acc_bow',
    name: 'Nơ Hồng Xinh Xắn',
    icon: '🎀',
    category: 'pet_accessory',
    price: 25,
    description: 'Chiếc nơ hồng đeo cổ cực hợp với Mèo, Cún và Thỏ.'
  },
  {
    id: 'pet_acc_bell',
    name: 'Chuông Vàng Leng Keng',
    icon: '🔔',
    category: 'pet_accessory',
    price: 30,
    description: 'Chuông nhỏ phát tiếng vui tai mỗi khi thú cưng chạy nhảy.'
  },
  {
    id: 'pet_acc_flower',
    name: 'Hoa Anh Đào Cài Đầu',
    icon: '🌸',
    category: 'pet_accessory',
    price: 28,
    description: 'Bông hoa đào phấn cài trên tai thú cưng.'
  },
  {
    id: 'pet_acc_crown',
    name: 'Vương Miện Thú Cưng',
    icon: '👑',
    category: 'pet_accessory',
    price: 48,
    description: 'Biến bé cưng thành hoàng tử / công chúa sân chơi.'
  }
];

export const ALL_SHOP_ITEMS = [
  ...SEED_CATALOG,
  ...DECOR_CATALOG,
  ...OUTFIT_CATALOG,
  ...PET_ACCESSORY_CATALOG
];

export const SHOP_ITEM_MAP = Object.fromEntries(ALL_SHOP_ITEMS.map((item) => [item.id, item]));

export function getSeedInfo(seedId) {
  return SEED_CATALOG.find((s) => s.id === seedId) || null;
}

export function getDecorInfo(itemId) {
  return DECOR_CATALOG.find((d) => d.id === itemId) || null;
}

export function getOutfitInfo(itemId) {
  return OUTFIT_CATALOG.find((o) => o.id === itemId) || null;
}

export function getPetAccessoryInfo(itemId) {
  return PET_ACCESSORY_CATALOG.find((a) => a.id === itemId) || null;
}

/**
 * Tạo túi đồ khởi đầu.
 */
export function buildDefaultInventory() {
  return {
    worldId: SHARED_WORLD_ID,
    seeds: {
      seed_clover: 2
    },
    decor: {
      wall_cream: 1,
      floor_wood: 1
    },
    wardrobe: {
      outfit_default: 1,
      hat_none: 1
    },
    petAccessories: {}
  };
}

/**
 * Đảm bảo túi đồ chung `inventory/ctisland_main` đã được khởi tạo.
 */
export async function ensureSharedInventory() {
  const invRef = doc(db, 'inventory', SHARED_WORLD_ID);
  const snap = await getDoc(invRef);
  if (snap.exists()) return snap.data();

  const initial = buildDefaultInventory();
  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(invRef);
    if (!fresh.exists()) {
      tx.set(invRef, {
        ...initial,
        updatedAt: serverTimestamp()
      });
    }
  });
  return initial;
}

/**
 * Lắng nghe Túi đồ chung theo thời gian thực (1 listener duy nhất).
 */
export function subscribeSharedInventory(onData, onError) {
  const invRef = doc(db, 'inventory', SHARED_WORLD_ID);
  return onSnapshot(
    invRef,
    (snap) => {
      if (!snap.exists()) {
        onData(buildDefaultInventory());
        return;
      }
      onData(snap.data());
    },
    (err) => onError?.(err)
  );
}

/**
 * Mua vật phẩm trong Cửa hàng bằng Điểm yêu thương chung.
 * Mở khóa vào Túi đồ chung của hai người (Trang phục mở 1 lần là cả hai cùng mặc được!).
 */
export async function buyShopItem({ itemId, quantity = 1, userProfile }) {
  const item = SHOP_ITEM_MAP[itemId];
  if (!item) throw new Error('Vật phẩm không tồn tại trong cửa hàng.');

  const qty = Math.max(1, Math.min(20, Math.floor(quantity)));
  const isUniqueUnlock =
    item.category === 'wallpaper' ||
    item.category === 'floor' ||
    item.category === 'outfit' ||
    item.category === 'hat';

  const finalQty = isUniqueUnlock ? 1 : qty;
  const totalCost = item.price * finalQty;

  if (totalCost <= 0) {
    throw new Error('Vật phẩm mặc định này đã có sẵn trong tủ đồ rồi!');
  }

  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  const invRef = doc(db, 'inventory', SHARED_WORLD_ID);
  const txId = `shop_${Date.now()}_${userProfile.uid.slice(0, 5)}`;
  const txRef = doc(db, 'transactions', txId);

  return runTransaction(db, async (tx) => {
    const [worldSnap, invSnap] = await Promise.all([
      tx.get(worldRef),
      tx.get(invRef)
    ]);

    if (!worldSnap.exists()) throw new Error('Không tìm thấy dữ liệu đảo.');

    const currentPoints = Number(worldSnap.data().lovePoints || 0);
    if (currentPoints < totalCost) {
      throw new Error(`Chưa đủ Điểm yêu thương! Cần ${totalCost} ❤️ nhưng hiện có ${currentPoints} ❤️.`);
    }

    const invData = invSnap.exists() ? invSnap.data() : buildDefaultInventory();
    const seeds = { ...(invData.seeds || {}) };
    const decor = { ...(invData.decor || {}) };
    const wardrobe = { ...(invData.wardrobe || {}) };
    const petAccessories = { ...(invData.petAccessories || {}) };

    if (item.category === 'wallpaper' || item.category === 'floor') {
      if ((decor[itemId] || 0) >= 1) {
        throw new Error('Hai bạn đã sở hữu mẫu tường/sàn này rồi!');
      }
      decor[itemId] = 1;
    } else if (item.category === 'outfit' || item.category === 'hat') {
      if ((wardrobe[itemId] || 0) >= 1) {
        throw new Error('Mẫu trang phục này đã có trong Tủ đồ chung của hai bạn rồi!');
      }
      wardrobe[itemId] = 1;
    } else if (item.category === 'seed') {
      seeds[itemId] = (seeds[itemId] || 0) + finalQty;
    } else if (item.category === 'pet_accessory') {
      petAccessories[itemId] = (petAccessories[itemId] || 0) + finalQty;
    } else {
      decor[itemId] = (decor[itemId] || 0) + finalQty;
    }

    const newBalance = currentPoints - totalCost;
    const nextInvPayload = {
      worldId: SHARED_WORLD_ID,
      seeds,
      decor,
      wardrobe,
      petAccessories,
      updatedAt: serverTimestamp()
    };

    if (invSnap.exists()) {
      tx.update(invRef, nextInvPayload);
    } else {
      tx.set(invRef, nextInvPayload);
    }

    tx.set(txRef, {
      txId,
      worldId: SHARED_WORLD_ID,
      type: 'spend',
      source: 'shop',
      amount: totalCost,
      balanceAfter: newBalance,
      description: `Mua ${finalQty > 1 ? `${finalQty}x ` : ''}${item.name}`,
      actorUid: userProfile.uid,
      actorName: userProfile.displayName,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    });

    tx.update(worldRef, {
      lovePoints: newBalance,
      lastTxId: txId,
      updatedAt: serverTimestamp()
    });

    return {
      item,
      quantity: finalQty,
      totalCost,
      newBalance
    };
  });
}

/**
 * Lưu bộ trang phục & phụ kiện đầu đang mặc của từng người chơi vào `users/{uid}`.
 */
export async function saveUserWardrobe(uid, { outfitId, hatId }) {
  if (!uid) return;
  const userRef = doc(db, 'users', uid);
  const updates = { updatedAt: serverTimestamp() };
  if (outfitId !== undefined) updates.equippedOutfit = outfitId;
  if (hatId !== undefined) updates.equippedHat = hatId;
  await updateDoc(userRef, updates);
}
