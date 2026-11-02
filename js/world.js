/**
 * CTISLAND - Hệ Thống Đa Bản Đồ 2D (Multi-Map System) & Đồng Bộ Đảo Chung (world.js)
 * 5 Bản đồ riêng biệt:
 * - `island`: Đảo Chính trung tâm dẫn vào các khu
 * - `house` : Map bên trong Khu Nhà Chung (Trang trí & Nâng cấp nhà)
 * - `garden`: Map Khu Vườn Nông Trại (6 ô sẵn có, mở tối đa 54 ô đất)
 * - `pet`   : Map Sân Chơi Thú Cưng (Vui chơi tối đa 10 bé thú cưng)
 * - `shop`  : Map Cửa Hàng Đảo (Vật phẩm trang trí & Hạt giống)
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

export const SHARED_WORLD_ID = 'ctisland_main';
const DEFAULT_WORLD_NAME = 'Đảo nhà Thùy';

export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 560;

export const MAP_METADATA = {
  island: { id: 'island', name: 'Đảo Chính', icon: '🏝️' },
  house: { id: 'house', name: 'Nhà Chung', icon: '🏡' },
  garden: { id: 'garden', name: 'Khu Vườn', icon: '🌻' },
  pet: { id: 'pet', name: 'Khu Thú Cưng', icon: '🐾' },
  shop: { id: 'shop', name: 'Cửa Hàng', icon: '🏪' }
};

/** Điểm đứng trên Đảo Chính khi bước từ từng khu con trở ra */
export const ISLAND_RETURN_SPAWNS = {
  default: { x: 480, y: 244 },
  house: { x: 480, y: 218 },
  garden: { x: 256, y: 348 },
  pet: { x: 702, y: 348 },
  shop: { x: 748, y: 228 }
};

export const DEFAULT_SPAWN = ISLAND_RETURN_SPAWNS.default;

/** Ranh giới mặt đất trên Đảo Chính */
export const ISLAND_BOUNDS = {
  minX: 88,
  maxX: 872,
  minY: 78,
  maxY: 492
};

/** Các cổng khu vực trên Đảo Chính (đi vào sẽ chuyển sang Map riêng của khu đó) */
export const ISLAND_ZONES = [
  {
    id: 'house',
    targetMap: 'house',
    name: 'Khu Nhà Chung',
    icon: '🏡',
    x: 480,
    y: 204,
    radius: 48,
    labelX: 480,
    labelY: 68
  },
  {
    id: 'quest',
    targetMap: null,
    name: 'Bảng Nhiệm Vụ',
    icon: '📋',
    x: 330,
    y: 244,
    radius: 46,
    labelX: 330,
    labelY: 184
  },
  {
    id: 'memory',
    targetMap: null,
    name: 'Cây Kỷ Niệm',
    icon: '💌',
    x: 616,
    y: 242,
    radius: 46,
    labelX: 616,
    labelY: 174
  },
  {
    id: 'shop',
    targetMap: 'shop',
    name: 'Cửa Hàng Đảo',
    icon: '🏪',
    x: 754,
    y: 214,
    radius: 50,
    labelX: 754,
    labelY: 88
  },
  {
    id: 'garden',
    targetMap: 'garden',
    name: 'Khu Vườn (54 Ô)',
    icon: '🌻',
    x: 220,
    y: 386,
    radius: 72,
    labelX: 220,
    labelY: 304
  },
  {
    id: 'pet',
    targetMap: 'pet',
    name: 'Khu Thú Cưng',
    icon: '🐾',
    x: 736,
    y: 390,
    radius: 72,
    labelX: 736,
    labelY: 304
  }
];

/** Khu tương tác bên trong Map Cửa Hàng */
export const SHOP_MAP_ZONES = [
  {
    id: 'shop_counter',
    targetMap: null,
    name: 'Quầy Mua Hàng & Hạt Giống',
    icon: '🛍️',
    x: 480,
    y: 235,
    radius: 62
  },
  {
    id: 'exit_to_island',
    targetMap: 'island',
    name: 'Ra Đảo Chính',
    icon: '🏝️',
    x: 480,
    y: 446,
    radius: 42
  }
];

export const SHOP_SPAWN = { x: 480, y: 392 };

