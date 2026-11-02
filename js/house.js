/**
 * CTISLAND - Map Riêng Khu Nhà Chung: Trang Trí & Nâng Cấp Nhà (house.js)
 * - Nâng cấp nhà từ Cấp 1 -> Cấp 4 bằng Điểm yêu thương (mở rộng diện tích phòng thật sự).
 * - Đổi giấy dán tường, đổi sàn nhà, đặt / kéo di chuyển / cất đồ nội thất đồng bộ 2 người.
 */

import {
  db,
  doc,
  updateDoc,
  runTransaction,
  serverTimestamp
} from './firebase.js';
import { SHARED_WORLD_ID, MAP_WIDTH, MAP_HEIGHT } from './world.js';
import { getDecorInfo, buildDefaultInventory } from './shop.js';

/** Cấu hình 4 cấp độ nâng cấp Ngôi nhà chung */
export const HOUSE_LEVELS = {
  1: {
    level: 1,
    name: 'Nhà Gỗ Nhỏ Xinh',
    upgradeCost: 0,
    roomW: 440,
    roomH: 290,
    maxFurniture: 8,
    perk: 'Không gian ấm cúng khởi đầu của hai đứa'
  },
  2: {
    level: 2,
    name: 'Nhà Vườn Đón Nắng',
    upgradeCost: 90,
    roomW: 580,
    roomH: 340,
    maxFurniture: 16,
    perk: 'Mở rộng phòng +32%, thêm cửa sổ đôi đón nắng'
  },
  3: {
    level: 3,
    name: 'Biệt Thự Pastel',
    upgradeCost: 220,
    roomW: 710,
    roomH: 390,
    maxFurniture: 26,
    perk: 'Phòng khách lớn + lò sưởi ấm áp mùa đông'
  },
  4: {
    level: 4,
    name: 'Lâu Đài Đôi Lứa',
    upgradeCost: 420,
    roomW: 830,
    roomH: 430,
    maxFurniture: 40,
    perk: 'Đại sảnh rộng nhất đảo, thỏa sức bày biện tổ ấm'
  }
};

export const MAX_HOUSE_LEVEL = 4;

/**
 * Chuẩn hóa dữ liệu ngôi nhà từ worldData.
 */
export function getNormalizedHouse(worldData) {
  const raw = worldData?.house || {};
  const level = Math.max(1, Math.min(MAX_HOUSE_LEVEL, Number(raw.level || 1)));
  return {
    level,
    wallpaper: raw.wallpaper || 'wall_cream',
    floor: raw.floor || 'floor_wood',
    placedItems: Array.isArray(raw.placedItems) ? raw.placedItems : []
  };
}

/**
 * Tính tọa độ khung căn phòng bên trong Map Nhà Chung theo cấp độ nhà.
 */
export function getHouseRoomRect(level = 1) {
  const cfg = HOUSE_LEVELS[level] || HOUSE_LEVELS[1];
  const wallHeight = 58;
  const x = Math.round((MAP_WIDTH - cfg.roomW) / 2);
  const y = Math.round((MAP_HEIGHT - cfg.roomH) / 2) + 18;
  return {
    x,
    y,
    w: cfg.roomW,
    h: cfg.roomH,
    wallTop: y - wallHeight,
    wallHeight,
    doorX: MAP_WIDTH / 2,
    doorY: y + cfg.roomH - 16
  };
}

export function getHouseExitPortal(worldData) {
  const house = getNormalizedHouse(worldData);
  const room = getHouseRoomRect(house.level);
  return {
    id: 'exit_to_island',
    targetMap: 'island',
    name: 'Ra Đảo Chính',
    icon: '🏝️',
    x: room.doorX,
    y: room.doorY,
    radius: 38
  };
}

export function getHouseSpawn(worldData) {
  const house = getNormalizedHouse(worldData);
  const room = getHouseRoomRect(house.level);
  return {
    x: room.doorX,
    y: room.doorY - 46
  };
}

