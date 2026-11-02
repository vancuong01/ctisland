/**
 * CTISLAND - Động cơ Nhân vật 2D Đa Bản Đồ (Multi-Map Engine) cho PC & Điện thoại (player.js)
 * Hỗ trợ chuyển cảnh mượt giữa 5 Map riêng: Đảo Chính, Khu Nhà Chung, Khu Vườn, Khu Thú Cưng, Cửa Hàng.
 */

import {
  MAP_WIDTH,
  MAP_HEIGHT,
  ISLAND_RETURN_SPAWNS,
  ISLAND_ZONES,
  SHOP_MAP_ZONES,
  SHOP_SPAWN,
  isIslandPositionBlocked,
  isOutdoorSubmapBlocked,
  isShopPositionBlocked,
  drawIslandWorld,
  drawZoneLabels,
  drawShopInteriorMap,
  syncPlayerPositionToCloud
} from './world.js';
import {
  GARDEN_EXIT_PORTAL,
  GARDEN_SPAWN,
  findGardenPlotAt,
  drawGardenMap
} from './garden.js';
import {
  getHouseExitPortal,
  getHouseSpawn,
  isHousePositionBlocked,
  findPlacedFurnitureAt,
  movePlacedFurniture,
  drawHouseInteriorMap
} from './house.js';
import {
  PET_EXIT_PORTAL,
  PET_SPAWN,
  findTappedPetOnCanvas,
  drawPetPlaygroundMap
} from './pet.js';
import { getOutfitInfo } from './shop.js';

export const CHARACTER_STYLES = {
  mint: {
    id: 'mint',
    name: 'Mầm Xanh',
    avatar: './assets/characters/char-mint.svg',
    shirt: '#95d5b2',
    shirtStroke: '#52b788',
    hair: '#64be93'
  },
  peach: {
    id: 'peach',
    name: 'Đào Hồng',
    avatar: './assets/characters/char-peach.svg',
    shirt: '#ffcad4',
    shirtStroke: '#ff8fab',
    hair: '#f28482'
  },
  butter: {
    id: 'butter',
    name: 'Kem Bơ',
    avatar: './assets/characters/char-butter.svg',
    shirt: '#fde4cf',
    shirtStroke: '#e6b89c',
    hair: '#d4a373'
  },
  lavender: {
    id: 'lavender',
    name: 'Mây Tím',
    avatar: './assets/characters/char-lavender.svg',
    shirt: '#e2ece9',
    shirtStroke: '#b8c0ff',
    hair: '#9da8f2'
  }
};

export function getCharacterAvatar(styleId) {
  return CHARACTER_STYLES[styleId]?.avatar || CHARACTER_STYLES.mint.avatar;
}

export function normalizeCharacterStyle(styleId) {
  return CHARACTER_STYLES[styleId] ? styleId : 'mint';
}

const MOVE_SPEED = 178;
const SYNC_INTERVAL_MS = 420;
const PRESENCE_TIMEOUT_MS = 95000;
const HEARTBEAT_MS = 45000;