const SOLID_RECTS_ISLAND = [
  { x: 408, y: 92, w: 144, h: 92 },
  { x: 308, y: 204, w: 44, h: 26 },
  { x: 606, y: 214, w: 20, h: 18 },
  { x: 692, y: 112, w: 124, h: 82 },
  { x: 764, y: 332, w: 56, h: 42 },
  { x: 124, y: 326, w: 30, h: 28 }
];

export const ISLAND_TREES = [
  { x: 156, y: 136, trunkR: 13, canopyR: 28 },
  { x: 248, y: 108, trunkR: 11, canopyR: 23 },
  { x: 610, y: 112, trunkR: 11, canopyR: 24 },
  { x: 838, y: 264, trunkR: 12, canopyR: 26 },
  { x: 122, y: 256, trunkR: 12, canopyR: 25 },
  { x: 480, y: 462, trunkR: 12, canopyR: 25 }
];

const FLOWER_TUFTS = [
  { x: 374, y: 168, color: '#ff8fab' },
  { x: 586, y: 170, color: '#ffb3c6' },
  { x: 205, y: 215, color: '#ffd166' },
  { x: 632, y: 245, color: '#ff8fab' },
  { x: 390, y: 375, color: '#cdb4db' },
  { x: 568, y: 392, color: '#ffb3c6' }
];

/**
 * Kiểm tra va chạm trên Đảo Chính.
 */
export function isIslandPositionBlocked(x, y, radius = 14) {
  if (
    x - radius < ISLAND_BOUNDS.minX ||
    x + radius > ISLAND_BOUNDS.maxX ||
    y - radius < ISLAND_BOUNDS.minY ||
    y + radius > ISLAND_BOUNDS.maxY
  ) {
    return true;
  }

  const cornerInset = 56;
  const corners = [
    { cx: ISLAND_BOUNDS.minX + cornerInset, cy: ISLAND_BOUNDS.minY + cornerInset, dx: -1, dy: -1 },
    { cx: ISLAND_BOUNDS.maxX - cornerInset, cy: ISLAND_BOUNDS.minY + cornerInset, dx: 1, dy: -1 },
    { cx: ISLAND_BOUNDS.minX + cornerInset, cy: ISLAND_BOUNDS.maxY - cornerInset, dx: -1, dy: 1 },
    { cx: ISLAND_BOUNDS.maxX - cornerInset, cy: ISLAND_BOUNDS.maxY - cornerInset, dx: 1, dy: 1 }
  ];
  for (const c of corners) {
    if ((x - c.cx) * c.dx > 0 && (y - c.cy) * c.dy > 0) {
      if (Math.hypot(x - c.cx, y - c.cy) + radius > cornerInset) return true;
    }
  }

  for (const rect of SOLID_RECTS_ISLAND) {
    const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
    const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
    if (Math.hypot(x - nearestX, y - nearestY) < radius) return true;
  }

  for (const tree of ISLAND_TREES) {
    if (Math.hypot(x - tree.x, y - tree.y) < radius + tree.trunkR) return true;
  }

  return false;
}

/**
 * Kiểm tra va chạm cho các khu ngoài trời mở (Khu vườn & Khu thú cưng).
 */
export function isOutdoorSubmapBlocked(x, y, radius = 14) {
  return x - radius < 58 || x + radius > MAP_WIDTH - 58 || y - radius < 52 || y + radius > MAP_HEIGHT - 52;
}

/**
 * Kiểm tra va chạm bên trong Map Cửa Hàng.
 */
export function isShopPositionBlocked(x, y, radius = 14) {
  if (x - radius < 185 || x + radius > 775 || y - radius < 150 || y + radius > 462) {
    return true;
  }
  // Quầy thu ngân giữa phòng
  const counter = { x: 380, y: 155, w: 200, h: 52 };
  const nx = Math.max(counter.x, Math.min(x, counter.x + counter.w));
  const ny = Math.max(counter.y, Math.min(y, counter.y + counter.h));
  if (Math.hypot(x - nx, y - ny) < radius) return true;
  return false;
}

/* ==========================================================================
   Vẽ Map Đảo Chính & Map Bên Trong Cửa Hàng
   ========================================================================== */