/**
 * Kiểm tra va chạm tường bên trong căn phòng Ngôi nhà chung.
 */
export function isHousePositionBlocked(x, y, worldData, radius = 14) {
  const house = getNormalizedHouse(worldData);
  const room = getHouseRoomRect(house.level);

  if (
    x - radius < room.x + 12 ||
    x + radius > room.x + room.w - 12 ||
    y - radius < room.y + 14 ||
    y + radius > room.y + room.h - 10
  ) {
    return true;
  }
  return false;
}

/**
 * Tìm món nội thất đang đặt tại tọa độ (mapX, mapY) trong phòng.
 */
export function findPlacedFurnitureAt(mapX, mapY, worldData) {
  const house = getNormalizedHouse(worldData);
  // Ưu tiên tìm từ món vẽ sau cùng (trên cùng) ngược về trước
  for (let i = house.placedItems.length - 1; i >= 0; i--) {
    const p = house.placedItems[i];
    const info = getDecorInfo(p.itemId);
    if (!info) continue;
    const halfW = (info.w || 48) / 2 + 6;
    const halfH = (info.h || 40) / 2 + 6;
    if (
      mapX >= p.x - halfW &&
      mapX <= p.x + halfW &&
      mapY >= p.y - halfH &&
      mapY <= p.y + halfH
    ) {
      return { placed: p, info, index: i };
    }
  }
  return null;
}

/**
 * Nâng cấp Ngôi nhà chung lên cấp tiếp theo bằng Điểm yêu thương.
 */
export async function upgradeSharedHouse(userProfile) {
  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  const txId = `house_up_${Date.now()}_${userProfile.uid.slice(0, 5)}`;
  const txRef = doc(db, 'transactions', txId);

  return runTransaction(db, async (tx) => {
    const worldSnap = await tx.get(worldRef);
    if (!worldSnap.exists()) throw new Error('Không tìm thấy dữ liệu đảo.');

    const worldData = worldSnap.data();
    const house = getNormalizedHouse(worldData);

    if (house.level >= MAX_HOUSE_LEVEL) {
      throw new Error('Ngôi nhà chung đã đạt cấp độ tối đa (Lâu Đài Đôi Lứa)!');
    }

    const nextLevel = house.level + 1;
    const nextCfg = HOUSE_LEVELS[nextLevel];
    const cost = nextCfg.upgradeCost;
    const currentPoints = Number(worldData.lovePoints || 0);

    if (currentPoints < cost) {
      throw new Error(`Chưa đủ điểm nâng cấp lên ${nextCfg.name}! Cần ${cost} ❤️ (hiện có ${currentPoints} ❤️).`);
    }

    const newBalance = currentPoints - cost;

    tx.set(txRef, {
      txId,
      worldId: SHARED_WORLD_ID,
      type: 'spend',
      source: 'house_upgrade',
      amount: cost,
      balanceAfter: newBalance,
      description: `Nâng cấp nhà lên Cấp ${nextLevel}: ${nextCfg.name}`,
      actorUid: userProfile.uid,
      actorName: userProfile.displayName,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    });

    tx.update(worldRef, {
      lovePoints: newBalance,
      lastTxId: txId,
      house: {
        ...house,
        level: nextLevel
      },
      updatedAt: serverTimestamp()
    });

    return {
      nextCfg,
      cost,
      newBalance
    };
  });
}

/**
 * Đổi Giấy dán tường hoặc Sàn nhà từ Túi đồ chung.
 */
