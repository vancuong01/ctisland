/**
 * CTISLAND - Map Riêng Khu Vườn 54 Ô Đất (garden.js)
 * - Mở sẵn 6 ô đất đầu tiên, cho phép mở thêm bằng Điểm yêu thương tối đa 54 ô đất (lưới 9x6).
 * - Gieo hạt giống từ Túi đồ chung -> Tưới nước tăng tốc -> Thu hoạch nhận Điểm yêu thương.
 */

import {
  db,
  doc,
  runTransaction,
  serverTimestamp
} from './firebase.js';
import { SHARED_WORLD_ID, MAP_WIDTH, MAP_HEIGHT } from './world.js';
import { getSeedInfo } from './shop.js';

export const INITIAL_GARDEN_PLOTS = 6;
export const MAX_GARDEN_PLOTS = 54;

const GRID_COLS = 9;
const GRID_ROWS = 6;
const PLOT_W = 68;
const PLOT_H = 52;
const GAP_X = 10;
const GAP_Y = 10;
const START_X = Math.round((MAP_WIDTH - (GRID_COLS * PLOT_W + (GRID_COLS - 1) * GAP_X)) / 2); // 134
const START_Y = 118;

/** Cổng thoát từ Khu vườn quay về Đảo chính */
export const GARDEN_EXIT_PORTAL = {
  id: 'exit_to_island',
  targetMap: 'island',
  name: 'Về Đảo Chính',
  icon: '🏝️',
  x: 480,
  y: 66,
  radius: 42
};

export const GARDEN_SPAWN = { x: 480, y: 98 };

/**
 * Tính giá Điểm yêu thương để mở ô đất tiếp theo (từ ô thứ 7 đến ô thứ 54).
 * @param {number} currentUnlocked - Số ô đất hiện đã mở
 * @returns {number}
 */
export function getNextPlotUnlockCost(currentUnlocked) {
  const nextNumber = currentUnlocked + 1;
  if (nextNumber <= 6) return 0;
  if (nextNumber <= 12) return 15;
  if (nextNumber <= 24) return 30;
  if (nextNumber <= 36) return 50;
  if (nextNumber <= 48) return 75;
  return 100; // Ô 49 -> 54
}

/**
 * Chuẩn hóa dữ liệu vườn từ worldData.
 * @param {Object|null} worldData
 */
export function getNormalizedGarden(worldData) {
  const raw = worldData?.garden || {};
  const unlockedCount = Math.max(
    INITIAL_GARDEN_PLOTS,
    Math.min(MAX_GARDEN_PLOTS, Number(raw.unlockedCount || INITIAL_GARDEN_PLOTS))
  );
  return {
    unlockedCount,
    plots: raw.plots || {}
  };
}

/**
 * Tọa độ hình chữ nhật của ô đất thứ `index` (0 -> 53).
 * @param {number} index
 */
export function getPlotRect(index) {
  const col = index % GRID_COLS;
  const row = Math.floor(index / GRID_COLS);
  const x = START_X + col * (PLOT_W + GAP_X);
  const y = START_Y + row * (PLOT_H + GAP_Y);
  return {
    index,
    col,
    row,
    x,
    y,
    w: PLOT_W,
    h: PLOT_H,
    cx: x + PLOT_W / 2,
    cy: y + PLOT_H / 2
  };
}

/**
 * Tìm ô đất tại vị trí người chơi vừa click / chạm trên Map Khu vườn.
 * @param {number} mapX
 * @param {number} mapY
 * @returns {Object|null}
 */
export function findGardenPlotAt(mapX, mapY) {
  for (let i = 0; i < MAX_GARDEN_PLOTS; i++) {
    const r = getPlotRect(i);
    if (mapX >= r.x && mapX <= r.x + r.w && mapY >= r.y && mapY <= r.y + r.h) {
      return r;
    }
  }
  return null;
}

/**
 * Tính trạng thái sinh trưởng thực tế của cây trên 1 ô đất.
 * @param {Object|null} plotData
 * @param {number} [nowMs]
 */
export function evaluatePlotCrop(plotData, nowMs = Date.now()) {
  if (!plotData || !plotData.seedId) {
    return { status: 'empty' };
  }
  const seed = getSeedInfo(plotData.seedId);
  if (!seed) return { status: 'empty' };

  // Nếu đã tưới nước thì rút ngắn 25% thời gian lớn
  const speedFactor = plotData.watered ? 0.75 : 1;
  const totalGrowMs = seed.growSeconds * 1000 * speedFactor;
  const elapsed = Math.max(0, nowMs - (plotData.plantedAtMs || nowMs));
  const progress = Math.min(1, elapsed / totalGrowMs);
  const remainSec = Math.max(0, Math.ceil((totalGrowMs - elapsed) / 1000));

  if (progress >= 1) {
    return {
      status: 'ripe',
      seed,
      progress: 1,
      remainSec: 0,
      watered: Boolean(plotData.watered)
    };
  }

  return {
    status: 'growing',
    seed,
    progress,
    remainSec,
    watered: Boolean(plotData.watered)
  };
}