function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function drawIslandWorld(ctx, timeSec, activeZoneId) {
  const waterGrad = ctx.createLinearGradient(0, 0, 0, MAP_HEIGHT);
  waterGrad.addColorStop(0, '#cfeff5');
  waterGrad.addColorStop(1, '#bce7f0');
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  const waves = [
    { x: 36, y: 55 }, { x: 885, y: 74 }, { x: 30, y: 480 },
    { x: 892, y: 495 }, { x: 470, y: 26 }, { x: 485, y: 538 }
  ];
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const shift = Math.sin(timeSec * 1.6 + i) * 6;
    ctx.beginPath();
    ctx.moveTo(w.x + shift, w.y);
    ctx.quadraticCurveTo(w.x + 14 + shift, w.y - 4, w.x + 28 + shift, w.y);
    ctx.stroke();
  }

  const foamPulse = Math.sin(timeSec * 2) * 2.5;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  drawRoundedRect(ctx, 58 - foamPulse, 46 - foamPulse, 844 + foamPulse * 2, 468 + foamPulse * 2, 82);
  ctx.fill();

  ctx.fillStyle = '#faedcd';
  drawRoundedRect(ctx, 66, 54, 828, 452, 76);
  ctx.fill();

  ctx.fillStyle = '#dff5e3';
  drawRoundedRect(ctx, 82, 68, 796, 424, 64);
  ctx.fill();

  ctx.fillStyle = '#d0f0d6';
  ctx.beginPath();
  ctx.ellipse(240, 175, 95, 52, 0, 0, Math.PI * 2);
  ctx.ellipse(735, 280, 82, 44, 0, 0, Math.PI * 2);
  ctx.ellipse(480, 415, 110, 45, 0, 0, Math.PI * 2);
  ctx.fill();

  // Đường đá nối các cổng khu vực
  ctx.strokeStyle = '#f5e6cc';
  ctx.lineWidth = 34;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(480, 190);
  ctx.lineTo(480, 292);
  ctx.lineTo(330, 262);
  ctx.lineTo(255, 338);
  ctx.moveTo(480, 292);
  ctx.lineTo(665, 244);
  ctx.lineTo(754, 208);
  ctx.moveTo(640, 252);
  ctx.lineTo(695, 342);
  ctx.stroke();

  ctx.strokeStyle = '#fff9ec';
  ctx.lineWidth = 26;
  ctx.stroke();

  ctx.fillStyle = '#fff9ec';
  ctx.strokeStyle = '#ebd9be';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(480, 292, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawMiniHeart(ctx, 480, 292, 11, '#ffb3c6');

  drawGardenPortalPreview(ctx, timeSec, activeZoneId === 'garden');
  drawPetPortalPreview(ctx, timeSec, activeZoneId === 'pet');
  drawSharedHouseExterior(ctx, timeSec, activeZoneId === 'house');
  drawQuestBoard(ctx, activeZoneId === 'quest');
  drawMemoryWishTree(ctx, timeSec, activeZoneId === 'memory');
  drawIslandShopExterior(ctx, activeZoneId === 'shop');

  for (let i = 0; i < FLOWER_TUFTS.length; i++) {
    const f = FLOWER_TUFTS[i];
    const sway = Math.sin(timeSec * 2.5 + i) * 1.8;
    ctx.fillStyle = '#80ed99';
    ctx.fillRect(f.x - 1, f.y, 2, 6);
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(f.x + sway, f.y - 1, 4.2, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const tree of ISLAND_TREES) {
    drawCuteTree(ctx, tree.x, tree.y, tree.canopyR);
  }
}

export function drawZoneLabels(ctx, activeZoneId, timeSec) {
  for (const zone of ISLAND_ZONES) {
    const isNear = zone.id === activeZoneId;
    const floatY = isNear ? Math.sin(timeSec * 4) * 3 : 0;
    const prefix = isNear ? (zone.targetMap ? '[E] Vào ' : '[E] ') : '';
    const text = `${prefix}${zone.icon} ${zone.name}`;

    ctx.font = isNear ? '800 13px Nunito, sans-serif' : '700 11.5px Nunito, sans-serif';
    const textWidth = ctx.measureText(text).width;
    const padX = isNear ? 12 : 9;
    const boxW = textWidth + padX * 2;
    const boxH = isNear ? 26 : 22;
    const bx = zone.labelX - boxW / 2;
    const by = zone.labelY - boxH / 2 + floatY;

    ctx.fillStyle = isNear ? '#ff8fab' : 'rgba(255, 253, 248, 0.9)';
    ctx.strokeStyle = isNear ? '#ffffff' : '#ebd9be';
    ctx.lineWidth = isNear ? 2 : 1.5;
    drawRoundedRect(ctx, bx, by, boxW, boxH, 999);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isNear ? '#ffffff' : '#5c4b40';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, zone.labelX, by + boxH / 2 + 0.5);
  }
}