export function createIslandGame({
  canvas,
  userProfile,
  onMapChange,
  onNearbyZoneChange,
  onInteractZone,
  onGardenPlotClick,
  onPetClick,
  onSelectFurniture,
  onPartnerPresenceChange,
  onPartnerReaction
}) {
  const ctx = canvas.getContext('2d');

  let currentMapId = 'island';
  let latestWorldData = null;
  let fadeAlpha = 0;

  // Chế độ chỉnh sửa nội thất trong Nhà chung
  let houseEditMode = false;
  let selectedFurnitureUid = null;
  let draggingFurniture = null;

  const me = {
    uid: userProfile.uid,
    displayName: userProfile.displayName,
    characterStyle: normalizeCharacterStyle(userProfile.characterStyle),
    outfitId: userProfile.equippedOutfit || 'outfit_default',
    hatId: userProfile.equippedHat || 'hat_none',
    chatText: '',
    chatAtMs: 0,
    emote: '',
    emoteAtMs: 0,
    x: ISLAND_RETURN_SPAWNS.default.x,
    y: ISLAND_RETURN_SPAWNS.default.y,
    dir: 'down',
    isMoving: false,
    walkPhase: 0,
    initializedFromCloud: false
  };

  let partner = null;
  let lastPartnerKey = '';
  let partnerReactionBaselineSet = false;
  let lastPartnerChatAt = 0;
  let lastPartnerEmoteAt = 0;

  let clickTarget = null;
  let pendingZoneInteractId = null;
  let clickRippleTime = 0;

  const pressedKeys = new Set();
  const touchDirs = { up: false, down: false, left: false, right: false };
  let analogVec = { x: 0, y: 0 };

  const floatingTexts = [];

  let viewW = MAP_WIDTH;
  let viewH = MAP_HEIGHT;
  let camX = 0;
  let camY = 0;
  let forceOverviewOnMobile = false;

  let currentZone = null;
  let rafId = null;
  let lastFrameMs = performance.now();

  let lastSyncMs = 0;
  let lastSyncedX = me.x;
  let lastSyncedY = me.y;
  let lastSyncedDir = me.dir;
  let lastSyncedMap = currentMapId;
  let stopSyncTimer = null;
  let heartbeatTimer = null;

  function isBlockedInCurrentMap(x, y) {
    if (currentMapId === 'island') return isIslandPositionBlocked(x, y);
    if (currentMapId === 'house') return isHousePositionBlocked(x, y, latestWorldData);
    if (currentMapId === 'shop') return isShopPositionBlocked(x, y);
    return isOutdoorSubmapBlocked(x, y);
  }

  function getActiveMapZones() {
    if (currentMapId === 'island') return ISLAND_ZONES;
    if (currentMapId === 'garden') return [GARDEN_EXIT_PORTAL];
    if (currentMapId === 'house') return [getHouseExitPortal(latestWorldData)];
    if (currentMapId === 'pet') return [PET_EXIT_PORTAL];
    if (currentMapId === 'shop') return SHOP_MAP_ZONES;
    return [];
  }

  function findNearbyZoneInCurrentMap(x, y) {
    const zones = getActiveMapZones();
    let closest = null;
    let minD = Infinity;
    for (const z of zones) {
      const d = Math.hypot(x - z.x, y - z.y);
      if (d <= z.radius && d < minD) {
        minD = d;
        closest = z;
      }
    }
    return closest;
  }

  function updateViewportMetrics() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(280, rect.width || MAP_WIDTH);
    const cssH = Math.max(220, rect.height || MAP_HEIGHT);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const isMobileScreen = window.innerWidth < 720;

    if (!isMobileScreen || forceOverviewOnMobile) {
      viewW = MAP_WIDTH;
      viewH = MAP_HEIGHT;
    } else {
      const aspect = cssW / cssH;
      viewW = Math.min(MAP_WIDTH, Math.max(450, cssW * 1.32));
      viewH = Math.min(MAP_HEIGHT, viewW / aspect);
      viewW = Math.min(MAP_WIDTH, viewH * aspect);
    }

    const targetPixelW = Math.round(cssW * dpr);
    const targetPixelH = Math.round(cssH * dpr);
    if (canvas.width !== targetPixelW || canvas.height !== targetPixelH) {
      canvas.width = targetPixelW;
      canvas.height = targetPixelH;
    }

    camX = Math.max(0, Math.min(MAP_WIDTH - viewW, me.x - viewW / 2));
    camY = Math.max(0, Math.min(MAP_HEIGHT - viewH, me.y - viewH / 2));
  }

  function isModalOrInputActive() {
    const active = document.activeElement;
    if (active) {
      const tag = active.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable) {
        return true;
      }
    }
    return Boolean(document.querySelector('.modal-backdrop:not(.hidden)'));
  }

  function requestPositionSync(force = false) {
    const now = Date.now();
    const movedDist = Math.hypot(me.x - lastSyncedX, me.y - lastSyncedY);
    const changed = movedDist >= 3 || me.dir !== lastSyncedDir || currentMapId !== lastSyncedMap;

    if (!force && !changed) return;

    if (force || now - lastSyncMs >= SYNC_INTERVAL_MS) {
      lastSyncMs = now;
      lastSyncedX = me.x;
      lastSyncedY = me.y;
      lastSyncedDir = me.dir;
      lastSyncedMap = currentMapId;

      syncPlayerPositionToCloud(me.uid, {
        mapId: currentMapId,
        x: me.x,
        y: me.y,
        dir: me.dir,
        displayName: me.displayName,
        characterStyle: me.characterStyle,
        outfitId: me.outfitId,
        hatId: me.hatId,
        chatText: me.chatText,
        chatAtMs: me.chatAtMs,
        emote: me.emote,
        emoteAtMs: me.emoteAtMs,
        online: true
      }).catch(() => {});
    }
  }

  function scheduleFinalStopSync() {
    clearTimeout(stopSyncTimer);
    stopSyncTimer = setTimeout(() => {
      requestPositionSync(true);
    }, 150);
  }

  /**
   * Chuyển sang Map riêng của từng khu (không tải lại trang web).
   * @param {'island'|'house'|'garden'|'pet'|'shop'} targetMapId
   */
  function switchMap(targetMapId) {
    if (!targetMapId || targetMapId === currentMapId) return;

    const prevMap = currentMapId;
    currentMapId = targetMapId;
    clickTarget = null;
    pendingZoneInteractId = null;
    draggingFurniture = null;
    selectedFurnitureUid = null;
    if (targetMapId !== 'house') houseEditMode = false;

    if (targetMapId === 'island') {
      const sp = ISLAND_RETURN_SPAWNS[prevMap] || ISLAND_RETURN_SPAWNS.default;
      me.x = sp.x;
      me.y = sp.y;
      me.dir = 'down';
    } else if (targetMapId === 'garden') {
      me.x = GARDEN_SPAWN.x;
      me.y = GARDEN_SPAWN.y;
      me.dir = 'down';
    } else if (targetMapId === 'house') {
      const sp = getHouseSpawn(latestWorldData);
      me.x = sp.x;
      me.y = sp.y;
      me.dir = 'up';
    } else if (targetMapId === 'pet') {
      me.x = PET_SPAWN.x;
      me.y = PET_SPAWN.y;
      me.dir = 'down';
    } else if (targetMapId === 'shop') {
      me.x = SHOP_SPAWN.x;
      me.y = SHOP_SPAWN.y;
      me.dir = 'up';
    }

    camX = Math.max(0, Math.min(MAP_WIDTH - viewW, me.x - viewW / 2));
    camY = Math.max(0, Math.min(MAP_HEIGHT - viewH, me.y - viewH / 2));
    fadeAlpha = 0.55;

    currentZone = findNearbyZoneInCurrentMap(me.x, me.y);
    onNearbyZoneChange?.(currentZone);
    onMapChange?.(currentMapId);
    requestPositionSync(true);
  }

  function spawnFloatingEffect(text, color = '#d94d72', customX = null, customY = null) {
    floatingTexts.push({
      text,
      x: customX ?? me.x,
      y: (customY ?? me.y) - 46,
      age: 0,
      duration: 1.4,
      color
    });
  }

  function applyWorldSnapshot(worldData) {
    latestWorldData = worldData;
    const positions = worldData?.positions || {};

    if (!me.initializedFromCloud) {
      me.initializedFromCloud = true;
      const savedMe = positions[me.uid];
      if (!userProfile.equippedOutfit && savedMe?.outfitId) {
        me.outfitId = savedMe.outfitId;
      }
      if (!userProfile.equippedHat && savedMe?.hatId) {
        me.hatId = savedMe.hatId;
      }
      if (savedMe && typeof savedMe.x === 'number' && typeof savedMe.y === 'number') {
        const savedMap = savedMe.mapId || 'island';
        currentMapId = savedMap;
        if (!isBlockedInCurrentMap(savedMe.x, savedMe.y)) {
          me.x = savedMe.x;
          me.y = savedMe.y;
          me.dir = savedMe.dir || 'down';
        }
        camX = Math.max(0, Math.min(MAP_WIDTH - viewW, me.x - viewW / 2));
        camY = Math.max(0, Math.min(MAP_HEIGHT - viewH, me.y - viewH / 2));
        onMapChange?.(currentMapId);
      }
      requestPositionSync(true);
    }

    // Nếu vừa nâng cấp nhà hoặc đổi map mà nhân vật lỡ sát mép thì kẹp an toàn vào trong phòng
    if (currentMapId === 'house' && isHousePositionBlocked(me.x, me.y, latestWorldData)) {
      const sp = getHouseSpawn(latestWorldData);
      me.x = sp.x;
      me.y = sp.y;
    }

    const otherUid = Object.keys(positions).find((id) => id !== me.uid);
    const otherPos = otherUid ? positions[otherUid] : null;
    const now = Date.now();

    const isPartnerOnline = Boolean(
      otherPos &&
      otherPos.online !== false &&
      typeof otherPos.updatedAtMs === 'number' &&
      now - otherPos.updatedAtMs < PRESENCE_TIMEOUT_MS
    );

    if (isPartnerOnline) {
      const memberProfile = worldData?.members?.[otherUid];
      const pName = otherPos.displayName || memberProfile?.displayName || 'Người thương';
      const pStyle = normalizeCharacterStyle(otherPos.characterStyle || memberProfile?.characterStyle);
      const pMap = otherPos.mapId || 'island';
      const pOutfit = otherPos.outfitId || 'outfit_default';
      const pHat = otherPos.hatId || 'hat_none';
      const pChatText = otherPos.chatText || '';
      const pChatAtMs = Number(otherPos.chatAtMs || 0);
      const pEmote = otherPos.emote || '';
      const pEmoteAtMs = Number(otherPos.emoteAtMs || 0);

      if (!partnerReactionBaselineSet) {
        partnerReactionBaselineSet = true;
        lastPartnerChatAt = pChatAtMs;
        lastPartnerEmoteAt = pEmoteAtMs;
      } else {
        if (pChatText && pChatAtMs > lastPartnerChatAt && now - pChatAtMs < 18000) {
          lastPartnerChatAt = pChatAtMs;
          onPartnerReaction?.({
            type: 'chat',
            name: pName,
            mapId: pMap,
            text: pChatText
          });
        }
        if (pEmote && pEmoteAtMs > lastPartnerEmoteAt && now - pEmoteAtMs < 12000) {
          lastPartnerEmoteAt = pEmoteAtMs;
          onPartnerReaction?.({
            type: 'emote',
            name: pName,
            mapId: pMap,
            emote: pEmote
          });
        }
      }

      if (!partner || partner.mapId !== pMap) {
        partner = {
          uid: otherUid,
          mapId: pMap,
          displayName: pName,
          characterStyle: pStyle,
          outfitId: pOutfit,
          hatId: pHat,
          chatText: pChatText,
          chatAtMs: pChatAtMs,
          emote: pEmote,
          emoteAtMs: pEmoteAtMs,
          x: otherPos.x ?? me.x + 34,
          y: otherPos.y ?? me.y,
          targetX: otherPos.x ?? me.x + 34,
          targetY: otherPos.y ?? me.y,
          dir: otherPos.dir || 'down',
          walkPhase: 0,
          updatedAtMs: otherPos.updatedAtMs
        };
      } else {
        partner.displayName = pName;
        partner.characterStyle = pStyle;
        partner.outfitId = pOutfit;
        partner.hatId = pHat;
        partner.chatText = pChatText;
        partner.chatAtMs = pChatAtMs;
        partner.emote = pEmote;
        partner.emoteAtMs = pEmoteAtMs;
        partner.targetX = otherPos.x ?? partner.targetX;
        partner.targetY = otherPos.y ?? partner.targetY;
        partner.dir = otherPos.dir || partner.dir;
        partner.updatedAtMs = otherPos.updatedAtMs;
      }
    } else {
      partner = null;
    }

    const nextKey = isPartnerOnline ? `${partner.displayName}|${partner.mapId}` : 'offline';
    if (nextKey !== lastPartnerKey) {
      lastPartnerKey = nextKey;
      onPartnerPresenceChange?.(isPartnerOnline, partner?.displayName || '', partner?.mapId || 'island');
    }
  }

  function updateMovementAndCamera(dt) {
    if (fadeAlpha > 0) {
      fadeAlpha = Math.max(0, fadeAlpha - dt * 2.6);
    }

    let dx = analogVec.x;
    let dy = analogVec.y;

    if (dx === 0 && dy === 0) {
      if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp') || touchDirs.up) dy -= 1;
      if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown') || touchDirs.down) dy += 1;
      if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft') || touchDirs.left) dx -= 1;
      if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight') || touchDirs.right) dx += 1;
    }

    if (dx !== 0 || dy !== 0) {
      clickTarget = null;
      pendingZoneInteractId = null;
    } else if (clickTarget) {
      const distToTarget = Math.hypot(clickTarget.x - me.x, clickTarget.y - me.y);
      if (distToTarget > 6) {
        dx = (clickTarget.x - me.x) / distToTarget;
        dy = (clickTarget.y - me.y) / distToTarget;
      } else {
        clickTarget = null;
      }
    }

    const wasMoving = me.isMoving;

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      const speedScale = Math.min(1, len);
      dx = (dx / len) * speedScale;
      dy = (dy / len) * speedScale;

      if (Math.abs(dx) > Math.abs(dy)) {
        me.dir = dx < 0 ? 'left' : 'right';
      } else {
        me.dir = dy < 0 ? 'up' : 'down';
      }

      const stepX = dx * MOVE_SPEED * dt;
      const stepY = dy * MOVE_SPEED * dt;

      let moved = false;
      if (!isBlockedInCurrentMap(me.x + stepX, me.y)) {
        me.x += stepX;
        moved = true;
      }
      if (!isBlockedInCurrentMap(me.x, me.y + stepY)) {
        me.y += stepY;
        moved = true;
      }

      if (!moved && clickTarget) {
        clickTarget = null;
        pendingZoneInteractId = null;
      }

      me.isMoving = moved;
      if (moved) {
        me.walkPhase += dt * 11;
        requestPositionSync(false);
      }
    } else {
      me.isMoving = false;
    }

    if (wasMoving && !me.isMoving) {
      scheduleFinalStopSync();
    }

    const near = findNearbyZoneInCurrentMap(me.x, me.y);
    if (near?.id !== currentZone?.id) {
      currentZone = near;
      onNearbyZoneChange?.(currentZone);
    }

    if (pendingZoneInteractId && currentZone?.id === pendingZoneInteractId) {
      const targetZone = currentZone;
      pendingZoneInteractId = null;
      clickTarget = null;
      me.isMoving = false;
      scheduleFinalStopSync();
      onInteractZone?.(targetZone);
    }

    const desiredCamX = Math.max(0, Math.min(MAP_WIDTH - viewW, me.x - viewW / 2));
    const desiredCamY = Math.max(0, Math.min(MAP_HEIGHT - viewH, me.y - viewH / 2));
    const camLerp = Math.min(1, dt * 7.5);
    camX += (desiredCamX - camX) * camLerp;
    camY += (desiredCamY - camY) * camLerp;

    if (partner) {
      if (Date.now() - partner.updatedAtMs > PRESENCE_TIMEOUT_MS) {
        partner = null;
        lastPartnerKey = 'offline';
        onPartnerPresenceChange?.(false, '', 'island');
      } else if (partner.mapId === currentMapId) {
        const pdx = partner.targetX - partner.x;
        const pdy = partner.targetY - partner.y;
        if (Math.hypot(pdx, pdy) > 1.2) {
          const factor = Math.min(1, dt * 8.5);
          partner.x += pdx * factor;
          partner.y += pdy * factor;
          partner.walkPhase += dt * 11;
        }
      }
    }

    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      floatingTexts[i].age += dt;
      floatingTexts[i].y -= dt * 24;
      if (floatingTexts[i].age >= floatingTexts[i].duration) {
        floatingTexts.splice(i, 1);
      }
    }
  }

  function drawCharacter2D(charObj, isLocalPlayer, timeSec) {
    const palette = CHARACTER_STYLES[charObj.characterStyle] || CHARACTER_STYLES.mint;
    const isWalking = isLocalPlayer
      ? charObj.isMoving
      : Math.hypot((charObj.targetX || charObj.x) - charObj.x, (charObj.targetY || charObj.y) - charObj.y) > 1.5;

    const bounceY = isWalking ? Math.abs(Math.sin(charObj.walkPhase)) * -4.5 : Math.sin(timeSec * 2.2) * -1.2;
    const cx = charObj.x;
    const cy = charObj.y;

    ctx.save();

    ctx.fillStyle = 'rgba(74, 59, 50, 0.16)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, 13, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (isLocalPlayer) {
      ctx.strokeStyle = 'rgba(116, 198, 157, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 4, 16, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const footSwing = isWalking ? Math.sin(charObj.walkPhase) * 3.5 : 0;
    ctx.fillStyle = '#7f5539';
    ctx.beginPath();
    ctx.arc(cx - 5, cy + 1 + footSwing * 0.5, 3.6, 0, Math.PI * 2);
    ctx.arc(cx + 5, cy + 1 - footSwing * 0.5, 3.6, 0, Math.PI * 2);
    ctx.fill();

    const customOutfit = getOutfitInfo(charObj.outfitId);
    const bodyY = cy - 15 + bounceY;
    ctx.fillStyle = customOutfit?.shirt || palette.shirt;
    ctx.strokeStyle = customOutfit?.shirtStroke || palette.shirtStroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx - 11, bodyY, 22, 16, 8);
    ctx.fill();
    ctx.stroke();

    if (customOutfit && customOutfit.id !== 'outfit_default') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.beginPath();
      ctx.arc(cx, bodyY + 5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const headY = cy - 28 + bounceY;
    ctx.fillStyle = '#fff1e6';
    ctx.strokeStyle = '#ddb892';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, headY, 13.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (charObj.dir === 'up') {
      ctx.fillStyle = palette.hair;
      ctx.beginPath();
      ctx.arc(cx, headY - 1, 13.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = palette.hair;
      ctx.beginPath();
      ctx.arc(cx, headY - 2, 13.5, Math.PI * 1.08, Math.PI * 1.92);
      ctx.quadraticCurveTo(cx, headY - 9, cx - 13, headY - 3);
      ctx.fill();

      const faceShiftX = charObj.dir === 'left' ? -2.8 : charObj.dir === 'right' ? 2.8 : 0;
      const isBlinking = (timeSec % 4.2) > 4.06;

      ctx.fillStyle = '#4a3b32';
      if (isBlinking) {
        ctx.fillRect(cx - 6 + faceShiftX, headY, 3.5, 1.4);
        ctx.fillRect(cx + 2.5 + faceShiftX, headY, 3.5, 1.4);
      } else {
        ctx.beginPath();
        ctx.arc(cx - 4.5 + faceShiftX, headY + 0.5, 1.9, 0, Math.PI * 2);
        ctx.arc(cx + 4.5 + faceShiftX, headY + 0.5, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(255, 143, 171, 0.55)';
      ctx.beginPath();
      ctx.ellipse(cx - 7.5 + faceShiftX, headY + 3.5, 2.6, 1.5, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 7.5 + faceShiftX, headY + 3.5, 2.6, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#4a3b32';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx + faceShiftX, headY + 2.8, 2.4, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    }

    const customHat = getOutfitInfo(charObj.hatId);
    if (customHat?.badgeEmoji) {
      ctx.font = '15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(customHat.badgeEmoji, cx, headY - 17);
    } else {
      drawHeadAccessory(ctx, charObj.characterStyle, cx, headY);
    }

    const label = charObj.displayName || 'Cư dân';
    ctx.font = '800 11.5px Nunito, sans-serif';
    const textW = ctx.measureText(label).width;
    const pillW = textW + 14;
    const pillH = 20;
    const px = cx - pillW / 2;
    const py = customHat?.badgeEmoji ? headY - 40 : headY - 34;

    ctx.fillStyle = isLocalPlayer ? 'rgba(255, 255, 255, 0.94)' : 'rgba(255, 229, 236, 0.95)';
    ctx.strokeStyle = isLocalPlayer ? '#74c69d' : '#ff8fab';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(px, py, pillW, pillH, 999);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#4a3b32';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, py + pillH / 2 + 0.5);

    // Hiển thị Bong bóng Chat & Biểu cảm yêu thương trực tiếp trên đầu nhân vật
    const nowWallMs = Date.now();
    let stackTopY = py - 6;

    const chatAgeMs = nowWallMs - Number(charObj.chatAtMs || 0);
    if (charObj.chatText && chatAgeMs >= 0 && chatAgeMs < 7500) {
      const fadeRatio = chatAgeMs > 6300 ? Math.max(0, 1 - (chatAgeMs - 6300) / 1200) : 1;
      ctx.save();
      ctx.globalAlpha = fadeRatio;
      ctx.font = '700 11.5px Nunito, sans-serif';

      const words = String(charObj.chatText).trim().slice(0, 60).split(/\s+/);
      const lines = [];
      let curLine = '';
      for (const w of words) {
        const test = curLine ? `${curLine} ${w}` : w;
        if (ctx.measureText(test).width > 168 && curLine) {
          lines.push(curLine);
          curLine = w;
          if (lines.length >= 2) break;
        } else {
          curLine = test;
        }
      }
      if (curLine && lines.length < 2) lines.push(curLine);

      const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width), 36);
      const bubbleW = maxLineW + 20;
      const lineH = 15;
      const bubbleH = lines.length * lineH + 10;
      const bubbleX = Math.max(camX + 6, Math.min(camX + viewW - bubbleW - 6, cx - bubbleW / 2));
      const bubbleY = stackTopY - bubbleH - 5;

      ctx.fillStyle = '#fffdf9';
      ctx.strokeStyle = '#ff8fab';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(bubbleX, bubbleY, bubbleW, bubbleH, 11);
      ctx.fill();
      ctx.stroke();

      // Đuôi bong bóng nhỏ hướng xuống nhân vật
      const tailX = Math.max(bubbleX + 12, Math.min(bubbleX + bubbleW - 12, cx));
      ctx.beginPath();
      ctx.moveTo(tailX - 5, bubbleY + bubbleH - 1);
      ctx.lineTo(tailX, bubbleY + bubbleH + 5);
      ctx.lineTo(tailX + 5, bubbleY + bubbleH - 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#4a3b32';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((ln, idx) => {
        ctx.fillText(ln, bubbleX + bubbleW / 2, bubbleY + 12 + idx * lineH);
      });
      ctx.restore();

      stackTopY = bubbleY - 6;
    }

    const emoteAgeMs = nowWallMs - Number(charObj.emoteAtMs || 0);
    if (charObj.emote && emoteAgeMs >= 0 && emoteAgeMs < 4600) {
      const fadeRatio = emoteAgeMs > 3600 ? Math.max(0, 1 - (emoteAgeMs - 3600) / 1000) : 1;
      const floatEmoteY = stackTopY - 15 + Math.sin(timeSec * 7.5) * 3;
      ctx.save();
      ctx.globalAlpha = fadeRatio;
      ctx.fillStyle = 'rgba(255, 240, 245, 0.96)';
      ctx.strokeStyle = '#ff8fab';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(cx, floatEmoteY, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = '17px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(charObj.emote, cx, floatEmoteY + 1);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawHeadAccessory(ctx, style, cx, headY) {
    if (style === 'mint') {
      ctx.fillStyle = '#74c69d';
      ctx.beginPath();
      ctx.ellipse(cx + 4, headY - 16, 5, 2.8, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#40916c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, headY - 13);
      ctx.quadraticCurveTo(cx + 1, headY - 17, cx + 4, headY - 16);
      ctx.stroke();
    } else if (style === 'peach') {
      ctx.fillStyle = '#ff8fab';
      ctx.beginPath();
      ctx.arc(cx - 10, headY - 10, 4.2, 0, Math.PI * 2);
      ctx.arc(cx + 10, headY - 10, 4.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'butter') {
      ctx.fillStyle = '#faedcd';
      ctx.strokeStyle = '#d4a373';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, headY - 12, 11, 3.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (style === 'lavender') {
      ctx.fillStyle = '#ffc2d1';
      ctx.beginPath();
      ctx.arc(cx + 9, headY - 9, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCoupleProximityHearts(timeSec) {
    if (!partner || partner.mapId !== currentMapId) return;
    const dist = Math.hypot(me.x - partner.x, me.y - partner.y);
    if (dist > 76) return;

    const midX = (me.x + partner.x) / 2;
    const midY = Math.min(me.y, partner.y) - 44;
    const floatOffset = ((timeSec * 0.9) % 1) * 16;
    const alpha = 1 - ((timeSec * 0.9) % 1) * 0.7;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💕', midX, midY - floatOffset);
    ctx.restore();
  }

  function drawFloatingEffects() {
    for (const item of floatingTexts) {
      const alpha = Math.max(0, 1 - item.age / item.duration);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '800 12.5px Nunito, sans-serif';
      const w = ctx.measureText(item.text).width + 16;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.strokeStyle = '#ffc2d1';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(item.x - w / 2, item.y - 12, w, 24, 999);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = item.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.text, item.x, item.y + 0.5);
      ctx.restore();
    }
  }

  function frameLoop(nowMs) {
    const dt = Math.min(0.05, (nowMs - lastFrameMs) / 1000);
    lastFrameMs = nowMs;
    const timeSec = nowMs / 1000;

    updateMovementAndCamera(dt);

    const scaleX = canvas.width / viewW;
    const scaleY = canvas.height / viewH;
    ctx.setTransform(scaleX, 0, 0, scaleY, -camX * scaleX, -camY * scaleY);
    ctx.clearRect(camX, camY, viewW, viewH);

    // 1. Vẽ bản đồ tương ứng với Khu vực hiện tại
    if (currentMapId === 'island') {
      drawIslandWorld(ctx, timeSec, currentZone?.id || null);
    } else if (currentMapId === 'garden') {
      drawGardenMap(ctx, timeSec, latestWorldData, currentZone?.id === 'exit_to_island');
    } else if (currentMapId === 'house') {
      drawHouseInteriorMap(
        ctx,
        timeSec,
        latestWorldData,
        currentZone?.id === 'exit_to_island',
        selectedFurnitureUid
      );
    } else if (currentMapId === 'pet') {
      drawPetPlaygroundMap(ctx, dt, timeSec, latestWorldData, currentZone?.id === 'exit_to_island');
    } else if (currentMapId === 'shop') {
      drawShopInteriorMap(ctx, timeSec, currentZone?.id || null);
    }

    if (clickTarget) {
      clickRippleTime += dt * 4;
      ctx.strokeStyle = 'rgba(255, 143, 171, 0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(clickTarget.x, clickTarget.y, 6 + (Math.sin(clickRippleTime) + 1) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 2. Vẽ nhân vật của mình (và người thương nếu đang ở cùng 1 Map)
    const renderList = [{ char: me, isLocal: true }];
    if (partner && partner.mapId === currentMapId) {
      renderList.push({ char: partner, isLocal: false });
    }
    renderList.sort((a, b) => a.char.y - b.char.y);

    for (const item of renderList) {
      drawCharacter2D(item.char, item.isLocal, timeSec);
    }

    drawCoupleProximityHearts(timeSec);

    if (currentMapId === 'island') {
      drawZoneLabels(ctx, currentZone?.id || null, timeSec);
    }

    drawFloatingEffects();

    // Hiệu ứng chuyển cảnh nhẹ nhàng khi qua cổng Map
    if (fadeAlpha > 0) {
      ctx.fillStyle = `rgba(255, 253, 248, ${fadeAlpha.toFixed(2)})`;
      ctx.fillRect(camX, camY, viewW, viewH);
    }

    rafId = requestAnimationFrame(frameLoop);
  }

  /* ========================================================================
     Tương tác Chuột / Chạm & Kéo thả nội thất
     ======================================================================== */
  function clientToMapCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      mapX: camX + ((clientX - rect.left) / rect.width) * viewW,
      mapY: camY + ((clientY - rect.top) / rect.height) * viewH
    };
  }

  function onCanvasPointerDown(e) {
    if (isModalOrInputActive()) return;
    const { mapX, mapY } = clientToMapCoords(e.clientX, e.clientY);

    // A. Trong Map Nhà Chung: Nếu đang bật Chế độ Sắp xếp Nội thất -> Cho phép chọn & kéo đồ!
    if (currentMapId === 'house' && houseEditMode && latestWorldData) {
      const hit = findPlacedFurnitureAt(mapX, mapY, latestWorldData);
      if (hit) {
        selectedFurnitureUid = hit.placed.uid;
        draggingFurniture = {
          uid: hit.placed.uid,
          offsetX: hit.placed.x - mapX,
          offsetY: hit.placed.y - mapY,
          lastX: hit.placed.x,
          lastY: hit.placed.y
        };
        canvas.setPointerCapture?.(e.pointerId);
        onSelectFurniture?.(hit);
        return;
      } else {
        selectedFurnitureUid = null;
        onSelectFurniture?.(null);
      }
    }

    // B. Kiểm tra chạm vào cổng khu vực / cửa thoát
    const zones = getActiveMapZones();
    const tappedZone = zones.find(
      (z) =>
        Math.hypot(mapX - z.x, mapY - z.y) <= z.radius + 14 ||
        (z.labelX && Math.hypot(mapX - z.labelX, mapY - z.labelY) <= 46)
    );

    if (tappedZone) {
      if (currentZone?.id === tappedZone.id) {
        onInteractZone?.(tappedZone);
      } else {
        clickTarget = { x: tappedZone.x, y: tappedZone.y };
        pendingZoneInteractId = tappedZone.id;
        clickRippleTime = 0;
      }
      return;
    }

    // C. Trong Map Khu Vườn: Chạm trực tiếp vào 1 trong 54 ô đất!
    if (currentMapId === 'garden') {
      const plot = findGardenPlotAt(mapX, mapY);
      if (plot) {
        if (!isBlockedInCurrentMap(plot.cx, plot.cy + 12)) {
          clickTarget = { x: plot.cx, y: plot.cy + 12 };
        }
        onGardenPlotClick?.(plot);
        return;
      }
    }

    // D. Trong Map Khu Thú Cưng: Chạm trực tiếp vào bé thú cưng đang chạy trên sân!
    if (currentMapId === 'pet' && latestWorldData) {
      const hitPet = findTappedPetOnCanvas(mapX, mapY, latestWorldData);
      if (hitPet) {
        onPetClick?.(hitPet);
        return;
      }
    }

    // E. Đi bộ tự nhiên tới vị trí chạm
    if (!isBlockedInCurrentMap(mapX, mapY)) {
      clickTarget = { x: mapX, y: mapY };
      pendingZoneInteractId = null;
      clickRippleTime = 0;
    }
  }

  function onCanvasPointerMove(e) {
    if (!draggingFurniture || !latestWorldData) return;
    e.preventDefault();
    const { mapX, mapY } = clientToMapCoords(e.clientX, e.clientY);
    const nextX = mapX + draggingFurniture.offsetX;
    const nextY = mapY + draggingFurniture.offsetY;
    draggingFurniture.lastX = nextX;
    draggingFurniture.lastY = nextY;

    // Cập nhật tức thì trên màn hình lúc đang kéo
    if (Array.isArray(latestWorldData?.house?.placedItems)) {
      const target = latestWorldData.house.placedItems.find((p) => p.uid === draggingFurniture.uid);
      if (target) {
        target.x = Math.round(nextX);
        target.y = Math.round(nextY);
      }
    }
  }

  function onCanvasPointerUp() {
    if (!draggingFurniture || !latestWorldData) return;
    const finished = draggingFurniture;
    draggingFurniture = null;
    movePlacedFurniture({
      placedUid: finished.uid,
      x: finished.lastX,
      y: finished.lastY,
      worldData: latestWorldData
    }).catch(() => {});
  }

  function onKeyDown(e) {
    if (isModalOrInputActive()) return;

    const moveCodes = [
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
    ];

    if (moveCodes.includes(e.code)) {
      e.preventDefault();
      pressedKeys.add(e.code);
      return;
    }

    if ((e.code === 'KeyE' || e.code === 'Space') && currentZone) {
      e.preventDefault();
      onInteractZone?.(currentZone);
    }
  }

  function onKeyUp(e) {
    pressedKeys.delete(e.code);
  }

  function onWindowBlur() {
    pressedKeys.clear();
    analogVec = { x: 0, y: 0 };
    touchDirs.up = false;
    touchDirs.down = false;
    touchDirs.left = false;
    touchDirs.right = false;
  }

  function setAnalogInput(vx, vy) {
    analogVec = { x: vx, y: vy };
    if (vx !== 0 || vy !== 0) {
      clickTarget = null;
      pendingZoneInteractId = null;
    }
  }

  function setHouseEditMode(enabled) {
    houseEditMode = Boolean(enabled);
    if (!houseEditMode) {
      selectedFurnitureUid = null;
      draggingFurniture = null;
      onSelectFurniture?.(null);
    }
    return houseEditMode;
  }

  function clearSelectedFurniture() {
    selectedFurnitureUid = null;
    onSelectFurniture?.(null);
  }

  function toggleMobileCameraMode() {
    forceOverviewOnMobile = !forceOverviewOnMobile;
    updateViewportMetrics();
    return forceOverviewOnMobile;
  }

  function triggerCurrentZoneInteraction() {
    if (currentZone) {
      onInteractZone?.(currentZone);
    }
  }

  function setAppearance({ outfitId, hatId }) {
    if (outfitId) me.outfitId = outfitId;
    if (hatId) me.hatId = hatId;
    requestPositionSync(true);
  }

  function sendChatBubble(rawText) {
    const clean = String(rawText || '').trim().slice(0, 60);
    if (!clean) return false;
    me.chatText = clean;
    me.chatAtMs = Date.now();
    requestPositionSync(true);
    return true;
  }

  function sendLoveEmote(emoteIcon) {
    const clean = String(emoteIcon || '').trim().slice(0, 8);
    if (!clean) return false;
    me.emote = clean;
    me.emoteAtMs = Date.now();
    requestPositionSync(true);
    return true;
  }

  async function markOfflineAndStop() {
    if (rafId) cancelAnimationFrame(rafId);
    clearInterval(heartbeatTimer);
    clearTimeout(stopSyncTimer);

    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('resize', updateViewportMetrics);
    canvas.removeEventListener('pointerdown', onCanvasPointerDown);
    canvas.removeEventListener('pointermove', onCanvasPointerMove);
    canvas.removeEventListener('pointerup', onCanvasPointerUp);
    canvas.removeEventListener('pointercancel', onCanvasPointerUp);

    try {
      await syncPlayerPositionToCloud(me.uid, {
        mapId: currentMapId,
        x: me.x,
        y: me.y,
        dir: me.dir,
        displayName: me.displayName,
        characterStyle: me.characterStyle,
        outfitId: me.outfitId,
        hatId: me.hatId,
        chatText: me.chatText,
        chatAtMs: me.chatAtMs,
        emote: me.emote,
        emoteAtMs: me.emoteAtMs,
        online: false
      });
    } catch {
      // Bỏ qua nếu mất mạng
    }
  }

  updateViewportMetrics();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('resize', updateViewportMetrics);
  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  canvas.addEventListener('pointermove', onCanvasPointerMove);
  canvas.addEventListener('pointerup', onCanvasPointerUp);
  canvas.addEventListener('pointercancel', onCanvasPointerUp);

  heartbeatTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      requestPositionSync(true);
    }
  }, HEARTBEAT_MS);

  lastFrameMs = performance.now();
  rafId = requestAnimationFrame(frameLoop);

  return {
    getCurrentMapId: () => currentMapId,
    getPlayerCoords: () => ({ x: me.x, y: me.y }),
    getAppearance: () => ({ outfitId: me.outfitId, hatId: me.hatId }),
    setAppearance,
    sendChatBubble,
    sendLoveEmote,
    switchMap,
    applyWorldSnapshot,
    setAnalogInput,
    setHouseEditMode,
    isHouseEditMode: () => houseEditMode,
    getSelectedFurnitureUid: () => selectedFurnitureUid,
    clearSelectedFurniture,
    toggleMobileCameraMode,
    triggerCurrentZoneInteraction,
    spawnFloatingEffect,
    refreshViewport: updateViewportMetrics,
    markOfflineAndStop
  };
}