/**
 * Mở khóa thêm 1 ô đất mới trong Khu vườn bằng Điểm yêu thương (tối đa 54 ô).
 * @param {Object} userProfile
 */
export async function unlockNextGardenPlot(userProfile) {
  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  const txId = `plot_${Date.now()}_${userProfile.uid.slice(0, 5)}`;
  const txRef = doc(db, 'transactions', txId);

  return runTransaction(db, async (tx) => {
    const worldSnap = await tx.get(worldRef);
    if (!worldSnap.exists()) throw new Error('Không tìm thấy dữ liệu đảo.');

    const worldData = worldSnap.data();
    const garden = getNormalizedGarden(worldData);

    if (garden.unlockedCount >= MAX_GARDEN_PLOTS) {
      throw new Error(`Khu vườn đã mở tối đa ${MAX_GARDEN_PLOTS}/${MAX_GARDEN_PLOTS} ô đất rồi!`);
    }

    const cost = getNextPlotUnlockCost(garden.unlockedCount);
    const currentPoints = Number(worldData.lovePoints || 0);

    if (currentPoints < cost) {
      throw new Error(`Chưa đủ điểm để mở ô đất #${garden.unlockedCount + 1}! Cần ${cost} ❤️ (hiện có ${currentPoints} ❤️).`);
    }

    const nextUnlocked = garden.unlockedCount + 1;
    const newBalance = currentPoints - cost;

    tx.set(txRef, {
      txId,
      worldId: SHARED_WORLD_ID,
      type: 'spend',
      source: 'garden_unlock',
      amount: cost,
      balanceAfter: newBalance,
      description: `Mở ô đất khu vườn #${nextUnlocked}/${MAX_GARDEN_PLOTS}`,
      actorUid: userProfile.uid,
      actorName: userProfile.displayName,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    });

    tx.update(worldRef, {
      lovePoints: newBalance,
      lastTxId: txId,
      'garden.unlockedCount': nextUnlocked,
      'garden.plots': garden.plots,
      updatedAt: serverTimestamp()
    });

    return {
      unlockedCount: nextUnlocked,
      cost,
      newBalance
    };
  });
}

/**
 * Gieo hạt giống từ Túi đồ chung lên 1 ô đất trống đã mở khóa.
 */
export async function plantSeedInGarden({ plotIndex, seedId, userProfile }) {
  const seed = getSeedInfo(seedId);
  if (!seed) throw new Error('Loại hạt giống không hợp lệ.');

  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  const invRef = doc(db, 'inventory', SHARED_WORLD_ID);

  return runTransaction(db, async (tx) => {
    const [worldSnap, invSnap] = await Promise.all([
      tx.get(worldRef),
      tx.get(invRef)
    ]);

    if (!worldSnap.exists()) throw new Error('Không tìm thấy dữ liệu đảo.');
    const garden = getNormalizedGarden(worldSnap.data());

    if (plotIndex < 0 || plotIndex >= garden.unlockedCount) {
      throw new Error('Ô đất này chưa được mở khóa.');
    }

    const existingPlot = garden.plots[String(plotIndex)];
    if (existingPlot && existingPlot.seedId) {
      throw new Error('Ô đất này đang có cây trồng rồi!');
    }

    const invData = invSnap.exists() ? invSnap.data() : { seeds: {}, decor: {} };
    const seeds = { ...(invData.seeds || {}) };
    const available = Number(seeds[seedId] || 0);

    if (available < 1) {
      throw new Error(`Trong túi đã hết ${seed.name}! Hãy ghé Cửa hàng mua thêm hạt giống nhé.`);
    }

    seeds[seedId] = available - 1;
    const updatedPlots = {
      ...garden.plots,
      [String(plotIndex)]: {
        seedId,
        plantedAtMs: Date.now(),
        watered: false,
        plantedBy: userProfile.displayName
      }
    };

    if (invSnap.exists()) {
      tx.update(invRef, { seeds, updatedAt: serverTimestamp() });
    } else {
      tx.set(invRef, { worldId: SHARED_WORLD_ID, seeds, decor: {}, updatedAt: serverTimestamp() });
    }

    tx.update(worldRef, {
      'garden.unlockedCount': garden.unlockedCount,
      'garden.plots': updatedPlots,
      updatedAt: serverTimestamp()
    });

    return seed;
  });
}