/**
 * Vẽ Map riêng bên trong Cửa Hàng Đảo (Quầy hạt giống & Vật phẩm trang trí).
 */
export function drawShopInteriorMap(ctx, timeSec, activeZoneId) {
  ctx.fillStyle = '#3b2e28';
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  const rx = 175;
  const ry = 136;
  const rw = 610;
  const rh = 336;

  // Tường hồng kem của cửa hàng
  ctx.fillStyle = '#fff0f5';
  ctx.strokeStyle = '#f3c6d3';
  ctx.lineWidth = 4;
  drawRoundedRect(ctx, rx, ry - 54, rw, 64, [16, 16, 0, 0]);
  ctx.fill();
  ctx.stroke();

  // Biển hiệu cửa hàng trên tường
  ctx.fillStyle = '#ff8fab';
  drawRoundedRect(ctx, 370, ry - 42, 220, 34, 17);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 13.5px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🏪 TIỆM TẠP HÓA CTISLAND', 480, ry - 25);

  // Sàn gỗ cửa hàng
  ctx.fillStyle = '#fdf3e4';
  ctx.strokeStyle = '#d4b595';
  ctx.lineWidth = 5;
  drawRoundedRect(ctx, rx, ry, rw, rh, [0, 0, 16, 16]);
  ctx.fill();
  ctx.stroke();

  // Kệ Hạt giống bên trái
  ctx.fillStyle = '#e9f7ef';
  ctx.strokeStyle = '#95d5b2';
  ctx.lineWidth = 2.5;
  drawRoundedRect(ctx, 205, 195, 108, 170, 12);
  ctx.fill();
  ctx.stroke();
  ctx.font = '21px sans-serif';
  ctx.fillText('🍀 🌼 🍓', 259, 245);
  ctx.fillText('🌻 🌹 🌱', 259, 295);
  ctx.font = '800 11px Nunito, sans-serif';
  ctx.fillStyle = '#2d6a4f';
  ctx.fillText('Kệ Hạt Giống', 259, 342);

  // Kệ Nội thất & Trang phục bên phải
  ctx.fillStyle = '#fff5f8';
  ctx.strokeStyle = '#ffc2d1';
  ctx.lineWidth = 2.5;
  drawRoundedRect(ctx, 647, 195, 108, 170, 12);
  ctx.fill();
  ctx.stroke();
  ctx.font = '20px sans-serif';
  ctx.fillText('🛋️ 🛏️ 🎨', 701, 242);
  ctx.fillText('👗 👑 🎀', 701, 292);
  ctx.font = '800 10.5px Nunito, sans-serif';
  ctx.fillStyle = '#d94d72';
  ctx.fillText('Đồ Đôi & Nội Thất', 701, 342);

  // Quầy mua hàng ở trung tâm
  const nearCounter = activeZoneId === 'shop_counter';
  ctx.fillStyle = '#faedcd';
  ctx.strokeStyle = nearCounter ? '#ff8fab' : '#c68b59';
  ctx.lineWidth = nearCounter ? 3.5 : 2.5;
  drawRoundedRect(ctx, 380, 158, 200, 50, 12);
  ctx.fill();
  ctx.stroke();

  ctx.font = '800 12px Nunito, sans-serif';
  ctx.fillStyle = nearCounter ? '#d94d72' : '#5c4b40';
  ctx.fillText(
    nearCounter ? '[E / Chạm] 🛍️ Xem Vật Phẩm & Hạt Giống' : '🛍️ Quầy Mua Hàng',
    480,
    183 + Math.sin(timeSec * 3) * (nearCounter ? 2 : 0)
  );

  // Thảm cửa ra Đảo Chính
  const nearExit = activeZoneId === 'exit_to_island';
  ctx.fillStyle = nearExit ? '#ff8fab' : '#ffc2d1';
  drawRoundedRect(ctx, 424, 440, 112, 26, 10);
  ctx.fill();
  ctx.font = '800 11.5px Nunito, sans-serif';
  ctx.fillStyle = nearExit ? '#ffffff' : '#6d3b4e';
  ctx.fillText(nearExit ? '[E] Ra Đảo Chính' : '⬇️ Cửa ra Đảo', 480, 453);
}