export async function applyHouseSurfaceStyle({ itemId }) {
  const info = getDecorInfo(itemId);
  if (!info || (info.category !== 'wallpaper' && info.category !== 'floor')) {
    throw new Error('Mẫu trang trí không hợp lệ.');
  }

  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  const invRef = doc(db, 'inventory', SHARED_WORLD_ID);

  await runTransaction(db, async (tx) => {
    const [worldSnap, invSnap] = await Promise.all([
      tx.get(worldRef),
      tx.get(invRef)
    ]);

    if (!worldSnap.exists()) throw new Error('Không tìm thấy dữ liệu đảo.');
    const inv = invSnap.exists() ? invSnap.data() : buildDefaultInventory();
    const owned = Number(inv.decor?.[itemId] || 0);

    if (info.price > 0 && owned < 1) {
      throw new Error('Mẫu này chưa có trong Túi đồ! Hãy mua ở Cửa hàng trước nhé.');
    }

    const house = getNormalizedHouse(worldSnap.data());
    if (info.category === 'wallpaper') {
      house.wallpaper = itemId;
    } else {
      house.floor = itemId;
    }

    tx.update(worldRef, {
      house,
      updatedAt: serverTimestamp()
    });
  });

  return info;
}

/**
 * Đặt 1 món nội thất từ Túi đồ chung ra sàn Ngôi nhà chung.
 */
export async function placeFurnitureItem({ itemId, x, y }) {
  const info = getDecorInfo(itemId);
  if (!info || (info.category !== 'furniture' && info.category !== 'plant')) {
    throw new Error('Vật phẩm này không phải đồ đặt sàn.');
  }

  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  const invRef = doc(db, 'inventory', SHARED_WORLD_ID);

  return runTransaction(db, async (tx) => {
    const [worldSnap, invSnap] = await Promise.all([
      tx.get(worldRef),
      tx.get(invRef)
    ]);

    if (!worldSnap.exists()) throw new Error('Không tìm thấy dữ liệu đảo.');
    const inv = invSnap.exists() ? invSnap.data() : buildDefaultInventory();
    const ownedCount = Number(inv.decor?.[itemId] || 0);

    const house = getNormalizedHouse(worldSnap.data());
    const levelCfg = HOUSE_LEVELS[house.level] || HOUSE_LEVELS[1];

    if (house.placedItems.length >= levelCfg.maxFurniture) {
      throw new Error(`Nhà Cấp ${house.level} đặt tối đa ${levelCfg.maxFurniture} món. Hãy nâng cấp nhà để mở rộng thêm nhé!`);
    }

    const alreadyPlacedSameType = house.placedItems.filter((p) => p.itemId === itemId).length;
    if (alreadyPlacedSameType >= ownedCount) {
      throw new Error(`Bạn đã đặt hết số "${info.name}" đang có (${ownedCount}/${ownedCount}).`);
    }

    const room = getHouseRoomRect(house.level);
    const padX = (info.w || 48) / 2 + 16;
    const padY = (info.h || 40) / 2 + 18;
    const clampedX = Math.round(Math.max(room.x + padX, Math.min(room.x + room.w - padX, x ?? room.doorX)));
    const clampedY = Math.round(Math.max(room.y + padY, Math.min(room.y + room.h - padY - 24, y ?? (room.y + room.h / 2))));

    const newItem = {
      uid: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      itemId,
      x: clampedX,
      y: clampedY
    };

    tx.update(worldRef, {
      house: {
        ...house,
        placedItems: [...house.placedItems, newItem]
      },
      updatedAt: serverTimestamp()
    });

    return newItem;
  });
}

/**
 * Di chuyển vị trí món nội thất đang đặt trong phòng.
 */
export async function movePlacedFurniture({ placedUid, x, y, worldData }) {
  const house = getNormalizedHouse(worldData);
  const target = house.placedItems.find((p) => p.uid === placedUid);
  if (!target) return;

  const info = getDecorInfo(target.itemId);
  const room = getHouseRoomRect(house.level);
  const padX = (info?.w || 48) / 2 + 14;
  const padY = (info?.h || 40) / 2 + 14;

  const clampedX = Math.round(Math.max(room.x + padX, Math.min(room.x + room.w - padX, x)));
  const clampedY = Math.round(Math.max(room.y + padY, Math.min(room.y + room.h - padY, y)));

  const updatedPlaced = house.placedItems.map((p) =>
    p.uid === placedUid ? { ...p, x: clampedX, y: clampedY } : p
  );

  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  await updateDoc(worldRef, {
    'house.placedItems': updatedPlaced,
    updatedAt: serverTimestamp()
  });
}