/**
 * Tưới nước cho ô đất đang trồng cây (rút ngắn 25% thời gian chín).
 */
export async function waterGardenPlot(plotIndex) {
  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);

  return runTransaction(db, async (tx) => {
    const worldSnap = await tx.get(worldRef);
    if (!worldSnap.exists()) throw new Error('Không tìm thấy dữ liệu đảo.');

    const garden = getNormalizedGarden(worldSnap.data());
    const key = String(plotIndex);
    const plot = garden.plots[key];

    if (!plot || !plot.seedId) {
      throw new Error('Ô đất này chưa gieo hạt.');
    }

    if (plot.watered) {
      return { alreadyWatered: true };
    }

    const updatedPlots = {
      ...garden.plots,
      [key]: {
        ...plot,
        watered: true,
        wateredAtMs: Date.now()
      }
    };

    tx.update(worldRef, {
      'garden.unlockedCount': garden.unlockedCount,
      'garden.plots': updatedPlots,
      updatedAt: serverTimestamp()
    });

    return { alreadyWatered: false };
  });
}

/**
 * Thu hoạch cây đã chín trên ô đất -> Cộng Điểm yêu thương & lưu lịch sử giao dịch.
 */
export async function harvestGardenPlot({ plotIndex, userProfile }) {
  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  const txId = `harvest_${Date.now()}_${plotIndex}_${userProfile.uid.slice(0, 4)}`;
  const txRef = doc(db, 'transactions', txId);

  return runTransaction(db, async (tx) => {
    const worldSnap = await tx.get(worldRef);
    if (!worldSnap.exists()) throw new Error('Không tìm thấy dữ liệu đảo.');

    const worldData = worldSnap.data();
    const garden = getNormalizedGarden(worldData);
    const key = String(plotIndex);
    const plot = garden.plots[key];

    const cropState = evaluatePlotCrop(plot, Date.now());
    if (cropState.status !== 'ripe') {
      throw new Error('Cây chưa chín hẳn, đợi thêm chút xíu nữa nhé!');
    }

    const reward = cropState.seed.harvestReward;
    const currentPoints = Number(worldData.lovePoints || 0);
    const newBalance = currentPoints + reward;

    const updatedPlots = { ...garden.plots };
    delete updatedPlots[key];

    tx.set(txRef, {
      txId,
      worldId: SHARED_WORLD_ID,
      type: 'earn',
      source: 'harvest',
      amount: reward,
      balanceAfter: newBalance,
      description: `Thu hoạch ${cropState.seed.name} (Ô #${plotIndex + 1})`,
      actorUid: userProfile.uid,
      actorName: userProfile.displayName,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    });

    tx.update(worldRef, {
      lovePoints: newBalance,
      lastTxId: txId,
      'garden.unlockedCount': garden.unlockedCount,
      'garden.plots': updatedPlots,
      updatedAt: serverTimestamp()
    });

    return {
      seed: cropState.seed,
      reward,
      newBalance
    };
  });
}

/* ==========================================================================
   Vẽ Map 2D Riêng Của Khu Vườn (54 Ô Đất) Lên Canvas
   ========================================================================== */