function drawMiniHeart(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.55);
  ctx.bezierCurveTo(cx - size, cy - size * 0.1, cx - size * 0.9, cy - size * 0.85, cx, cy - size * 0.3);
  ctx.bezierCurveTo(cx + size * 0.9, cy - size * 0.85, cx + size, cy - size * 0.1, cx, cy + size * 0.55);
  ctx.fill();
  ctx.restore();
}

function drawSharedHouseExterior(ctx, timeSec, highlight) {
  const x = 404;
  const y = 84;
  const w = 152;
  const h = 100;

  if (highlight) {
    ctx.strokeStyle = 'rgba(255, 143, 171, 0.75)';
    ctx.lineWidth = 4;
    drawRoundedRect(ctx, x - 8, y - 16, w + 16, h + 30, 18);
    ctx.stroke();
  }

  ctx.fillStyle = '#e5b8b7';
  ctx.fillRect(522, 68, 14, 24);
  const puff = (timeSec * 0.5) % 1;
  ctx.fillStyle = `rgba(255, 255, 255, ${(1 - puff) * 0.7})`;
  ctx.beginPath();
  ctx.arc(529 + puff * 8, 63 - puff * 18, 5 + puff * 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fffdf7';
  ctx.strokeStyle = '#e2cfc0';
  ctx.lineWidth = 2.5;
  drawRoundedRect(ctx, x, y + 26, w, h - 26, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffcad4';
  ctx.strokeStyle = '#f4978e';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(x - 12, y + 34);
  ctx.lineTo(480, y - 10);
  ctx.lineTo(x + w + 12, y + 34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  drawMiniHeart(ctx, 480, y + 15, 9, '#ff8fab');

  ctx.fillStyle = highlight ? '#ff8fab' : '#ffc2d1';
  drawRoundedRect(ctx, 460, 185, 40, 12, 6);
  ctx.fill();

  ctx.fillStyle = '#faedcd';
  ctx.strokeStyle = '#d4a373';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 466, 142, 28, 42, 6);
  ctx.fill();
  ctx.stroke();

  for (const wx of [422, 512]) {
    ctx.fillStyle = '#e0fbfc';
    ctx.strokeStyle = '#98c1d9';
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, wx, 134, 26, 24, 5);
    ctx.fill();
    ctx.stroke();
  }
}

function drawQuestBoard(ctx, highlight) {
  const x = 306;
  const y = 198;
  if (highlight) {
    ctx.fillStyle = 'rgba(255, 143, 171, 0.22)';
    ctx.beginPath();
    ctx.arc(330, 232, 34, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#b08968';
  ctx.fillRect(x + 8, y + 24, 6, 16);
  ctx.fillRect(x + 34, y + 24, 6, 16);

  ctx.fillStyle = '#faedcd';
  ctx.strokeStyle = '#c68b59';
  ctx.lineWidth = 2.5;
  drawRoundedRect(ctx, x, y, 48, 30, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffe5ec';
  ctx.fillRect(x + 7, y + 7, 14, 16);
  ctx.fillStyle = '#d8f3dc';
  ctx.fillRect(x + 26, y + 7, 14, 16);
}

function drawMemoryWishTree(ctx, timeSec, highlight) {
  const x = 616;
  const y = 224;

  if (highlight) {
    ctx.fillStyle = 'rgba(255, 143, 171, 0.24)';
    ctx.beginPath();
    ctx.arc(x, y + 8, 36, 0, Math.PI * 2);
    ctx.fill();
  }

  // Thân cây đào ước nguyện
  ctx.fillStyle = '#a47551';
  drawRoundedRect(ctx, x - 6, y - 4, 12, 26, 4);
  ctx.fill();

  // Tán hoa anh đào hồng pastel bồng bềnh
  ctx.fillStyle = '#ffb3c6';
  ctx.beginPath();
  ctx.arc(x - 13, y - 14, 16, 0, Math.PI * 2);
  ctx.arc(x + 13, y - 14, 16, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffc8dd';
  ctx.beginPath();
  ctx.arc(x, y - 22, 19, 0, Math.PI * 2);
  ctx.fill();

  // Thẻ điều ước lắc lư nhẹ theo gió
  const sway = Math.sin(timeSec * 2.8) * 2;
  ctx.fillStyle = '#fffdf7';
  ctx.strokeStyle = '#ff8fab';
  ctx.lineWidth = 1.2;
  drawRoundedRect(ctx, x - 14 + sway, y - 6, 7, 11, 2);
  ctx.fill();
  ctx.stroke();
  drawRoundedRect(ctx, x + 7 - sway, y - 5, 7, 11, 2);
  ctx.fill();
  ctx.stroke();
}

function drawIslandShopExterior(ctx, highlight) {
  const x = 692;
  const y = 108;
  const w = 124;
  const h = 84;

  if (highlight) {
    ctx.strokeStyle = 'rgba(255, 143, 171, 0.75)';
    ctx.lineWidth = 4;
    drawRoundedRect(ctx, x - 6, y - 6, w + 12, h + 14, 16);
    ctx.stroke();
  }

  ctx.fillStyle = '#fffdf7';
  ctx.strokeStyle = '#ddb892';
  ctx.lineWidth = 2.5;
  drawRoundedRect(ctx, x + 4, y + 24, w - 8, h - 24, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#faedcd';
  ctx.fillRect(x + 10, y + 54, w - 20, 12);

  const stripes = 6;
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#ff9ebb' : '#fffdf7';
    drawRoundedRect(ctx, x + i * sw, y, sw + 1, 28, 6);
    ctx.fill();
  }
  ctx.strokeStyle = '#f26a8d';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, x, y, w, 28, 6);
  ctx.stroke();
}

function drawGardenPortalPreview(ctx, timeSec, highlight) {
  const gx = 122;
  const gy = 324;
  const gw = 196;
  const gh = 124;

  ctx.fillStyle = '#ccebd3';
  ctx.strokeStyle = highlight ? '#52b788' : '#a8dabb';
  ctx.lineWidth = highlight ? 3.5 : 2;
  drawRoundedRect(ctx, gx, gy, gw, gh, 20);
  ctx.fill();
  ctx.stroke();

  const plots = [{ x: 158, y: 342 }, { x: 234, y: 342 }, { x: 158, y: 394 }, { x: 234, y: 394 }];
  for (let i = 0; i < plots.length; i++) {
    const p = plots[i];
    ctx.fillStyle = '#c89f78';
    drawRoundedRect(ctx, p.x, p.y, 62, 36, 8);
    ctx.fill();
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(i % 2 === 0 ? '🌻' : '🍓', p.x + 31, p.y + 22 + Math.sin(timeSec * 3 + i) * 1.5);
  }
}

function drawPetPortalPreview(ctx, timeSec, highlight) {
  const px = 644;
  const py = 324;
  const pw = 192;
  const ph = 124;

  ctx.fillStyle = '#fef6e4';
  ctx.strokeStyle = highlight ? '#ff8fab' : '#eddac0';
  ctx.lineWidth = highlight ? 3.5 : 2.5;
  drawRoundedRect(ctx, px, py, pw, ph, 22);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#fffdf7';
  ctx.strokeStyle = '#ddb892';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 766, 344, 52, 34, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffc2d1';
  ctx.beginPath();
  ctx.moveTo(760, 348);
  ctx.lineTo(792, 328);
  ctx.lineTo(824, 348);
  ctx.closePath();
  ctx.fill();

  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🐱', 696, 384 + Math.abs(Math.sin(timeSec * 3)) * -4);
  ctx.fillText('🐶', 736, 412 + Math.abs(Math.cos(timeSec * 3)) * -4);
}

function drawCuteTree(ctx, x, y, r) {
  ctx.fillStyle = 'rgba(74, 59, 50, 0.1)';
  ctx.beginPath();
  ctx.ellipse(x, y + 8, r * 0.85, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#b08968';
  drawRoundedRect(ctx, x - 5, y - 8, 10, 18, 4);
  ctx.fill();

  ctx.fillStyle = '#74c69d';
  ctx.beginPath();
  ctx.arc(x - r * 0.32, y - r * 0.55, r * 0.72, 0, Math.PI * 2);
  ctx.arc(x + r * 0.32, y - r * 0.55, r * 0.72, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#95d5b2';
  ctx.beginPath();
  ctx.arc(x, y - r * 0.85, r * 0.88, 0, Math.PI * 2);
  ctx.fill();
}

/* ==========================================================================
   Đồng bộ Firestore cho Hòn Đảo Chung
   ========================================================================== */
export async function ensureSharedWorldAccess(userProfile) {
  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);

  const initialSnap = await getDoc(worldRef);
  if (initialSnap.exists()) {
    const data = initialSnap.data();
    const memberIds = Array.isArray(data.memberIds) ? data.memberIds : [];

    if (memberIds.includes(userProfile.uid)) {
      return data;
    }

    if (memberIds.length >= 2) {
      const err = new Error('Hòn đảo CTISLAND đã đủ 2 chủ nhân, tài khoản thứ ba không thể truy cập!');
      err.code = 'island-full';
      throw err;
    }
  }

  await runTransaction(db, async (transaction) => {
    const worldSnap = await transaction.get(worldRef);

    if (!worldSnap.exists()) {
      transaction.set(worldRef, {
        worldId: SHARED_WORLD_ID,
        worldName: DEFAULT_WORLD_NAME,
        createdBy: userProfile.uid,
        memberIds: [userProfile.uid],
        members: {
          [userProfile.uid]: {
            uid: userProfile.uid,
            displayName: userProfile.displayName,
            characterStyle: userProfile.characterStyle || 'mint',
            joinedAt: new Date().toISOString()
          }
        },
        lovePoints: 0,
        garden: {
          unlockedCount: 6,
          plots: {}
        },
        house: {
          level: 1,
          wallpaper: 'wall_cream',
          floor: 'floor_wood',
          placedItems: []
        },
        pets: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return;
    }

    const worldData = worldSnap.data();
    const memberIds = Array.isArray(worldData.memberIds) ? worldData.memberIds : [];

    if (memberIds.includes(userProfile.uid)) return;

    if (memberIds.length >= 2) {
      const err = new Error('Hòn đảo CTISLAND đã đủ 2 chủ nhân, tài khoản thứ ba không thể truy cập!');
      err.code = 'island-full';
      throw err;
    }

    transaction.update(worldRef, {
      memberIds: [...memberIds, userProfile.uid],
      members: {
        ...(worldData.members || {}),
        [userProfile.uid]: {
          uid: userProfile.uid,
          displayName: userProfile.displayName,
          characterStyle: userProfile.characterStyle || 'peach',
          joinedAt: new Date().toISOString()
        }
      },
      updatedAt: serverTimestamp()
    });
  });
}

export async function syncPlayerPositionToCloud(uid, state) {
  if (!uid || !navigator.onLine) return;
  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  await updateDoc(worldRef, {
    [`positions.${uid}`]: {
      mapId: state.mapId || 'island',
      x: Math.round(state.x),
      y: Math.round(state.y),
      dir: state.dir || 'down',
      displayName: state.displayName,
      characterStyle: state.characterStyle || 'mint',
      outfitId: state.outfitId || 'outfit_default',
      hatId: state.hatId || 'hat_none',
      chatText: state.chatText || '',
      chatAtMs: state.chatAtMs || 0,
      emote: state.emote || '',
      emoteAtMs: state.emoteAtMs || 0,
      online: state.online !== false,
      updatedAtMs: Date.now()
    }
  });
}

export async function renameWorld(newWorldName) {
  const cleanName = String(newWorldName || '').trim();
  if (cleanName.length < 2 || cleanName.length > 30) {
    throw new Error('Tên đảo cần từ 2 đến 30 ký tự.');
  }

  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  await updateDoc(worldRef, {
    worldName: cleanName,
    updatedAt: serverTimestamp()
  });
}

export function subscribeToSharedWorld(onData, onError) {
  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  return onSnapshot(
    worldRef,
    (snapshot) => {
      if (!snapshot.exists()) return;
      onData(snapshot.data());
    },
    (error) => onError?.(error)
  );
}