/**
 * Cất 1 món nội thất từ phòng về lại Túi đồ chung.
 */
export async function removePlacedFurniture(placedUid, worldData) {
  const house = getNormalizedHouse(worldData);
  const updatedPlaced = house.placedItems.filter((p) => p.uid !== placedUid);

  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  await updateDoc(worldRef, {
    'house.placedItems': updatedPlaced,
    updatedAt: serverTimestamp()
  });
}

/* ==========================================================================
   Vẽ Map 2D Bên Trong Ngôi Nhà Chung Lên Canvas
   ========================================================================== */
export function drawHouseInteriorMap(ctx, timeSec, worldData, isNearExit, selectedPlacedUid = null) {
  const house = getNormalizedHouse(worldData);
  const levelCfg = HOUSE_LEVELS[house.level] || HOUSE_LEVELS[1];
  const room = getHouseRoomRect(house.level);

  const wallStyle = getDecorInfo(house.wallpaper) || { color: '#fff8ec', border: '#e6d5c3' };
  const floorStyle = getDecorInfo(house.floor) || { color: '#f6e7d2', line: '#e5cfb4' };

  // 1. Khung cảnh sân vườn mờ ấm bên ngoài ngôi nhà
  ctx.fillStyle = '#2b2320';
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  const bgGrad = ctx.createRadialGradient(480, 280, 120, 480, 280, 560);
  bgGrad.addColorStop(0, '#59483e');
  bgGrad.addColorStop(1, '#362b25');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  // Đổ bóng khung nhà
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.roundRect(room.x - 10, room.wallTop - 6, room.w + 20, room.h + room.wallHeight + 20, 18);
  ctx.fill();

  // 2. Bức tường hậu (Giấy dán tường)
  ctx.fillStyle = wallStyle.color;
  ctx.strokeStyle = wallStyle.border || '#e6d5c3';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(room.x, room.wallTop, room.w, room.wallHeight + 10, [14, 14, 0, 0]);
  ctx.fill();
  ctx.stroke();

  // Sọc trang trí nhẹ trên giấy dán tường
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 2;
  for (let wx = room.x + 24; wx < room.x + room.w - 16; wx += 32) {
    ctx.beginPath();
    ctx.moveTo(wx, room.wallTop + 6);
    ctx.lineTo(wx, room.y);
    ctx.stroke();
  }

  // Cửa sổ đón nắng trên tường (nhiều cửa sổ hơn khi nâng cấp nhà!)
  const windowOffsets = house.level === 1 ? [-110, 110] : [-190, 0, 190];
  for (const offset of windowOffsets) {
    const winX = MAP_WIDTH / 2 + offset - 24;
    const winY = room.wallTop + 12;
    ctx.fillStyle = '#dff6ff';
    ctx.strokeStyle = '#c69f7d';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(winX, winY, 48, 34, 6);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(winX + 24, winY);
    ctx.lineTo(winX + 24, winY + 34);
    ctx.stroke();
  }

  // Nếu nhà Cấp 3 trở lên: có thêm Lò sưởi ấm áp ở chính giữa tường!
  if (house.level >= 3) {
    const fx = MAP_WIDTH / 2 - 28;
    const fy = room.wallTop + 14;
    ctx.fillStyle = '#f4dcd6';
    ctx.strokeStyle = '#c98a7b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(fx, fy, 56, 44, 6);
    ctx.fill();
    ctx.stroke();

    const flicker = Math.sin(timeSec * 8) * 2;
    ctx.fillStyle = '#ff9f1c';
    ctx.beginPath();
    ctx.arc(MAP_WIDTH / 2, fy + 32, 10 + flicker * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Sàn nhà
  ctx.fillStyle = floorStyle.color;
  ctx.strokeStyle = '#d4b595';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(room.x, room.y, room.w, room.h, [0, 0, 14, 14]);
  ctx.fill();
  ctx.stroke();

  // Họa tiết ván sàn hoặc gạch caro
  ctx.save();
  ctx.beginPath();
  ctx.rect(room.x + 3, room.y + 3, room.w - 6, room.h - 6);
  ctx.clip();

  if (house.floor === 'floor_checker') {
    const tile = 36;
    ctx.fillStyle = floorStyle.line;
    for (let gx = room.x; gx < room.x + room.w; gx += tile) {
      for (let gy = room.y; gy < room.y + room.h; gy += tile) {
        if (((Math.floor((gx - room.x) / tile) + Math.floor((gy - room.y) / tile)) % 2) === 0) {
          ctx.fillRect(gx, gy, tile, tile);
        }
      }
    }
  } else {
    ctx.strokeStyle = floorStyle.line;
    ctx.lineWidth = 1.5;
    for (let gy = room.y + 28; gy < room.y + room.h; gy += 28) {
      ctx.beginPath();
      ctx.moveTo(room.x, gy);
      ctx.lineTo(room.x + room.w, gy);
      ctx.stroke();
    }
  }
  ctx.restore();

  // 4. Vẽ các tấm thảm trước (nằm sát sàn nhà)
  for (const placed of house.placedItems) {
    const info = getDecorInfo(placed.itemId);
    if (info?.isRug) {
      drawSingleFurniture(ctx, placed, info, placed.uid === selectedPlacedUid);
    }
  }

  // 5. Thảm cửa ra vào ở cạnh dưới phòng
  ctx.fillStyle = isNearExit ? '#ff8fab' : '#ffc2d1';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(room.doorX - 46, room.doorY - 12, 92, 24, 10);
  ctx.fill();
  ctx.stroke();

  ctx.font = '800 11px Nunito, sans-serif';
  ctx.fillStyle = isNearExit ? '#ffffff' : '#6d3b4e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isNearExit ? '[E] Ra Đảo' : '⬇️ Cửa ra', room.doorX, room.doorY);

  // 6. Vẽ đồ nội thất & cây cảnh
  for (const placed of house.placedItems) {
    const info = getDecorInfo(placed.itemId);
    if (info && !info.isRug) {
      drawSingleFurniture(ctx, placed, info, placed.uid === selectedPlacedUid);
    }
  }

  // Huy hiệu cấp độ nhà ở góc trái trên màn hình
  ctx.fillStyle = 'rgba(255, 253, 248, 0.92)';
  ctx.strokeStyle = '#f3d5c0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(24, 20, 270, 30, 15);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#5c4b40';
  ctx.font = '800 12px Nunito, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(
    `🏡 Cấp ${house.level}: ${levelCfg.name} (${house.placedItems.length}/${levelCfg.maxFurniture} món)`,
    38,
    35
  );
}

function drawSingleFurniture(ctx, placed, info, isSelected) {
  const w = info.w || 48;
  const h = info.h || 40;
  const x = placed.x - w / 2;
  const y = placed.y - h / 2;

  ctx.save();

  if (!info.isRug) {
    ctx.fillStyle = 'rgba(74, 59, 50, 0.14)';
    ctx.beginPath();
    ctx.ellipse(placed.x, placed.y + h / 2 + 2, w * 0.46, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = info.color || '#faedcd';
  ctx.strokeStyle = isSelected ? '#ff4d79' : (info.accent || '#d4a373');
  ctx.lineWidth = isSelected ? 3 : 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, info.isRug ? 20 : 10);
  ctx.fill();
  ctx.stroke();

  // Icon đại diện sắc nét ở tâm món đồ
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(info.icon, placed.x, placed.y + 1);

  if (isSelected) {
    ctx.font = '800 10px Nunito, sans-serif';
    ctx.fillStyle = '#ff4d79';
    ctx.fillText('Kéo để dời chỗ', placed.x, y - 9);
  }

  ctx.restore();
}