export function drawGardenMap(ctx, timeSec, worldData, isNearExit) {
  const garden = getNormalizedGarden(worldData);
  const nowMs = Date.now();

  // 1. Nền đồng cỏ xanh tươi của Khu vườn
  ctx.fillStyle = '#d8f3dc';
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  ctx.fillStyle = '#e9f9ec';
  ctx.beginPath();
  ctx.roundRect(40, 34, MAP_WIDTH - 80, MAP_HEIGHT - 68, 36);
  ctx.fill();

  // Hàng rào gỗ bao quanh nông trại
  ctx.strokeStyle = '#d4a373';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(44, 38, MAP_WIDTH - 88, MAP_HEIGHT - 76, 32);
  ctx.stroke();

  // 2. Cổng gỗ phía Bắc quay ra Đảo Chính
  ctx.fillStyle = isNearExit ? '#ff8fab' : '#fff9ec';
  ctx.strokeStyle = isNearExit ? '#ffffff' : '#d4a373';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(406, 26, 148, 38, 19);
  ctx.fill();
  ctx.stroke();

  ctx.font = '800 12.5px Nunito, sans-serif';
  ctx.fillStyle = isNearExit ? '#ffffff' : '#5c4b40';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isNearExit ? '[E] 🏝️ Về Đảo Chính' : '⬆️ Lối ra Đảo Chính', 480, 45);

  // Thống kê số ô đất ở góc trái trên sân vườn
  ctx.fillStyle = 'rgba(255, 253, 248, 0.9)';
  ctx.strokeStyle = '#b7e4c7';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(62, 54, 196, 30, 15);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2d6a4f';
  ctx.font = '800 12px Nunito, sans-serif';
  ctx.fillText(`🌻 Ô đất đã mở: ${garden.unlockedCount}/${MAX_GARDEN_PLOTS}`, 160, 69);

  // Giếng nước trang trí bên trái
  ctx.fillStyle = '#d4a373';
  ctx.beginPath();
  ctx.arc(88, 290, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#90e0ef';
  ctx.beginPath();
  ctx.arc(88, 290, 15, 0, Math.PI * 2);
  ctx.fill();

  // 3. Lưới 54 ô đất (9 cột x 6 hàng)
  for (let i = 0; i < MAX_GARDEN_PLOTS; i++) {
    const r = getPlotRect(i);
    const isUnlocked = i < garden.unlockedCount;
    const isNextUnlock = i === garden.unlockedCount;

    if (isUnlocked) {
      const plotData = garden.plots[String(i)];
      const crop = evaluatePlotCrop(plotData, nowMs);

      // Màu đất (ẩm đậm hơn nếu đã tưới nước)
      ctx.fillStyle = crop.watered ? '#a47551' : '#cfa782';
      ctx.strokeStyle = crop.status === 'ripe' ? '#ff8fab' : '#b08968';
      ctx.lineWidth = crop.status === 'ripe' ? 2.6 : 1.8;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 10);
      ctx.fill();
      ctx.stroke();

      // Rãnh đất cày nhẹ khi ô trống
      if (crop.status === 'empty') {
        ctx.strokeStyle = 'rgba(127, 85, 57, 0.28)';
        ctx.lineWidth = 1.5;
        for (let rowLine = 1; rowLine <= 2; rowLine++) {
          const ly = r.y + (r.h / 3) * rowLine;
          ctx.beginPath();
          ctx.moveTo(r.x + 10, ly);
          ctx.lineTo(r.x + r.w - 10, ly);
          ctx.stroke();
        }
      } else if (crop.status === 'growing') {
        const sway = Math.sin(timeSec * 3 + i) * 1.5;
        // Mầm non hoặc cây đang lớn
        ctx.font = crop.progress < 0.45 ? '18px sans-serif' : '21px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(crop.progress < 0.45 ? '🌱' : '🌿', r.cx + sway, r.cy - 5);

        // Nhãn thời gian còn lại + trạng thái tưới
        ctx.font = '800 10px Nunito, sans-serif';
        ctx.fillStyle = '#fffdf8';
        const timeTxt = crop.remainSec >= 60
          ? `${Math.ceil(crop.remainSec / 60)}p`
          : `${crop.remainSec}s`;
        ctx.fillText(`${crop.watered ? '💧' : '☀️'} ${timeTxt}`, r.cx, r.y + r.h - 10);
      } else if (crop.status === 'ripe') {
        // Cây đã chín rực rỡ
        const bounce = Math.sin(timeSec * 4 + i) * 2.5;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.arc(r.cx, r.cy - 3, 17, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(crop.seed.icon, r.cx, r.cy - 4 + bounce);

        ctx.font = '800 9.5px Nunito, sans-serif';
        ctx.fillStyle = '#fffdf8';
        ctx.fillText(`Thu +${crop.seed.harvestReward}❤️`, r.cx, r.y + r.h - 9);
      }
    } else {
      // Ô đất đang khóa (từ ô 7 -> 54)
      ctx.fillStyle = isNextUnlock ? '#fff0f5' : 'rgba(204, 235, 211, 0.65)';
      ctx.strokeStyle = isNextUnlock ? '#ff8fab' : '#b7e4c7';
      ctx.lineWidth = isNextUnlock ? 2.2 : 1.3;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 10);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (isNextUnlock) {
        const nextCost = getNextPlotUnlockCost(garden.unlockedCount);
        ctx.font = '800 10.5px Nunito, sans-serif';
        ctx.fillStyle = '#d94d72';
        ctx.fillText(`🔓 Mở #${i + 1}`, r.cx, r.cy - 7);
        ctx.fillText(`${nextCost} ❤️`, r.cx, r.cy + 8);
      } else {
        ctx.font = '700 10px Nunito, sans-serif';
        ctx.fillStyle = '#74a887';
        ctx.fillText(`🔒 #${i + 1}`, r.cx, r.cy);
      }
    }
  }
}

