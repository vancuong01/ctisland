/**
 * CTISLAND - Điều phối luồng ứng dụng chính Đa Bản Đồ (app.js)
 * Tích hợp đầy đủ 5 Map riêng biệt trên Máy tính & Điện thoại:
 * - `island`: Đảo Chính trung tâm & Bảng Nhiệm Vụ Hằng Ngày (UTC+7)
 * - `shop`  : Cửa Hàng (Vật phẩm trang trí nhà & Hạt giống nông trại)
 * - `garden`: Khu Vườn (Mở sẵn 6 ô đất, mở khóa bằng Điểm yêu thương tối đa 54 ô)
 * - `pet`   : Khu Thú Cưng (Sân chơi tối đa 10 bé thú cưng chạy nhảy trực tiếp)
 * - `house` : Khu Nhà Chung (Trang trí tường/sàn, đặt/kéo nội thất & Nâng cấp nhà Cấp 1 -> 4)
 */

import {
  auth,
  isFirebaseConfigured,
  onAuthStateChanged,
  signOut
} from './firebase.js';
import {
  ensureUserProfile,
  translateAuthError
} from './auth.js';
import {
  MAP_METADATA,
  ensureSharedWorldAccess,
  renameWorld,
  subscribeToSharedWorld
} from './world.js';
import {
  SEED_CATALOG,
  DECOR_CATALOG,
  OUTFIT_CATALOG,
  PET_ACCESSORY_CATALOG,
  getOutfitInfo,
  getPetAccessoryInfo,
  buildDefaultInventory,
  ensureSharedInventory,
  subscribeSharedInventory,
  buyShopItem,
  saveUserWardrobe
} from './shop.js';
import {
  MAX_GARDEN_PLOTS,
  getNextPlotUnlockCost,
  getNormalizedGarden,
  evaluatePlotCrop,
  unlockNextGardenPlot,
  plantSeedInGarden,
  waterGardenPlot,
  harvestGardenPlot
} from './garden.js';
import {
  HOUSE_LEVELS,
  MAX_HOUSE_LEVEL,
  getNormalizedHouse,
  upgradeSharedHouse,
  applyHouseSurfaceStyle,
  placeFurnitureItem,
  removePlacedFurniture
} from './house.js';
import {
  MAX_PETS,
  PET_ADOPT_COST,
  PET_SPECIES,
  getNormalizedPets,
  computePetLiveStats,
  adoptPet,
  careForPet,
  renamePetById,
  equipPetAccessory,
  triggerPetExcitedJump
} from './pet.js';
import {
  getCharacterAvatar,
  createIslandGame
} from './player.js';
import {
  DAILY_QUEST_DEFS,
  getVietnamDateKey,
  formatVietnamDate,
  syncDailyLoginStreak,
  ensureTodayQuestsInitialized,
  progressIslandQuest,
  claimQuestReward,
  subscribeTodayQuests,
  fetchPointTransactions
} from './quest.js';
import {
  MEMORY_MOODS,
  calculateLoveDays,
  saveLoveStartDate,
  fetchSharedMemories,
  createSharedMemory,
  deleteSharedMemory
} from './memory.js';
import {
  initNetworkMonitor,
  showToast,
  showConfirm,
  setButtonLoading,
  showFirebaseSetupAlert,
  escapeHtml
} from './ui.js';

let currentUserProfile = null;
let currentWorldData = null;
let currentInventory = buildDefaultInventory();
let currentQuestData = null;
let activeDateKey = null;

let unsubscribeWorld = null;
let unsubscribeInventory = null;
let unsubscribeQuests = null;
let midnightCheckTimer = null;
let petStatsRefreshTimer = null;

let islandGame = null;
let previousWorldName = null;

// Trạng thái giao diện các khu con & Giai đoạn 3
let selectedSeedId = SEED_CATALOG[0].id;
let activeShopTab = 'seeds';
let activeHouseTab = 'furniture';
let activePetTab = 'care';
let activeWardrobeTab = 'outfit';
let activeMemoryTab = 'list';
let selectedMemoryMood = 'sweet';
let activeTxFilter = 'all';
let cachedTransactions = [];
let selectedPetId = null;
let selectedAdoptSpecies = 'cat';
let isRenamingPetInline = false;
let plotActionBusy = false;
let streakSyncedThisSession = false;

function showFirebaseRulesUpdateNotice() {
  const targetEl = document.getElementById('firebaseSetupAlert');
  if (!targetEl) return;
  targetEl.classList.remove('hidden');
  targetEl.innerHTML = `
    <strong>⚠️ Cần Publish lại Firestore Rules mới cho Giai đoạn 3!</strong>
    Hãy mở file <code>firestore.rules</code> trong VS Code, copy toàn bộ nội dung dán đè vào mục <strong>Firestore Database &rarr; Rules</strong> trên Firebase Console rồi bấm nút <strong>Publish</strong>. Sau đó tải lại trang (F5) nhé!
  `;
}

function handleActionError(err, fallbackMsg = 'Không thể thực hiện thao tác lúc này.') {
  if (err?.code === 'permission-denied') {
    showFirebaseRulesUpdateNotice();
    showToast('Hãy bấm Publish file firestore.rules mới trên Firebase Console nhé!', 'warning', 6000);
    return;
  }
  showToast(err?.message || translateAuthError(err) || fallbackMsg, 'error', 4500);
}

async function cleanupSession(markOffline = false) {
  if (typeof unsubscribeWorld === 'function') {
    unsubscribeWorld();
    unsubscribeWorld = null;
  }
  if (typeof unsubscribeInventory === 'function') {
    unsubscribeInventory();
    unsubscribeInventory = null;
  }
  if (typeof unsubscribeQuests === 'function') {
    unsubscribeQuests();
    unsubscribeQuests = null;
  }
  clearInterval(midnightCheckTimer);
  clearInterval(petStatsRefreshTimer);

  if (islandGame) {
    if (markOffline) {
      await islandGame.markOfflineAndStop();
    } else {
      islandGame.markOfflineAndStop();
    }
    islandGame = null;
  }
  previousWorldName = null;
  currentWorldData = null;
  streakSyncedThisSession = false;
}

/* ==========================================================================
   1. Trang Chủ (index.html)
   ========================================================================== */
function initLandingPage() {
  const landingRoot = document.getElementById('landingRoot');
  if (!landingRoot) return;

  initNetworkMonitor();

  const setupAlert = document.getElementById('firebaseSetupAlert');
  if (!isFirebaseConfigured()) {
    showFirebaseSetupAlert(setupAlert);
    return;
  }

  const guestActions = document.getElementById('heroGuestActions');
  const userActions = document.getElementById('heroUserActions');
  const welcomeNameEl = document.getElementById('heroWelcomeName');
  const headerAuthArea = document.getElementById('headerAuthArea');

  onAuthStateChanged(auth, (user) => {
    if (user) {
      const name = user.displayName || user.email?.split('@')[0] || 'bạn';
      if (welcomeNameEl) welcomeNameEl.textContent = name;
      guestActions?.classList.add('hidden');
      userActions?.classList.remove('hidden');
      if (headerAuthArea) {
        headerAuthArea.innerHTML = `<a href="./game.html" class="btn btn-primary btn-sm">🏝️ Vào Đảo Ngay</a>`;
      }
    } else {
      guestActions?.classList.remove('hidden');
      userActions?.classList.add('hidden');
      if (headerAuthArea) {
        headerAuthArea.innerHTML = `<a href="./login.html" class="btn btn-outline btn-sm">Đăng nhập</a>`;
      }
    }
  });
}

/* ==========================================================================
   2. Trang Thế Giới 2D Đa Bản Đồ (game.html)
   ========================================================================== */
function initGamePage() {
  const gameRoot = document.getElementById('gameRoot');
  if (!gameRoot) return;

  initNetworkMonitor();

  const loadingScreen = document.getElementById('loadingScreen');
  const setupAlert = document.getElementById('firebaseSetupAlert');

  if (!isFirebaseConfigured()) {
    loadingScreen?.classList.add('hidden');
    showFirebaseSetupAlert(setupAlert);
    return;
  }

  bindGameUIEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      await cleanupSession(false);
      window.location.replace('./login.html');
      return;
    }

    try {
      currentUserProfile = await ensureUserProfile(user);
      renderTopbarProfile(currentUserProfile);

      await ensureSharedWorldAccess(currentUserProfile);
      launchIsland2D();

      // Khởi tạo song song Túi đồ chung & Nhiệm vụ hằng ngày
      await Promise.all([
        initSharedInventorySystem(),
        initDailyQuestSystem()
      ]);
    } catch (err) {
      loadingScreen?.classList.add('hidden');

      if (err?.code === 'permission-denied') {
        showFirebaseRulesUpdateNotice();
        showToast(
          'Hãy Publish lại file firestore.rules mới trên Firebase Console rồi F5 nhé!',
          'warning',
          7000
        );
        return;
      }

      showToast(err?.message || translateAuthError(err), 'error', 6000);

      if (err?.code === 'island-full') {
        setTimeout(async () => {
          await signOut(auth);
          window.location.replace('./login.html');
        }, 2800);
      }
    }
  });

  window.addEventListener('pagehide', () => {
    cleanupSession(false);
  });
}

function renderTopbarProfile(profile) {
  const avatarImg = document.getElementById('topbarUserAvatar');
  const nameEl = document.getElementById('topbarUserName');

  if (avatarImg) {
    avatarImg.src = getCharacterAvatar(profile.characterStyle);
    avatarImg.alt = profile.displayName;
  }
  if (nameEl) {
    nameEl.textContent = profile.displayName;
  }
}

function updateAllBalanceLabels(points) {
  const formatted = Number(points || 0).toLocaleString('vi-VN');
  for (const id of [
    'lovePointsValue',
    'historyBalanceValue',
    'shopBalanceValue',
    'houseBalanceValue',
    'petBalanceValue',
    'wardrobeBalanceValue'
  ]) {
    const el = document.getElementById(id);
    if (el) el.textContent = formatted;
  }
}

function updateLoveDaysDisplay(loveStartDate) {
  const days = calculateLoveDays(loveStartDate);
  const badgeText = document.getElementById('loveDaysBadgeText');
  const modalTitle = document.getElementById('memoryLoveDaysTitle');
  const modalSub = document.getElementById('memoryLoveDateSub');
  const dateInput = document.getElementById('loveStartDateInput');

  if (dateInput && loveStartDate && document.activeElement !== dateInput) {
    dateInput.value = loveStartDate;
  }

  if (days !== null) {
    const formattedDays = days.toLocaleString('vi-VN');
    if (badgeText) badgeText.textContent = `Bên nhau ${formattedDays} ngày`;
    if (modalTitle) modalTitle.textContent = `💑 Đã bên nhau ${formattedDays} ngày!`;
    if (modalSub) modalSub.textContent = `Cột mốc bắt đầu: ${formatVietnamDate(loveStartDate)}`;
  } else {
    if (badgeText) badgeText.textContent = 'Kỷ niệm';
    if (modalTitle) modalTitle.textContent = '💑 Chọn ngày bắt đầu yêu nhau nhé!';
    if (modalSub) modalSub.textContent = 'Cả hai sẽ cùng nhìn thấy cột mốc này trên thanh đảo';
  }
}

async function recordCoupleMomentQuest() {
  if (!navigator.onLine) return;
  const qRes = await progressIslandQuest('couple_moment').catch(() => null);
  if (qRes?.justCompleted) {
    showToast('💌 Hoàn thành nhiệm vụ "Gửi lời yêu thương"! Mở 📋 Nhiệm vụ nhận +20 ❤️ nhé!', 'success', 3800);
  }
}

function launchIsland2D() {
  const loadingScreen = document.getElementById('loadingScreen');
  const islandSection = document.getElementById('worldConnectedSection');
  const lovePointsPill = document.getElementById('lovePointsPill');
  const canvas = document.getElementById('islandCanvas');

  loadingScreen?.classList.add('hidden');
  islandSection?.classList.remove('hidden');
  lovePointsPill?.classList.remove('hidden');

  if (!islandGame && canvas) {
    islandGame = createIslandGame({
      canvas,
      userProfile: currentUserProfile,
      onMapChange: handleMapChanged,
      onNearbyZoneChange: handleZoneChange,
      onInteractZone: handleZoneInteract,
      onGardenPlotClick: handleGardenPlotClick,
      onPetClick: handlePetCanvasClick,
      onSelectFurniture: handleFurnitureSelected,
      onPartnerPresenceChange: handlePartnerOnlineChange,
      onPartnerReaction: handlePartnerReaction
    });
    handleMapChanged(islandGame.getCurrentMapId());
    requestAnimationFrame(() => islandGame?.refreshViewport());
  }

  if (typeof unsubscribeWorld === 'function') {
    unsubscribeWorld();
  }

  unsubscribeWorld = subscribeToSharedWorld(
    (worldData) => {
      if (previousWorldName !== null && previousWorldName !== worldData.worldName) {
        showToast(`🏡 Tên đảo đã đổi thành "${worldData.worldName}"!`, 'info', 3500);
      }
      previousWorldName = worldData.worldName;
      currentWorldData = worldData;

      const worldNameEl = document.getElementById('worldNameHeading');
      if (worldNameEl) {
        worldNameEl.textContent = worldData.worldName || 'Đảo nhà Thùy';
      }

      updateAllBalanceLabels(worldData.lovePoints || 0);
      updateLoveDaysDisplay(worldData.loveStartDate);

      const streakEl = document.getElementById('questStreakValue');
      if (streakEl) {
        streakEl.textContent = String(Number(worldData?.loginStreak?.count || 1));
      }
      if (!streakSyncedThisSession) {
        streakSyncedThisSession = true;
        syncDailyLoginStreak(worldData).catch(() => {});
      }

      islandGame?.applyWorldSnapshot(worldData);

      // Cập nhật trực tiếp các thanh công cụ & hộp thoại đang mở
      refreshActiveContextToolbars();
      refreshOpenModals();
    },
    (err) => {
      handleActionError(err);
    }
  );
}

async function initSharedInventorySystem() {
  try {
    await ensureSharedInventory();
    if (typeof unsubscribeInventory === 'function') unsubscribeInventory();

    unsubscribeInventory = subscribeSharedInventory(
      (invData) => {
        currentInventory = invData || buildDefaultInventory();
        renderGardenToolbar();
        refreshOpenModals();
      },
      (err) => {
        if (err?.code === 'permission-denied') showFirebaseRulesUpdateNotice();
      }
    );
  } catch (err) {
    if (err?.code === 'permission-denied') showFirebaseRulesUpdateNotice();
  }
}

/* ==========================================================================
   3. Điều Hướng Đa Bản Đồ (5 Khu Riêng) & Cổng Chuyển Cảnh
   ========================================================================== */
function handleMapChanged(mapId) {
  // 1. Đánh dấu nút Map đang đứng trên thanh điều hướng
  document.querySelectorAll('[data-switch-map]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-switch-map') === mapId);
  });

  // 2. Bật thanh công cụ ngữ cảnh tương ứng với từng khu
  document.getElementById('gardenToolbar')?.classList.toggle('hidden', mapId !== 'garden');
  document.getElementById('houseToolbar')?.classList.toggle('hidden', mapId !== 'house');
  document.getElementById('petToolbar')?.classList.toggle('hidden', mapId !== 'pet');
  document.getElementById('shopToolbar')?.classList.toggle('hidden', mapId !== 'shop');

  if (mapId !== 'house') {
    updateHouseEditButtonUI(false);
    document.getElementById('removeSelectedFurnitureBtn')?.classList.add('hidden');
  }

  // 3. Cập nhật gợi ý điều khiển ở chân bản đồ
  const hintEl = document.getElementById('controlsHintText');
  if (hintEl) {
    if (mapId === 'garden') {
      hintEl.innerHTML = '🌻 <strong>Click / Chạm trực tiếp vào ô đất</strong> để Gieo hạt, Tưới nước hoặc Thu hoạch!';
    } else if (mapId === 'house') {
      hintEl.innerHTML = '🏡 Bấm <strong>Kho Đồ</strong> để đặt nội thất • Bật <strong>Kéo sắp xếp</strong> để dời đồ trên sàn!';
    } else if (mapId === 'pet') {
      hintEl.innerHTML = '🐾 <strong>Click / Chạm vào bé thú cưng</strong> đang chạy trên sân để cho ăn & chơi đùa!';
    } else if (mapId === 'shop') {
      hintEl.innerHTML = '🏪 Lại gần <strong>Quầy Mua Hàng</strong> (Phím E) hoặc bấm nút Xem Vật Phẩm ở trên!';
    } else {
      hintEl.innerHTML = '💻 <strong>WASD / Mũi tên</strong> đi bộ • <strong>Phím E</strong> qua cổng • Hoặc <strong>Click trực tiếp</strong> vào khu vực';
    }
  }

  handleZoneChange(null);
  refreshActiveContextToolbars();
}

function refreshActiveContextToolbars() {
  const mapId = islandGame?.getCurrentMapId() || 'island';
  if (mapId === 'garden') renderGardenToolbar();
  else if (mapId === 'house') renderHouseToolbar();
  else if (mapId === 'pet') renderPetToolbar();
}

function refreshOpenModals() {
  if (!document.getElementById('shopModal')?.classList.contains('hidden')) {
    renderShopModalContent();
  }
  if (!document.getElementById('houseModal')?.classList.contains('hidden')) {
    renderHouseModalContent();
  }
  if (!document.getElementById('petModal')?.classList.contains('hidden')) {
    renderPetModalContent();
  }
  if (!document.getElementById('wardrobeModal')?.classList.contains('hidden')) {
    renderWardrobeModalContent();
  }
  if (!document.getElementById('memoryModal')?.classList.contains('hidden')) {
    updateLoveDaysDisplay(currentWorldData?.loveStartDate);
  }
}

function handleZoneChange(zone) {
  const badge = document.getElementById('zoneStatusBadge');
  const interactBtn = document.getElementById('interactZoneBtn');
  const mobileInteractBtn = document.getElementById('mobileInteractBtn');
  const mapMeta = MAP_METADATA[islandGame?.getCurrentMapId() || 'island'] || MAP_METADATA.island;

  if (zone) {
    const actionLabel = zone.targetMap
      ? `${zone.icon} Vào ${zone.name}`
      : `${zone.icon} Mở ${zone.name}`;

    if (badge) {
      badge.textContent = `${zone.icon} Cổng: ${zone.name}`;
      badge.classList.add('active-zone');
    }
    if (interactBtn) {
      interactBtn.textContent = `${actionLabel} (Phím E)`;
      interactBtn.classList.remove('hidden');
    }
    if (mobileInteractBtn) {
      mobileInteractBtn.disabled = false;
      mobileInteractBtn.textContent = actionLabel;
    }
  } else {
    if (badge) {
      badge.textContent = `${mapMeta.icon} Đang ở: ${mapMeta.name}`;
      badge.classList.remove('active-zone');
    }
    interactBtn?.classList.add('hidden');
    if (mobileInteractBtn) {
      mobileInteractBtn.disabled = true;
      mobileInteractBtn.textContent = '✨ Lại gần cổng để tương tác';
    }
  }
}

function handleZoneInteract(zone) {
  if (!zone) return;

  // Nếu là cổng dẫn sang Map riêng của khu (Nhà chung, Khu vườn, Khu thú cưng, Cửa hàng, hoặc Về Đảo Chính)
  if (zone.targetMap) {
    islandGame?.switchMap(zone.targetMap);
    return;
  }

  // Bảng nhiệm vụ trên Đảo Chính
  if (zone.id === 'quest') {
    openQuestModal('quests');
    return;
  }

  // Cây Kỷ Niệm trên Đảo Chính
  if (zone.id === 'memory') {
    openMemoryModal('list');
    return;
  }

  // Quầy thu ngân bên trong Map Cửa Hàng
  if (zone.id === 'shop_counter') {
    openShopModal('seeds');
  }
}

function handlePartnerReaction(reaction) {
  if (!reaction) return;
  const myMap = islandGame?.getCurrentMapId() || 'island';
  const mapInfo = MAP_METADATA[reaction.mapId] || MAP_METADATA.island;

  // Nếu người thương đang ở một khu vực khác, bật thông báo nhỏ dễ thương để không bỏ lỡ lời nhắn!
  if (reaction.mapId !== myMap) {
    if (reaction.type === 'chat') {
      showToast(`💬 ${reaction.name} (${mapInfo.name}): "${reaction.text}"`, 'info', 5000);
    } else if (reaction.type === 'emote') {
      showToast(`${reaction.emote} ${reaction.name} vừa thả biểu cảm từ ${mapInfo.name}!`, 'info', 3500);
    }
  }
}

function handlePartnerOnlineChange(isOnline, partnerName, partnerMapId = 'island') {
  const badge = document.getElementById('partnerOnlineBadge');
  const textEl = document.getElementById('partnerOnlineText');
  if (!badge) return;

  if (isOnline) {
    const mapInfo = MAP_METADATA[partnerMapId] || MAP_METADATA.island;
    if (textEl) {
      textEl.textContent = `${partnerName} • ${mapInfo.icon} ${mapInfo.name}`;
    }
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/* ==========================================================================
   4. KHU VƯỜN RIÊNG (Mở Sẵn 6 Ô Đất -> Mở Khóa Tối Đa 54 Ô Đất)
   ========================================================================== */
function renderGardenToolbar() {
  const seedBar = document.getElementById('gardenSeedBar');
  const summaryEl = document.getElementById('gardenPlotSummary');
  const unlockBtn = document.getElementById('unlockGardenPlotBtn');
  if (!seedBar) return;

  const seedsBag = currentInventory?.seeds || {};

  // Nếu hạt đang chọn đã hết mà trong túi có loại hạt khác còn tồn, giữ lựa chọn nhưng hiển thị rõ số lượng
  seedBar.innerHTML = SEED_CATALOG.map((seed) => {
    const count = Number(seedsBag[seed.id] || 0);
    const isActive = seed.id === selectedSeedId;
    return `
      <button
        type="button"
        class="seed-pill ${isActive ? 'active' : ''} ${count === 0 ? 'empty-stock' : ''}"
        data-select-seed="${escapeHtml(seed.id)}"
        title="${escapeHtml(seed.description)}"
      >
        <span>${seed.icon}</span>
        <span>${escapeHtml(seed.name.replace('Hạt ', ''))}</span>
        <span class="seed-count-tag">x${count}</span>
      </button>
    `;
  }).join('') + `
    <button type="button" class="seed-pill" data-open-seed-shop="1" style="border-style:dashed">
      ➕ 🏪 Mua hạt
    </button>
  `;

  const garden = getNormalizedGarden(currentWorldData);
  if (summaryEl) {
    summaryEl.textContent = `🌻 Đã mở ${garden.unlockedCount}/${MAX_GARDEN_PLOTS} ô đất • Chạm ô trống để gieo, ô đang lớn để tưới 💧, ô chín để thu hoạch!`;
  }

  if (unlockBtn) {
    if (garden.unlockedCount >= MAX_GARDEN_PLOTS) {
      unlockBtn.disabled = true;
      unlockBtn.textContent = `✅ Đã mở tối đa ${MAX_GARDEN_PLOTS}/${MAX_GARDEN_PLOTS} ô`;
    } else {
      const nextCost = getNextPlotUnlockCost(garden.unlockedCount);
      unlockBtn.disabled = false;
      unlockBtn.textContent = `🔓 Mở ô đất #${garden.unlockedCount + 1} (${nextCost} ❤️)`;
    }
  }
}

async function promptUnlockGardenPlot() {
  if (!currentWorldData || !navigator.onLine) {
    showToast('Cần kết nối Internet để mở thêm ô đất.', 'warning');
    return;
  }

  const garden = getNormalizedGarden(currentWorldData);
  if (garden.unlockedCount >= MAX_GARDEN_PLOTS) {
    showToast(`Khu vườn đã mở tối đa ${MAX_GARDEN_PLOTS} ô đất rồi!`, 'info');
    return;
  }

  const nextNumber = garden.unlockedCount + 1;
  const cost = getNextPlotUnlockCost(garden.unlockedCount);

  const ok = await showConfirm({
    title: `🌻 Mở thêm ô đất #${nextNumber}/${MAX_GARDEN_PLOTS}?`,
    message: `Dùng ${cost} Điểm yêu thương (❤️) để mở rộng vĩnh viễn ô đất thứ #${nextNumber} cho khu vườn chung của hai bạn nhé?`,
    confirmText: `Mở ngay (${cost} ❤️)`,
    cancelText: 'Để sau'
  });
  if (!ok) return;

  const unlockBtn = document.getElementById('unlockGardenPlotBtn');
  setButtonLoading(unlockBtn, true, 'Đang mở...');
  try {
    const res = await unlockNextGardenPlot(currentUserProfile);
    islandGame?.spawnFloatingEffect(`🔓 Đã mở ô đất #${res.unlockedCount}!`, '#2d6a4f');
    showToast(`🌻 Đã mở khóa ô đất #${res.unlockedCount}/${MAX_GARDEN_PLOTS}!`, 'success');
  } catch (err) {
    handleActionError(err);
  } finally {
    setButtonLoading(unlockBtn, false);
    renderGardenToolbar();
  }
}

async function handleGardenPlotClick(plot) {
  if (!plot || !currentWorldData || plotActionBusy) return;

  if (!navigator.onLine) {
    showToast('Cần kết nối Internet để chăm sóc khu vườn.', 'warning');
    return;
  }

  const garden = getNormalizedGarden(currentWorldData);

  // 1. Nếu người chơi chạm vào ô đất đang khóa (từ ô 7 -> 54) -> Hỏi mở khóa ô tiếp theo
  if (plot.index >= garden.unlockedCount) {
    await promptUnlockGardenPlot();
    return;
  }

  const plotData = garden.plots[String(plot.index)];
  const crop = evaluatePlotCrop(plotData, Date.now());

  plotActionBusy = true;
  try {
    // 2. Ô trống -> Gieo hạt giống đang chọn từ Túi đồ chung
    if (crop.status === 'empty') {
      const stock = Number(currentInventory?.seeds?.[selectedSeedId] || 0);
      const seedInfo = SEED_CATALOG.find((s) => s.id === selectedSeedId) || SEED_CATALOG[0];

      if (stock < 1) {
        const anyOtherSeed = SEED_CATALOG.find((s) => Number(currentInventory?.seeds?.[s.id] || 0) > 0);
        if (anyOtherSeed) {
          showToast(
            `Đã hết ${seedInfo.name}! Hãy chọn "${anyOtherSeed.name}" trên thanh hạt giống hoặc vào Cửa hàng mua thêm nhé.`,
            'info'
          );
        } else {
          showToast('Túi hạt giống đã hết! Mình mở Cửa hàng để mua thêm hạt giống nhé 🌱', 'info');
          openShopModal('seeds');
        }
        return;
      }

      const planted = await plantSeedInGarden({
        plotIndex: plot.index,
        seedId: selectedSeedId,
        userProfile: currentUserProfile
      });
      islandGame?.spawnFloatingEffect(`${planted.icon} Đã gieo hạt!`, '#2d6a4f', plot.cx, plot.cy);
      return;
    }

    // 3. Ô đang lớn -> Tưới nước rút ngắn 25% thời gian & tính tiến độ Nhiệm vụ hằng ngày
    if (crop.status === 'growing') {
      if (crop.watered) {
        islandGame?.spawnFloatingEffect(`⏳ Còn ${crop.remainSec}s chín`, '#40916c', plot.cx, plot.cy);
        return;
      }

      const waterRes = await waterGardenPlot(plot.index);
      if (!waterRes.alreadyWatered) {
        islandGame?.spawnFloatingEffect('💧 Tưới mát (-25% giờ)!', '#2d6a4f', plot.cx, plot.cy);
        const qRes = await progressIslandQuest('water_plants').catch(() => null);
        if (qRes?.justCompleted) {
          showToast('🎉 Hoàn thành nhiệm vụ "Tưới cây khu vườn"! Mở 📋 Nhiệm vụ để nhận +20 ❤️ nhé!', 'success');
        }
      }
      return;
    }

    // 4. Ô đã chín -> Thu hoạch nhận Điểm yêu thương & tính tiến độ Nhiệm vụ thu hoạch
    if (crop.status === 'ripe') {
      const harvestRes = await harvestGardenPlot({
        plotIndex: plot.index,
        userProfile: currentUserProfile
      });
      islandGame?.spawnFloatingEffect(
        `${harvestRes.seed.icon} +${harvestRes.reward} ❤️`,
        '#d94d72',
        plot.cx,
        plot.cy
      );
      const qRes = await progressIslandQuest('harvest_crops').catch(() => null);
      if (qRes?.justCompleted) {
        showToast(
          `🧺 Thu hoạch +${harvestRes.reward} ❤️ & hoàn thành nhiệm vụ "Thu hoạch mùa màng" (+25 ❤️)!`,
          'success',
          4000
        );
      } else {
        showToast(
          `🧺 Thu hoạch ${harvestRes.seed.name} nhận +${harvestRes.reward} Điểm yêu thương!`,
          'success',
          3000
        );
      }
    }
  } catch (err) {
    handleActionError(err);
  } finally {
    plotActionBusy = false;
  }
}

/* ==========================================================================
   5. CỬA HÀNG ĐẢO (Vật Phẩm Trang Trí & Hạt Giống)
   ========================================================================== */
function openShopModal(tab = 'seeds') {
  activeShopTab = tab;
  document.getElementById('shopModal')?.classList.remove('hidden');
  renderShopModalContent();
}

function closeShopModal() {
  document.getElementById('shopModal')?.classList.add('hidden');
}

function renderShopModalContent() {
  document.querySelectorAll('[data-shop-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-shop-tab') === activeShopTab);
  });

  const grid = document.getElementById('shopItemsGrid');
  if (!grid) return;

  const seedsBag = currentInventory?.seeds || {};
  const decorBag = currentInventory?.decor || {};

  if (activeShopTab === 'seeds') {
    grid.innerHTML = SEED_CATALOG.map((seed) => {
      const owned = Number(seedsBag[seed.id] || 0);
      const growLabel = seed.growSeconds >= 60 ? `${seed.growSeconds / 60} phút` : `${seed.growSeconds} giây`;
      return `
        <article class="catalog-card">
          <div>
            <div class="catalog-top">
              <div class="catalog-icon-box">${seed.icon}</div>
              <div class="catalog-info">
                <div class="catalog-name">${escapeHtml(seed.name)}</div>
                <p class="catalog-desc">${escapeHtml(seed.description)}</p>
              </div>
            </div>
            <div class="catalog-meta-row">
              <span class="price-tag">Giá: ${seed.price} ❤️ • Lớn: ${growLabel}</span>
              <span class="owned-tag">Túi có: ${owned}</span>
            </div>
          </div>
          <div class="catalog-btn-row">
            <button type="button" class="btn btn-primary btn-sm" data-buy-item="${escapeHtml(seed.id)}" data-buy-qty="1">
              Mua x1 (${seed.price} ❤️)
            </button>
            <button type="button" class="btn btn-mint btn-sm" data-buy-item="${escapeHtml(seed.id)}" data-buy-qty="5">
              Mua x5 (${seed.price * 5} ❤️)
            </button>
          </div>
        </article>
      `;
    }).join('');
    return;
  }

  if (activeShopTab === 'furniture') {
    const items = DECOR_CATALOG.filter((d) => d.category === 'furniture' || d.category === 'plant');
    grid.innerHTML = items.map((item) => {
      const owned = Number(decorBag[item.id] || 0);
      return `
        <article class="catalog-card">
          <div>
            <div class="catalog-top">
              <div class="catalog-icon-box" style="background:${item.color}">${item.icon}</div>
              <div class="catalog-info">
                <div class="catalog-name">${escapeHtml(item.name)}</div>
                <p class="catalog-desc">${escapeHtml(item.description)}</p>
              </div>
            </div>
            <div class="catalog-meta-row">
              <span class="price-tag">${item.price} ❤️</span>
              <span class="owned-tag">Đang sở hữu: ${owned}</span>
            </div>
          </div>
          <div class="catalog-btn-row">
            <button type="button" class="btn btn-primary btn-sm" data-buy-item="${escapeHtml(item.id)}" data-buy-qty="1">
              🛍️ Mua trang trí (${item.price} ❤️)
            </button>
          </div>
        </article>
      `;
    }).join('');
    return;
  }

  if (activeShopTab === 'surfaces') {
    const surfaces = DECOR_CATALOG.filter((d) => d.category === 'wallpaper' || d.category === 'floor');
    grid.innerHTML = surfaces.map((item) => {
      const isOwned = item.price === 0 || Number(decorBag[item.id] || 0) >= 1;
      const typeLabel = item.category === 'wallpaper' ? 'Giấy dán tường' : 'Sàn nhà';
      return `
        <article class="catalog-card ${isOwned ? 'owned-active' : ''}">
          <div>
            <div class="catalog-top">
              <div class="catalog-icon-box" style="background:${item.color}">${item.icon}</div>
              <div class="catalog-info">
                <div class="catalog-name">${escapeHtml(item.name)}</div>
                <p class="catalog-desc">${typeLabel} • ${escapeHtml(item.description)}</p>
              </div>
            </div>
            <div class="catalog-meta-row">
              <span class="price-tag">${item.price === 0 ? 'Mặc định' : `${item.price} ❤️`}</span>
              <span class="owned-tag">${isOwned ? 'Đã có trong kho ✅' : 'Chưa sở hữu'}</span>
            </div>
          </div>
          <div class="catalog-btn-row">
            ${
              isOwned
                ? `<button type="button" class="btn btn-mint btn-sm" data-apply-surface-from-shop="${escapeHtml(item.id)}">
                     🏡 Áp dụng cho Nhà Chung
                   </button>`
                : `<button type="button" class="btn btn-primary btn-sm" data-buy-item="${escapeHtml(item.id)}" data-buy-qty="1">
                     🛍️ Mua mẫu này (${item.price} ❤️)
                   </button>`
            }
          </div>
        </article>
      `;
    }).join('');
    return;
  }

  // Tab Đồ Đôi Nhân Vật & Phụ Kiện Thú Cưng
  const wardrobeBag = currentInventory?.wardrobe || {};
  const petAccBag = currentInventory?.petAccessories || {};
  const paidWardrobe = OUTFIT_CATALOG.filter((o) => o.price > 0);

  const wardrobeCards = paidWardrobe.map((item) => {
    const isOwned = Number(wardrobeBag[item.id] || 0) >= 1;
    const typeLabel = item.category === 'outfit' ? 'Trang phục đôi' : 'Phụ kiện cài tóc';
    const previewBg = item.shirt || '#fff0f5';
    return `
      <article class="catalog-card ${isOwned ? 'owned-active' : ''}">
        <div>
          <div class="catalog-top">
            <div class="catalog-icon-box" style="background:${previewBg}">${item.icon}</div>
            <div class="catalog-info">
              <div class="catalog-name">${escapeHtml(item.name)}</div>
              <p class="catalog-desc">${typeLabel} • ${escapeHtml(item.description)}</p>
            </div>
          </div>
          <div class="catalog-meta-row">
            <span class="price-tag">${item.price} ❤️</span>
            <span class="owned-tag">${isOwned ? 'Đã có trong Tủ đồ ✅' : 'Mở 1 lần mặc cả hai'}</span>
          </div>
        </div>
        <div class="catalog-btn-row">
          ${
            isOwned
              ? `<button type="button" class="btn btn-mint btn-sm" data-equip-from-shop="${escapeHtml(item.id)}">
                   👗 Mặc ngay
                 </button>`
              : `<button type="button" class="btn btn-primary btn-sm" data-buy-item="${escapeHtml(item.id)}" data-buy-qty="1">
                   🛍️ Mở khóa (${item.price} ❤️)
                 </button>`
          }
        </div>
      </article>
    `;
  }).join('');

  const petAccCards = PET_ACCESSORY_CATALOG.map((acc) => {
    const owned = Number(petAccBag[acc.id] || 0);
    return `
      <article class="catalog-card">
        <div>
          <div class="catalog-top">
            <div class="catalog-icon-box" style="background:#fef6e4">${acc.icon}</div>
            <div class="catalog-info">
              <div class="catalog-name">${escapeHtml(acc.name)}</div>
              <p class="catalog-desc">Phụ kiện thú cưng • ${escapeHtml(acc.description)}</p>
            </div>
          </div>
          <div class="catalog-meta-row">
            <span class="price-tag">${acc.price} ❤️</span>
            <span class="owned-tag">Túi có: ${owned}</span>
          </div>
        </div>
        <div class="catalog-btn-row">
          <button type="button" class="btn btn-primary btn-sm" data-buy-item="${escapeHtml(acc.id)}" data-buy-qty="1">
            🐾 Mua cho thú cưng (${acc.price} ❤️)
          </button>
        </div>
      </article>
    `;
  }).join('');

  grid.innerHTML = wardrobeCards + petAccCards;
}

/* ==========================================================================
   6. KHU NHÀ CHUNG (Trang Trí Tường/Sàn, Đặt/Kéo Đồ & Nâng Cấp Nhà 1 -> 4)
   ========================================================================== */
function renderHouseToolbar() {
  const house = getNormalizedHouse(currentWorldData);
  const cfg = HOUSE_LEVELS[house.level] || HOUSE_LEVELS[1];

  const summaryEl = document.getElementById('houseLevelSummary');
  if (summaryEl) {
    summaryEl.textContent = `🏡 Cấp ${house.level}: ${cfg.name} (${house.placedItems.length}/${cfg.maxFurniture} món đang bày)`;
  }

  const upgradeBtn = document.getElementById('openHouseUpgradeBtn');
  if (upgradeBtn) {
    if (house.level >= MAX_HOUSE_LEVEL) {
      upgradeBtn.textContent = '👑 Nhà Cấp Tối Đa';
    } else {
      const nextCfg = HOUSE_LEVELS[house.level + 1];
      upgradeBtn.textContent = `⬆️ Nâng Cấp ${house.level + 1} (${nextCfg.upgradeCost} ❤️)`;
    }
  }
}

function updateHouseEditButtonUI(isActive) {
  const btn = document.getElementById('toggleHouseEditBtn');
  if (!btn) return;
  btn.classList.toggle('btn-edit-active', isActive);
  btn.textContent = isActive ? '✋ Kéo sắp xếp: ĐANG BẬT' : '✋ Kéo sắp xếp: Tắt';
}

function handleFurnitureSelected(hit) {
  const removeBtn = document.getElementById('removeSelectedFurnitureBtn');
  if (!removeBtn) return;
  if (hit && hit.info) {
    removeBtn.textContent = `📥 Cất "${hit.info.name}"`;
    removeBtn.classList.remove('hidden');
  } else {
    removeBtn.classList.add('hidden');
  }
}

function openHouseModal(tab = 'furniture') {
  activeHouseTab = tab;
  document.getElementById('houseModal')?.classList.remove('hidden');
  renderHouseModalContent();
}

function closeHouseModal() {
  document.getElementById('houseModal')?.classList.add('hidden');
}

function renderHouseModalContent() {
  const house = getNormalizedHouse(currentWorldData);
  const cfg = HOUSE_LEVELS[house.level] || HOUSE_LEVELS[1];
  const points = Number(currentWorldData?.lovePoints || 0).toLocaleString('vi-VN');

  const subEl = document.getElementById('houseModalSubtitle');
  if (subEl) {
    subEl.innerHTML = `Cấp ${house.level}: <strong>${escapeHtml(cfg.name)}</strong> (${house.placedItems.length}/${cfg.maxFurniture} món) • Quỹ điểm: <strong class="pink-strong"><span id="houseBalanceValue">${points}</span> ❤️</strong>`;
  }

  document.querySelectorAll('[data-house-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-house-tab') === activeHouseTab);
  });

  document.getElementById('housePanelFurniture')?.classList.toggle('hidden', activeHouseTab !== 'furniture');
  document.getElementById('housePanelSurfaces')?.classList.toggle('hidden', activeHouseTab !== 'surfaces');
  document.getElementById('housePanelUpgrade')?.classList.toggle('hidden', activeHouseTab !== 'upgrade');

  const decorBag = currentInventory?.decor || {};

  // Tab 1: Đặt nội thất & cây cảnh từ Kho ra phòng
  if (activeHouseTab === 'furniture') {
    const furnitureList = DECOR_CATALOG.filter((d) => d.category === 'furniture' || d.category === 'plant');
    const ownedItems = furnitureList.filter((d) => Number(decorBag[d.id] || 0) > 0);
    const bagContainer = document.getElementById('houseFurnitureBagList');
    if (!bagContainer) return;

    if (!ownedItems.length) {
      bagContainer.innerHTML = `
        <div class="empty-state-box" style="grid-column: 1 / -1">
          🛋️ Kho nội thất của hai bạn chưa có món nào.<br>
          Hãy ghé Cửa hàng sắm Sofa, Giường đôi, Bàn trà hoặc Cây cảnh nhé!
          <div style="margin-top:12px">
            <button type="button" class="btn btn-primary btn-sm" data-goto-shop-tab="furniture">
              🏪 Mở Cửa Hàng Nội Thất
            </button>
          </div>
        </div>
      `;
      return;
    }

    bagContainer.innerHTML = ownedItems.map((item) => {
      const ownedCount = Number(decorBag[item.id] || 0);
      const placedMatches = house.placedItems.filter((p) => p.itemId === item.id);
      const placedCount = placedMatches.length;
      const remain = Math.max(0, ownedCount - placedCount);
      const lastPlacedUid = placedMatches.length ? placedMatches[placedMatches.length - 1].uid : '';

      return `
        <article class="catalog-card">
          <div>
            <div class="catalog-top">
              <div class="catalog-icon-box" style="background:${item.color}">${item.icon}</div>
              <div class="catalog-info">
                <div class="catalog-name">${escapeHtml(item.name)}</div>
                <p class="catalog-desc">${escapeHtml(item.description)}</p>
              </div>
            </div>
            <div class="catalog-meta-row">
              <span class="owned-tag">Sở hữu: ${ownedCount}</span>
              <span class="price-tag">Đang đặt: ${placedCount} • Còn trống: ${remain}</span>
            </div>
          </div>
          <div class="catalog-btn-row">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              data-place-furniture="${escapeHtml(item.id)}"
              ${remain <= 0 ? 'disabled' : ''}
            >
              ➕ Đặt ra phòng
            </button>
            ${
              placedCount > 0
                ? `<button type="button" class="btn btn-outline btn-sm" data-unplace-uid="${escapeHtml(lastPlacedUid)}">
                     📥 Cất bớt 1
                   </button>`
                : ''
            }
          </div>
        </article>
      `;
    }).join('');
    return;
  }

  // Tab 2: Đổi Giấy dán tường & Sàn nhà
  if (activeHouseTab === 'surfaces') {
    const surfaceContainer = document.getElementById('houseSurfacesList');
    if (!surfaceContainer) return;

    const surfaces = DECOR_CATALOG.filter((d) => d.category === 'wallpaper' || d.category === 'floor');
    surfaceContainer.innerHTML = surfaces.map((item) => {
      const owned = item.price === 0 || Number(decorBag[item.id] || 0) >= 1;
      const isApplied = house.wallpaper === item.id || house.floor === item.id;
      const catName = item.category === 'wallpaper' ? 'Giấy dán tường' : 'Sàn nhà';

      return `
        <article class="catalog-card ${isApplied ? 'owned-active' : ''}">
          <div>
            <div class="catalog-top">
              <div class="catalog-icon-box" style="background:${item.color}">${item.icon}</div>
              <div class="catalog-info">
                <div class="catalog-name">${escapeHtml(item.name)}</div>
                <p class="catalog-desc">${catName} • ${escapeHtml(item.description)}</p>
              </div>
            </div>
            <div class="catalog-meta-row">
              <span class="owned-tag">${isApplied ? '✨ Đang trang trí' : owned ? 'Đã sở hữu' : `Giá ${item.price} ❤️`}</span>
            </div>
          </div>
          <div class="catalog-btn-row">
            ${
              isApplied
                ? `<button type="button" class="btn btn-mint btn-sm" disabled>✅ Đang sử dụng</button>`
                : owned
                  ? `<button type="button" class="btn btn-primary btn-sm" data-apply-surface="${escapeHtml(item.id)}">
                       🎨 Đổi sang mẫu này
                     </button>`
                  : `<button type="button" class="btn btn-outline btn-sm" data-goto-shop-tab="surfaces">
                       🏪 Mua ở Cửa hàng (${item.price} ❤️)
                     </button>`
            }
          </div>
        </article>
      `;
    }).join('');
    return;
  }

  // Tab 3: Nâng cấp Ngôi nhà chung (Cấp 1 -> Cấp 4)
  const upContainer = document.getElementById('houseUpgradeContainer');
  if (!upContainer) return;

  upContainer.innerHTML = [1, 2, 3, 4].map((lv) => {
    const info = HOUSE_LEVELS[lv];
    const isCurrent = lv === house.level;
    const isUnlocked = lv < house.level;
    const isNext = lv === house.level + 1;

    let actionBtn = '';
    if (isCurrent) {
      actionBtn = `<span class="claimed-pill">🏡 Cấp hiện tại</span>`;
    } else if (isUnlocked) {
      actionBtn = `<span class="claimed-pill">✅ Đã mở</span>`;
    } else if (isNext) {
      actionBtn = `
        <button type="button" class="btn btn-primary btn-sm" data-confirm-house-upgrade="1">
          ⬆️ Nâng cấp (${info.upgradeCost} ❤️)
        </button>
      `;
    } else {
      actionBtn = `<span class="claimed-pill" style="background:#f3eae0;color:#8c7a6e">🔒 Mở Cấp ${lv - 1} trước</span>`;
    }

    return `
      <div class="upgrade-card ${isCurrent ? 'current-level' : ''} ${isNext ? 'next-level' : ''}">
        <div>
          <div class="quest-title-row">
            <span class="quest-title">Cấp ${lv}: ${escapeHtml(info.name)}</span>
            <span class="quest-reward-tag">Tối đa ${info.maxFurniture} nội thất</span>
          </div>
          <p class="upgrade-specs">
            📐 Diện tích phòng: ${info.roomW}×${info.roomH} • ${escapeHtml(info.perk)}
          </p>
        </div>
        <div class="quest-action">${actionBtn}</div>
      </div>
    `;
  }).join('');
}

/* ==========================================================================
   7. KHU THÚ CƯNG (Vui Chơi & Chăm Sóc Tối Đa 10 Con)
   ========================================================================== */
function renderPetToolbar() {
  const pets = getNormalizedPets(currentWorldData);
  const summaryEl = document.getElementById('petCountSummary');
  if (summaryEl) {
    summaryEl.textContent = pets.length === 0
      ? '🐾 Chưa có bé thú cưng nào • Bấm "➕ Đón thú cưng mới" để nhận bé đầu tiên MIỄN PHÍ!'
      : `🐾 Đang có ${pets.length}/${MAX_PETS} bé trên sân • Chạm vào thú cưng để cho ăn & chơi đùa!`;
  }
}

function handlePetCanvasClick(pet) {
  if (!pet) return;
  triggerPetExcitedJump(pet.id);
  selectedPetId = pet.id;
  openPetModal('care');
}

function openPetModal(tab = 'care') {
  activePetTab = tab;
  isRenamingPetInline = false;
  document.getElementById('petModal')?.classList.remove('hidden');
  renderPetModalContent();

  clearInterval(petStatsRefreshTimer);
  petStatsRefreshTimer = setInterval(() => {
    if (!document.getElementById('petModal')?.classList.contains('hidden') && activePetTab === 'care' && !isRenamingPetInline) {
      renderPetModalContent();
    }
  }, 15000);
}

function closePetModal() {
  clearInterval(petStatsRefreshTimer);
  document.getElementById('petModal')?.classList.add('hidden');
}

function renderPetModalContent() {
  const pets = getNormalizedPets(currentWorldData);
  const subEl = document.getElementById('petModalSubtitle');
  if (subEl) subEl.textContent = `Đang nuôi ${pets.length}/${MAX_PETS} bé`;

  document.querySelectorAll('[data-pet-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-pet-tab') === activePetTab);
  });

  document.getElementById('petPanelCare')?.classList.toggle('hidden', activePetTab !== 'care');
  document.getElementById('petPanelAdopt')?.classList.toggle('hidden', activePetTab !== 'adopt');

  if (activePetTab === 'care') {
    const selectorEl = document.getElementById('petSelectorList');
    const detailEl = document.getElementById('petDetailContainer');
    if (!selectorEl || !detailEl) return;

    if (pets.length === 0) {
      selectorEl.innerHTML = '';
      detailEl.innerHTML = `
        <div class="empty-state-box">
          🐱 Sân chơi chưa có bé thú cưng nào.<br>
          Bé thú cưng đầu tiên được nhận nuôi hoàn toàn <strong>MIỄN PHÍ (0 ❤️)</strong>!
          <div style="margin-top:12px">
            <button type="button" class="btn btn-primary btn-sm" data-switch-adopt-tab="1">
              ➕ Đón bé đầu tiên ngay
            </button>
          </div>
        </div>
      `;
      return;
    }

    if (!selectedPetId || !pets.some((p) => p.id === selectedPetId)) {
      selectedPetId = pets[0].id;
    }

    selectorEl.innerHTML = pets.map((p) => {
      const sp = PET_SPECIES[p.type] || PET_SPECIES.cat;
      return `
        <button
          type="button"
          class="pet-pill ${p.id === selectedPetId ? 'active' : ''}"
          data-select-pet="${escapeHtml(p.id)}"
        >
          <span>${sp.icon}</span>
          <span>${escapeHtml(p.name)}</span>
        </button>
      `;
    }).join('');

    const activePet = pets.find((p) => p.id === selectedPetId) || pets[0];
    const sp = PET_SPECIES[activePet.type] || PET_SPECIES.cat;
    const live = computePetLiveStats(activePet, Date.now());

    detailEl.innerHTML = `
      <div class="pet-detail-card">
        <div class="pet-header-row">
          <div class="pet-identity">
            <div class="pet-avatar-big">${sp.icon}</div>
            <div>
              <div class="quest-title-row" style="margin-bottom:2px">
                <span class="quest-title" style="font-size:1.06rem">${escapeHtml(activePet.name)}</span>
                <button type="button" class="btn-icon-soft" style="width:26px;height:26px;font-size:0.76rem" data-toggle-pet-rename="1" title="Đổi tên thú cưng">
                  ✏️
                </button>
              </div>
              <div class="tx-meta">${escapeHtml(sp.name)} • Đón bởi ${escapeHtml(activePet.adoptedBy || 'Cư dân')}</div>
            </div>
          </div>
          <span class="pet-mood-pill">${escapeHtml(live.mood)}</span>
        </div>

        ${
          isRenamingPetInline
            ? `<div class="pet-rename-inline">
                 <input type="text" id="inlinePetNameInput" class="form-input" style="padding:8px 12px" maxlength="18" value="${escapeHtml(activePet.name)}">
                 <button type="button" class="btn btn-mint btn-sm" data-save-pet-rename="${escapeHtml(activePet.id)}">Lưu tên</button>
               </div>`
            : ''
        }

        <div class="pet-stats-box">
          <div class="pet-stat-row">
            <span>🍖 Độ no</span>
            <div class="pet-stat-bar"><div class="pet-stat-fill hunger" style="width:${live.hunger}%"></div></div>
            <span>${live.hunger}%</span>
          </div>
          <div class="pet-stat-row">
            <span>💖 Hạnh phúc</span>
            <div class="pet-stat-bar"><div class="pet-stat-fill happiness" style="width:${live.happiness}%"></div></div>
            <span>${live.happiness}%</span>
          </div>
          <div class="pet-stat-row">
            <span>⚡ Năng lượng</span>
            <div class="pet-stat-bar"><div class="pet-stat-fill energy" style="width:${live.energy}%"></div></div>
            <span>${live.energy}%</span>
          </div>
        </div>

        <div class="pet-care-grid">
          <button type="button" class="btn btn-primary btn-sm" data-pet-care="feed" data-pet-id="${escapeHtml(activePet.id)}">
            🍖 Cho ăn
          </button>
          <button type="button" class="btn btn-outline btn-sm" data-pet-care="pet" data-pet-id="${escapeHtml(activePet.id)}">
            🤚 Vuốt ve
          </button>
          <button type="button" class="btn btn-mint btn-sm" data-pet-care="play" data-pet-id="${escapeHtml(activePet.id)}">
            🎾 Chơi đùa
          </button>
          <button type="button" class="btn btn-outline btn-sm" data-pet-care="rest" data-pet-id="${escapeHtml(activePet.id)}">
            💤 Nghỉ ngơi
          </button>
        </div>

        <div class="pet-accessory-box">
          <div class="pet-accessory-label">
            <span>🎀 Phụ kiện diện cho ${escapeHtml(activePet.name)}:</span>
            <button type="button" class="btn btn-outline btn-sm" style="padding:3px 10px;font-size:0.76rem" data-goto-pet-acc-shop="1">
              🏪 Sắm thêm phụ kiện
            </button>
          </div>
          <div class="pet-acc-pills">
            <button
              type="button"
              class="pet-acc-pill ${!activePet.accessoryId ? 'equipped' : ''}"
              data-equip-pet-acc=""
              data-pet-id="${escapeHtml(activePet.id)}"
            >
              🐾 Tự nhiên
            </button>
            ${PET_ACCESSORY_CATALOG.map((acc) => {
              const ownedCount = Number(currentInventory?.petAccessories?.[acc.id] || 0);
              const usedOthers = pets.filter((p) => p.id !== activePet.id && p.accessoryId === acc.id).length;
              const avail = Math.max(0, ownedCount - usedOthers);
              const isEquipped = activePet.accessoryId === acc.id;
              return `
                <button
                  type="button"
                  class="pet-acc-pill ${isEquipped ? 'equipped' : ''}"
                  data-equip-pet-acc="${escapeHtml(acc.id)}"
                  data-pet-id="${escapeHtml(activePet.id)}"
                  data-acc-avail="${isEquipped ? 1 : avail}"
                >
                  <span>${acc.icon}</span>
                  <span>${escapeHtml(acc.name)}</span>
                  <span class="seed-count-tag">${isEquipped ? 'Đang đeo' : `còn ${avail}`}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Tab Nhận nuôi thú cưng mới (Tối đa 10 bé)
  const costBanner = document.getElementById('adoptCostNotice');
  const speciesGrid = document.getElementById('adoptSpeciesGrid');
  const submitBtn = document.getElementById('adoptPetSubmitBtn');

  if (costBanner) {
    if (pets.length === 0) {
      costBanner.innerHTML = '🎁 <strong>Ưu đãi hòn đảo:</strong> Bé thú cưng đầu tiên hoàn toàn <strong>MIỄN PHÍ (0 ❤️)</strong>!';
    } else if (pets.length >= MAX_PETS) {
      costBanner.innerHTML = `🏡 Khu thú cưng đã đông vui tối đa <strong>${MAX_PETS}/${MAX_PETS} bé</strong> rồi!`;
    } else {
      costBanner.innerHTML = `💝 Đang có <strong>${pets.length}/${MAX_PETS} bé</strong> • Phí đón bé thứ #${pets.length + 1}: <strong>${PET_ADOPT_COST} ❤️</strong>`;
    }
  }

  if (speciesGrid) {
    speciesGrid.innerHTML = Object.values(PET_SPECIES).map((sp) => `
      <button
        type="button"
        class="species-card ${sp.id === selectedAdoptSpecies ? 'selected' : ''}"
        data-choose-species="${escapeHtml(sp.id)}"
      >
        <span class="species-emoji">${sp.icon}</span>
        <span class="species-title">${escapeHtml(sp.name)}</span>
      </button>
    `).join('');
  }

  if (submitBtn) {
    submitBtn.disabled = pets.length >= MAX_PETS;
    const cost = pets.length === 0 ? 0 : PET_ADOPT_COST;
    submitBtn.textContent = pets.length >= MAX_PETS
      ? `Đã đạt tối đa ${MAX_PETS} bé`
      : cost === 0
        ? '🐾 Đón bé đầu tiên (Miễn phí 0 ❤️)'
        : `🐾 Đón bé về sân (${cost} ❤️)`;
  }
}

/* ==========================================================================
   8. Hệ Thống Nhiệm Vụ Hằng Ngày (UTC+7) & Lịch Sử Điểm
   ========================================================================== */
async function initDailyQuestSystem() {
  try {
    activeDateKey = await ensureTodayQuestsInitialized();
    attachQuestListener(activeDateKey);

    clearInterval(midnightCheckTimer);
    midnightCheckTimer = setInterval(async () => {
      const nowDateKey = getVietnamDateKey();
      if (nowDateKey !== activeDateKey) {
        activeDateKey = await ensureTodayQuestsInitialized();
        attachQuestListener(activeDateKey);
        showToast('🌅 Sang ngày mới rồi! Nhiệm vụ hằng ngày trên đảo đã được làm mới.', 'info', 4500);
      }
    }, 30000);
  } catch (err) {
    if (err?.code === 'permission-denied') {
      showFirebaseRulesUpdateNotice();
    }
  }
}

function attachQuestListener(dateKey) {
  if (typeof unsubscribeQuests === 'function') {
    unsubscribeQuests();
  }

  const subtitleEl = document.getElementById('questDateSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `Ngày ${formatVietnamDate(dateKey)} • Làm mới 00:00 (UTC+7)`;
  }

  unsubscribeQuests = subscribeTodayQuests(
    dateKey,
    (questData) => {
      currentQuestData = questData;
      renderQuestListAndBadge(questData);
    },
    (err) => {
      if (err?.code === 'permission-denied') {
        showFirebaseRulesUpdateNotice();
      }
    }
  );
}

function renderQuestListAndBadge(questData) {
  const items = questData?.items || {};

  let claimableCount = 0;
  for (const def of DAILY_QUEST_DEFS) {
    const st = items[def.id];
    if (st?.completed && !st?.claimed) {
      claimableCount += 1;
    }
  }

  const badgeEl = document.getElementById('questClaimBadge');
  if (badgeEl) {
    if (claimableCount > 0) {
      badgeEl.textContent = String(claimableCount);
      badgeEl.classList.remove('hidden');
    } else {
      badgeEl.classList.add('hidden');
    }
  }

  const listEl = document.getElementById('questListContainer');
  if (!listEl) return;

  listEl.innerHTML = DAILY_QUEST_DEFS.map((def) => {
    const state = items[def.id] || {
      progress: 0,
      target: def.target,
      reward: def.reward,
      completed: false,
      claimed: false
    };

    const pct = Math.min(100, Math.round(((state.progress || 0) / def.target) * 100));
    const cardStateClass = state.claimed
      ? 'claimed'
      : state.completed
        ? 'ready-claim'
        : '';

    let actionHtml = '';
    if (state.claimed) {
      actionHtml = `<span class="claimed-pill">✅ Đã nhận</span>`;
    } else if (state.completed) {
      actionHtml = `
        <button type="button" class="btn btn-primary btn-sm" data-claim-quest="${escapeHtml(def.id)}">
          🎁 Nhận +${def.reward} ❤️
        </button>
      `;
    } else if (def.zoneId) {
      actionHtml = `
        <button type="button" class="btn btn-outline btn-sm" data-goto-zone="${escapeHtml(def.zoneId)}">
          📍 Vào khu này
        </button>
      `;
    } else {
      actionHtml = `<span class="claimed-pill" style="background:#f4ebe2;color:#7a685d">Đang thực hiện</span>`;
    }

    return `
      <article class="quest-item-card ${cardStateClass}">
        <div class="quest-main">
          <div class="quest-title-row">
            <span class="quest-title">${def.icon} ${escapeHtml(def.title)}</span>
            <span class="quest-reward-tag">+${def.reward} ❤️</span>
          </div>
          <p class="quest-desc">${escapeHtml(def.description)}</p>
          <div class="quest-progress-wrap">
            <div class="quest-progress-bar">
              <div class="quest-progress-fill" style="width:${pct}%"></div>
            </div>
            <span class="quest-progress-text">${state.progress || 0}/${def.target}</span>
          </div>
        </div>
        <div class="quest-action">${actionHtml}</div>
      </article>
    `;
  }).join('');
}

function renderFilteredTransactions() {
  const container = document.getElementById('txHistoryContainer');
  if (!container) return;

  document.querySelectorAll('[data-tx-filter]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tx-filter') === activeTxFilter);
  });

  const filtered = cachedTransactions.filter((tx) => {
    if (activeTxFilter === 'earn') return tx.type !== 'spend';
    if (activeTxFilter === 'spend') return tx.type === 'spend';
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state-box">
        🌱 Chưa có giao dịch nào trong mục này.<br>Hãy làm nhiệm vụ, thu hoạch cây hoặc mua sắm trên đảo nhé!
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((tx) => {
    const isEarn = tx.type !== 'spend';
    const sign = isEarn ? '+' : '-';
    const timeStr = formatVietnamTimestamp(tx.createdAtMs);
    return `
      <div class="tx-row">
        <div>
          <div class="tx-title">${escapeHtml(tx.description || 'Giao dịch điểm')}</div>
          <div class="tx-meta">👤 ${escapeHtml(tx.actorName || 'Cư dân')} • 🕒 ${escapeHtml(timeStr)}</div>
        </div>
        <div style="text-align:right">
          <div class="tx-amount ${isEarn ? 'earn' : 'spend'}">${sign}${Number(tx.amount || 0)} ❤️</div>
          <div class="tx-meta">Số dư: ${Number(tx.balanceAfter || 0)}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadAndRenderPointHistory() {
  const container = document.getElementById('txHistoryContainer');
  if (!container) return;

  container.innerHTML = `<div class="empty-state-box">⏳ Đang tải lịch sử điểm yêu thương...</div>`;

  try {
    cachedTransactions = await fetchPointTransactions(40);
    renderFilteredTransactions();
  } catch {
    container.innerHTML = `
      <div class="empty-state-box">Không thể tải lịch sử lúc này. Hãy kiểm tra mạng hoặc Firestore Rules nhé!</div>
    `;
  }
}

function formatVietnamTimestamp(ms) {
  if (!ms) return '';
  const vnDate = new Date(ms + 7 * 3600 * 1000);
  const hh = String(vnDate.getUTCHours()).padStart(2, '0');
  const mm = String(vnDate.getUTCMinutes()).padStart(2, '0');
  const dd = String(vnDate.getUTCDate()).padStart(2, '0');
  const mo = String(vnDate.getUTCMonth() + 1).padStart(2, '0');
  return `${hh}:${mm} ${dd}/${mo}`;
}

function openQuestModal(tab = 'quests') {
  document.getElementById('questModal')?.classList.remove('hidden');
  switchQuestModalTab(tab);
}

function closeQuestModal() {
  document.getElementById('questModal')?.classList.add('hidden');
}

function switchQuestModalTab(tab) {
  const btnQuests = document.getElementById('tabBtnQuests');
  const btnHistory = document.getElementById('tabBtnHistory');
  const panelQuests = document.getElementById('tabPanelQuests');
  const panelHistory = document.getElementById('tabPanelHistory');

  if (tab === 'history') {
    btnQuests?.classList.remove('active');
    btnHistory?.classList.add('active');
    panelQuests?.classList.add('hidden');
    panelHistory?.classList.remove('hidden');
    loadAndRenderPointHistory();
  } else {
    btnHistory?.classList.remove('active');
    btnQuests?.classList.add('active');
    panelHistory?.classList.add('hidden');
    panelQuests?.classList.remove('hidden');
    if (currentQuestData) {
      renderQuestListAndBadge(currentQuestData);
    }
  }
}

/* ==========================================================================
   8B. Tủ Đồ Đôi Nhân Vật (#wardrobeModal) & Sổ Lưu Bút Kỷ Niệm (#memoryModal)
   ========================================================================== */
function openWardrobeModal(tab = 'outfit') {
  activeWardrobeTab = tab;
  document.getElementById('wardrobeModal')?.classList.remove('hidden');
  renderWardrobeModalContent();
}

function closeWardrobeModal() {
  document.getElementById('wardrobeModal')?.classList.add('hidden');
}

async function applyCharacterWardrobeItem(itemId) {
  const info = getOutfitInfo(itemId);
  if (!info || !currentUserProfile) return;

  if (info.category === 'outfit') {
    currentUserProfile.equippedOutfit = info.id;
    islandGame?.setAppearance({ outfitId: info.id });
    await saveUserWardrobe(currentUserProfile.uid, { outfitId: info.id });
  } else if (info.category === 'hat') {
    currentUserProfile.equippedHat = info.id;
    islandGame?.setAppearance({ hatId: info.id });
    await saveUserWardrobe(currentUserProfile.uid, { hatId: info.id });
  }

  islandGame?.spawnFloatingEffect(`${info.icon} Đã diện ${info.name}!`, '#d94d72');
}

function renderWardrobeModalContent() {
  document.querySelectorAll('[data-wardrobe-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-wardrobe-tab') === activeWardrobeTab);
  });

  const grid = document.getElementById('wardrobeItemsGrid');
  if (!grid) return;

  const wardrobeBag = currentInventory?.wardrobe || {};
  const appearance = islandGame?.getAppearance() || {
    outfitId: currentUserProfile?.equippedOutfit || 'outfit_default',
    hatId: currentUserProfile?.equippedHat || 'hat_none'
  };

  const items = OUTFIT_CATALOG.filter((o) => o.category === activeWardrobeTab);
  grid.innerHTML = items.map((item) => {
    const isOwned = item.price === 0 || Number(wardrobeBag[item.id] || 0) >= 1;
    const isEquipped =
      (item.category === 'outfit' && appearance.outfitId === item.id) ||
      (item.category === 'hat' && appearance.hatId === item.id);
    const previewBg = item.shirt || '#fff5f8';

    let actionBtn = '';
    if (isEquipped) {
      actionBtn = `<button type="button" class="btn btn-mint btn-sm" disabled>✅ Đang mặc trên người</button>`;
    } else if (isOwned) {
      actionBtn = `<button type="button" class="btn btn-primary btn-sm" data-equip-wardrobe="${escapeHtml(item.id)}">✨ Mặc ngay</button>`;
    } else {
      actionBtn = `<button type="button" class="btn btn-outline btn-sm" data-buy-and-equip="${escapeHtml(item.id)}">🛍️ Mua & Mặc ngay (${item.price} ❤️)</button>`;
    }

    return `
      <article class="catalog-card ${isEquipped ? 'owned-active' : ''}">
        <div>
          <div class="catalog-top">
            <div class="catalog-icon-box" style="background:${previewBg}">${item.icon}</div>
            <div class="catalog-info">
              <div class="catalog-name">${escapeHtml(item.name)}</div>
              <p class="catalog-desc">${escapeHtml(item.description)}</p>
            </div>
          </div>
          <div class="catalog-meta-row">
            <span class="price-tag">${item.price === 0 ? 'Có sẵn' : `${item.price} ❤️`}</span>
            <span class="owned-tag">${isEquipped ? '✨ Đang mặc' : isOwned ? 'Đã có trong tủ ✅' : 'Chưa mở khóa'}</span>
          </div>
        </div>
        <div class="catalog-btn-row">${actionBtn}</div>
      </article>
    `;
  }).join('');
}

function openMemoryModal(tab = 'list') {
  document.getElementById('memoryModal')?.classList.remove('hidden');
  updateLoveDaysDisplay(currentWorldData?.loveStartDate);
  renderMemoryMoodBar();
  switchMemoryModalTab(tab);
}

function closeMemoryModal() {
  document.getElementById('memoryModal')?.classList.add('hidden');
}

function switchMemoryModalTab(tab) {
  activeMemoryTab = tab;
  document.querySelectorAll('[data-memory-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-memory-tab') === activeMemoryTab);
  });

  document.getElementById('memoryPanelList')?.classList.toggle('hidden', activeMemoryTab !== 'list');
  document.getElementById('memoryPanelWrite')?.classList.toggle('hidden', activeMemoryTab !== 'write');

  if (activeMemoryTab === 'list') {
    loadAndRenderMemories();
  }
}

function renderMemoryMoodBar() {
  const bar = document.getElementById('memoryMoodBar');
  if (!bar) return;
  bar.innerHTML = Object.values(MEMORY_MOODS).map((m) => `
    <button
      type="button"
      class="mood-pill-btn ${m.id === selectedMemoryMood ? 'selected' : ''}"
      data-select-mood="${escapeHtml(m.id)}"
    >
      ${m.icon} ${escapeHtml(m.label)}
    </button>
  `).join('');
}

async function loadAndRenderMemories() {
  const container = document.getElementById('memoryListContainer');
  if (!container) return;

  container.innerHTML = `<div class="empty-state-box">⏳ Đang mở Sổ lưu bút kỷ niệm...</div>`;

  try {
    const memories = await fetchSharedMemories(30);
    if (!memories.length) {
      container.innerHTML = `
        <div class="empty-state-box">
          💌 Cây Kỷ Niệm chưa có trang lưu bút nào.<br>
          Hãy là người đầu tiên viết một lời nhắn ngọt ngào cho người thương nhé!
          <div style="margin-top:12px">
            <button type="button" class="btn btn-primary btn-sm" data-switch-write-memory="1">
              ✍️ Viết kỷ niệm đầu tiên
            </button>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = memories.map((mem) => {
      const mood = MEMORY_MOODS[mem.mood] || MEMORY_MOODS.sweet;
      const dateStr = mem.dateKey ? formatVietnamDate(mem.dateKey) : formatVietnamTimestamp(mem.createdAtMs);
      return `
        <article class="memory-card" style="background:${mood.bg}">
          <div class="memory-card-top">
            <div class="memory-card-title">${mood.icon} ${escapeHtml(mem.title || 'Kỷ niệm nhỏ')}</div>
            <button
              type="button"
              class="btn-icon-soft"
              style="width:26px;height:26px;font-size:0.75rem"
              data-delete-memory="${escapeHtml(mem.id)}"
              title="Xóa kỷ niệm này"
            >
              🗑️
            </button>
          </div>
          <div class="memory-card-body">${escapeHtml(mem.content || '')}</div>
          <div class="memory-card-footer">
            <span>✍️ ${escapeHtml(mem.authorName || 'Người thương')}</span>
            <span>📅 ${escapeHtml(dateStr)}</span>
          </div>
        </article>
      `;
    }).join('');
  } catch (err) {
    if (err?.code === 'permission-denied') {
      showFirebaseRulesUpdateNotice();
      container.innerHTML = `
        <div class="empty-state-box">
          ⚠️ Cần bấm <strong>Publish</strong> file <code>firestore.rules</code> mới trên Firebase Console để mở khóa bảng <strong>memories</strong> nhé!
        </div>
      `;
      return;
    }
    container.innerHTML = `<div class="empty-state-box">Không thể tải lưu bút lúc này. Hãy thử lại nhé!</div>`;
  }
}

/* ==========================================================================
   9. Cần Gạt Joystick 360° & Gắn Kết Toàn Bộ Sự Kiện Giao Diện
   ========================================================================== */
function setupMobileJoystick() {
  const base = document.getElementById('joystickZone');
  const knob = document.getElementById('joystickKnob');
  if (!base || !knob) return;

  let activePointerId = null;
  const maxRadius = 31;

  const updateStick = (clientX, clientY) => {
    const rect = base.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);

    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }

    knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;

    if (dist < 6) {
      islandGame?.setAnalogInput(0, 0);
    } else {
      islandGame?.setAnalogInput(dx / maxRadius, dy / maxRadius);
    }
  };

  const resetStick = () => {
    activePointerId = null;
    knob.style.transform = 'translate(0px, 0px)';
    islandGame?.setAnalogInput(0, 0);
  };

  base.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    activePointerId = e.pointerId;
    base.setPointerCapture?.(e.pointerId);
    updateStick(e.clientX, e.clientY);
  });

  base.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointerId) return;
    e.preventDefault();
    updateStick(e.clientX, e.clientY);
  });

  base.addEventListener('pointerup', (e) => {
    if (e.pointerId === activePointerId) resetStick();
  });

  base.addEventListener('pointercancel', (e) => {
    if (e.pointerId === activePointerId) resetStick();
  });
}

function bindGameUIEvents() {
  setupMobileJoystick();

  // 1. Thanh chuyển Map nhanh (5 khu vực riêng)
  document.getElementById('mapNavBar')?.addEventListener('click', (e) => {
    const mapBtn = e.target.closest('[data-switch-map]');
    if (!mapBtn) return;
    const targetMap = mapBtn.getAttribute('data-switch-map');
    islandGame?.switchMap(targetMap);
  });

  // 2. Nút đổi góc nhìn trên Điện thoại
  const camToggleBtn = document.getElementById('mobileCamToggleBtn');
  camToggleBtn?.addEventListener('click', () => {
    if (!islandGame) return;
    const isOverview = islandGame.toggleMobileCameraMode();
    camToggleBtn.textContent = isOverview ? '🔍 Cận cảnh' : '🔍 Toàn cảnh';
  });

  // 3. Thanh công cụ KHU VƯỜN
  document.getElementById('gardenSeedBar')?.addEventListener('click', (e) => {
    const openShopBtn = e.target.closest('[data-open-seed-shop]');
    if (openShopBtn) {
      openShopModal('seeds');
      return;
    }

    const pill = e.target.closest('[data-select-seed]');
    if (pill) {
      selectedSeedId = pill.getAttribute('data-select-seed');
      renderGardenToolbar();
    }
  });

  document.getElementById('unlockGardenPlotBtn')?.addEventListener('click', () => {
    promptUnlockGardenPlot();
  });

  // 4. Thanh công cụ KHU NHÀ CHUNG
  document.getElementById('openHouseDecorBtn')?.addEventListener('click', () => openHouseModal('furniture'));
  document.getElementById('openHouseUpgradeBtn')?.addEventListener('click', () => openHouseModal('upgrade'));

  document.getElementById('toggleHouseEditBtn')?.addEventListener('click', () => {
    if (!islandGame) return;
    const next = islandGame.setHouseEditMode(!islandGame.isHouseEditMode());
    updateHouseEditButtonUI(next);
    if (next) {
      showToast('✋ Đã bật chế độ sắp xếp! Hãy chạm & kéo đồ nội thất trên sàn nhà nhé.', 'info', 3500);
    }
  });

  document.getElementById('removeSelectedFurnitureBtn')?.addEventListener('click', async () => {
    const uid = islandGame?.getSelectedFurnitureUid();
    if (!uid || !currentWorldData) return;
    try {
      await removePlacedFurniture(uid, currentWorldData);
      islandGame?.clearSelectedFurniture();
      showToast('📥 Đã cất món đồ về Kho nội thất chung!', 'info', 2500);
    } catch (err) {
      handleActionError(err);
    }
  });

  document.getElementById('tidyHouseQuickBtn')?.addEventListener('click', async () => {
    if (!navigator.onLine) {
      showToast('Cần kết nối Internet để lưu tiến độ.', 'warning');
      return;
    }
    try {
      const res = await progressIslandQuest('tidy_house');
      islandGame?.spawnFloatingEffect('🧹 Tổ ấm sạch xinh thơm mát!', '#d94d72');
      if (res.justCompleted) {
        showToast('🎉 Hoàn thành nhiệm vụ "Chăm chút ngôi nhà"! Mở 📋 Nhiệm vụ nhận +15 ❤️ nhé!', 'success');
      } else {
        showToast('🏡 Ngôi nhà chung của hai bạn đã gọn gàng ấm cúng!', 'info', 2500);
      }
    } catch (err) {
      handleActionError(err);
    }
  });

  // 5. Thanh công cụ KHU THÚ CƯNG & CỬA HÀNG
  document.getElementById('openPetCareModalBtn')?.addEventListener('click', () => openPetModal('care'));
  document.getElementById('openPetAdoptModalBtn')?.addEventListener('click', () => openPetModal('adopt'));
  document.getElementById('openShopQuickBtn')?.addEventListener('click', () => openShopModal('seeds'));
  document.getElementById('openShopModalBtn')?.addEventListener('click', () => openShopModal('seeds'));

  // 6. Sự kiện bên trong MODAL CỬA HÀNG (#shopModal)
  document.getElementById('closeShopModalBtn')?.addEventListener('click', closeShopModal);
  const shopModal = document.getElementById('shopModal');
  shopModal?.addEventListener('click', (e) => {
    if (e.target === shopModal) closeShopModal();
  });

  document.querySelectorAll('[data-shop-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeShopTab = btn.getAttribute('data-shop-tab');
      renderShopModalContent();
    });
  });

  document.getElementById('shopItemsGrid')?.addEventListener('click', async (e) => {
    const equipFromShopBtn = e.target.closest('[data-equip-from-shop]');
    if (equipFromShopBtn) {
      const itemId = equipFromShopBtn.getAttribute('data-equip-from-shop');
      setButtonLoading(equipFromShopBtn, true, 'Đang mặc...');
      try {
        await applyCharacterWardrobeItem(itemId);
        closeShopModal();
        showToast('👗 Đã thay trang phục mới lên nhân vật!', 'success', 2800);
      } catch (err) {
        handleActionError(err);
      } finally {
        setButtonLoading(equipFromShopBtn, false);
      }
      return;
    }

    const applySurfaceBtn = e.target.closest('[data-apply-surface-from-shop]');
    if (applySurfaceBtn) {
      const itemId = applySurfaceBtn.getAttribute('data-apply-surface-from-shop');
      setButtonLoading(applySurfaceBtn, true, 'Đang đổi...');
      try {
        const info = await applyHouseSurfaceStyle({ itemId });
        await progressIslandQuest('tidy_house').catch(() => {});
        closeShopModal();
        islandGame?.switchMap('house');
        showToast(`🎨 Đã áp dụng "${info.name}" cho Ngôi nhà chung!`, 'success');
      } catch (err) {
        handleActionError(err);
      } finally {
        setButtonLoading(applySurfaceBtn, false);
      }
      return;
    }

    const buyBtn = e.target.closest('[data-buy-item]');
    if (!buyBtn) return;

    if (!navigator.onLine) {
      showToast('Cần kết nối Internet để mua vật phẩm.', 'warning');
      return;
    }

    const itemId = buyBtn.getAttribute('data-buy-item');
    const qty = Number(buyBtn.getAttribute('data-buy-qty') || 1);

    setButtonLoading(buyBtn, true, 'Đang mua...');
    try {
      const res = await buyShopItem({
        itemId,
        quantity: qty,
        userProfile: currentUserProfile
      });
      if (res.item.category === 'seed') {
        selectedSeedId = res.item.id;
      }
      islandGame?.spawnFloatingEffect(`🛍️ Đã mua ${res.item.icon}!`, '#d94d72');
      showToast(
        `🛍️ Đã mua ${res.quantity > 1 ? `${res.quantity}x ` : ''}${res.item.name} (-${res.totalCost} ❤️)!`,
        'success',
        3200
      );
    } catch (err) {
      handleActionError(err);
    } finally {
      setButtonLoading(buyBtn, false);
      renderShopModalContent();
    }
  });

  // 7. Sự kiện bên trong MODAL KHU NHÀ CHUNG (#houseModal)
  document.getElementById('closeHouseModalBtn')?.addEventListener('click', closeHouseModal);
  const houseModal = document.getElementById('houseModal');
  houseModal?.addEventListener('click', (e) => {
    if (e.target === houseModal) closeHouseModal();
  });

  document.querySelectorAll('[data-house-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeHouseTab = btn.getAttribute('data-house-tab');
      renderHouseModalContent();
    });
  });

  houseModal?.addEventListener('click', async (e) => {
    const gotoShopBtn = e.target.closest('[data-goto-shop-tab]');
    if (gotoShopBtn) {
      const targetTab = gotoShopBtn.getAttribute('data-goto-shop-tab');
      closeHouseModal();
      openShopModal(targetTab);
      return;
    }

    const placeBtn = e.target.closest('[data-place-furniture]');
    if (placeBtn) {
      const itemId = placeBtn.getAttribute('data-place-furniture');
      setButtonLoading(placeBtn, true, 'Đang đặt...');
      try {
        if (islandGame?.getCurrentMapId() !== 'house') {
          islandGame?.switchMap('house');
        }
        const coords = islandGame?.getPlayerCoords();
        await placeFurnitureItem({
          itemId,
          x: coords ? coords.x : undefined,
          y: coords ? coords.y - 24 : undefined
        });
        await progressIslandQuest('tidy_house').catch(() => {});
        closeHouseModal();
        islandGame?.setHouseEditMode(true);
        updateHouseEditButtonUI(true);
        showToast('🛋️ Đã đặt đồ ra sàn! Bạn có thể chạm và kéo món đồ tới vị trí ưng ý.', 'success', 4000);
      } catch (err) {
        handleActionError(err);
      } finally {
        setButtonLoading(placeBtn, false);
      }
      return;
    }

    const unplaceBtn = e.target.closest('[data-unplace-uid]');
    if (unplaceBtn) {
      const uid = unplaceBtn.getAttribute('data-unplace-uid');
      if (!uid || !currentWorldData) return;
      setButtonLoading(unplaceBtn, true, 'Đang cất...');
      try {
        await removePlacedFurniture(uid, currentWorldData);
        showToast('📥 Đã cất 1 món về Kho nội thất!', 'info', 2500);
      } catch (err) {
        handleActionError(err);
      } finally {
        setButtonLoading(unplaceBtn, false);
        renderHouseModalContent();
      }
      return;
    }

    const surfaceBtn = e.target.closest('[data-apply-surface]');
    if (surfaceBtn) {
      const itemId = surfaceBtn.getAttribute('data-apply-surface');
      setButtonLoading(surfaceBtn, true, 'Đang đổi...');
      try {
        const info = await applyHouseSurfaceStyle({ itemId });
        const qRes = await progressIslandQuest('tidy_house').catch(() => null);
        if (islandGame?.getCurrentMapId() !== 'house') {
          islandGame?.switchMap('house');
        }
        islandGame?.spawnFloatingEffect(`${info.icon} Nhà mới xinh lung linh!`, '#d94d72');
        showToast(
          qRes?.justCompleted
            ? `🎨 Đã đổi sang "${info.name}" & hoàn thành nhiệm vụ Chăm chút ngôi nhà!`
            : `🎨 Đã đổi sang "${info.name}"!`,
          'success'
        );
      } catch (err) {
        handleActionError(err);
      } finally {
        setButtonLoading(surfaceBtn, false);
        renderHouseModalContent();
      }
      return;
    }

    const upgradeHouseBtn = e.target.closest('[data-confirm-house-upgrade]');
    if (upgradeHouseBtn) {
      const house = getNormalizedHouse(currentWorldData);
      const nextCfg = HOUSE_LEVELS[house.level + 1];
      if (!nextCfg) return;

      const confirmed = await showConfirm({
        title: `🏡 Nâng cấp lên "${nextCfg.name}"?`,
        message: `Dùng ${nextCfg.upgradeCost} Điểm yêu thương (❤️) để mở rộng diện tích phòng và tăng sức chứa lên ${nextCfg.maxFurniture} món nội thất?`,
        confirmText: `Nâng cấp (${nextCfg.upgradeCost} ❤️)`,
        cancelText: 'Để sau'
      });
      if (!confirmed) return;

      setButtonLoading(upgradeHouseBtn, true, 'Đang nâng cấp...');
      try {
        const res = await upgradeSharedHouse(currentUserProfile);
        await progressIslandQuest('tidy_house').catch(() => {});
        closeHouseModal();
        if (islandGame?.getCurrentMapId() !== 'house') {
          islandGame?.switchMap('house');
        }
        islandGame?.spawnFloatingEffect(`🎉 Nhà Cấp ${res.nextCfg.level}!`, '#d94d72');
        showToast(`🏡 Chúc mừng! Ngôi nhà đã nâng cấp lên Cấp ${res.nextCfg.level}: ${res.nextCfg.name}!`, 'success', 4500);
      } catch (err) {
        handleActionError(err);
      } finally {
        setButtonLoading(upgradeHouseBtn, false);
        renderHouseModalContent();
      }
    }
  });

  // 8. Sự kiện bên trong MODAL KHU THÚ CƯNG (#petModal)
  document.getElementById('closePetModalBtn')?.addEventListener('click', closePetModal);
  const petModal = document.getElementById('petModal');
  petModal?.addEventListener('click', (e) => {
    if (e.target === petModal) closePetModal();
  });

  document.querySelectorAll('[data-pet-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activePetTab = btn.getAttribute('data-pet-tab');
      isRenamingPetInline = false;
      renderPetModalContent();
    });
  });

  petModal?.addEventListener('click', async (e) => {
    if (e.target.closest('[data-switch-adopt-tab]')) {
      activePetTab = 'adopt';
      renderPetModalContent();
      return;
    }

    const selectPetBtn = e.target.closest('[data-select-pet]');
    if (selectPetBtn) {
      selectedPetId = selectPetBtn.getAttribute('data-select-pet');
      isRenamingPetInline = false;
      renderPetModalContent();
      return;
    }

    const speciesBtn = e.target.closest('[data-choose-species]');
    if (speciesBtn) {
      selectedAdoptSpecies = speciesBtn.getAttribute('data-choose-species');
      const nameInput = document.getElementById('adoptPetNameInput');
      if (nameInput && !nameInput.value.trim()) {
        nameInput.placeholder = `VD: ${PET_SPECIES[selectedAdoptSpecies]?.defaultName || 'Mochi'}`;
      }
      renderPetModalContent();
      return;
    }

    if (e.target.closest('[data-toggle-pet-rename]')) {
      isRenamingPetInline = !isRenamingPetInline;
      renderPetModalContent();
      document.getElementById('inlinePetNameInput')?.focus();
      return;
    }

    const saveRenameBtn = e.target.closest('[data-save-pet-rename]');
    if (saveRenameBtn) {
      const petId = saveRenameBtn.getAttribute('data-save-pet-rename');
      const newName = document.getElementById('inlinePetNameInput')?.value || '';
      setButtonLoading(saveRenameBtn, true, 'Lưu...');
      try {
        await renamePetById({ petId, newName, worldData: currentWorldData });
        isRenamingPetInline = false;
        showToast('🐾 Đã đổi tên cho bé thú cưng!', 'success', 2500);
        renderPetModalContent();
      } catch (err) {
        handleActionError(err);
        setButtonLoading(saveRenameBtn, false);
      }
      return;
    }

    if (e.target.closest('[data-goto-pet-acc-shop]')) {
      closePetModal();
      openShopModal('wardrobe');
      return;
    }

    const equipAccBtn = e.target.closest('[data-equip-pet-acc]');
    if (equipAccBtn) {
      const accId = equipAccBtn.getAttribute('data-equip-pet-acc') || null;
      const petId = equipAccBtn.getAttribute('data-pet-id');
      const avail = Number(equipAccBtn.getAttribute('data-acc-avail') ?? 1);

      if (accId && avail <= 0) {
        const info = getPetAccessoryInfo(accId);
        showToast(`Túi đồ chưa có sẵn "${info?.name || 'phụ kiện'}". Mình mở Cửa hàng để sắm cho bé nhé!`, 'info', 3500);
        closePetModal();
        openShopModal('wardrobe');
        return;
      }

      setButtonLoading(equipAccBtn, true, '...');
      try {
        const updatedPet = await equipPetAccessory({ petId, accessoryId: accId });
        triggerPetExcitedJump(petId);
        const info = accId ? getPetAccessoryInfo(accId) : null;
        showToast(
          info
            ? `${info.icon} Đã đeo "${info.name}" cho ${updatedPet.name}!`
            : `🐾 Đã tháo phụ kiện cho ${updatedPet.name}.`,
          'success',
          2600
        );
      } catch (err) {
        handleActionError(err);
      } finally {
        setButtonLoading(equipAccBtn, false);
        renderPetModalContent();
      }
      return;
    }

    const careBtn = e.target.closest('[data-pet-care]');
    if (careBtn) {
      const action = careBtn.getAttribute('data-pet-care');
      const petId = careBtn.getAttribute('data-pet-id');
      setButtonLoading(careBtn, true, '...');
      try {
        const res = await careForPet({ petId, action });
        triggerPetExcitedJump(petId);
        islandGame?.spawnFloatingEffect(res.effectLabel, '#d94d72');
        const qRes = await progressIslandQuest('care_pet_zone').catch(() => null);
        if (qRes?.justCompleted) {
          showToast('🎉 Hoàn thành nhiệm vụ "Chăm sóc thú cưng"! Mở 📋 Nhiệm vụ nhận +20 ❤️ nhé!', 'success');
        }
      } catch (err) {
        handleActionError(err);
      } finally {
        setButtonLoading(careBtn, false);
        renderPetModalContent();
      }
    }
  });

  document.getElementById('adoptPetForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!navigator.onLine) {
      showToast('Cần kết nối Internet để đón thú cưng mới.', 'warning');
      return;
    }

    const pets = getNormalizedPets(currentWorldData);
    if (pets.length >= MAX_PETS) {
      showToast(`Sân chơi đã đạt tối đa ${MAX_PETS} bé rồi!`, 'warning');
      return;
    }

    const sp = PET_SPECIES[selectedAdoptSpecies] || PET_SPECIES.cat;
    const nameInput = document.getElementById('adoptPetNameInput');
    const chosenName = (nameInput?.value || '').trim() || sp.defaultName;
    const cost = pets.length === 0 ? 0 : PET_ADOPT_COST;

    if (cost > 0) {
      const ok = await showConfirm({
        title: `🐾 Đón ${sp.icon} "${chosenName}" về đảo?`,
        message: `Dùng ${cost} Điểm yêu thương (❤️) để đón bé thú cưng thứ #${pets.length + 1}/${MAX_PETS} vào Khu Thú Cưng chung nhé?`,
        confirmText: `Đón ngay (${cost} ❤️)`,
        cancelText: 'Để sau'
      });
      if (!ok) return;
    }

    const submitBtn = document.getElementById('adoptPetSubmitBtn');
    setButtonLoading(submitBtn, true, 'Đang đón bé...');
    try {
      const res = await adoptPet({
        speciesId: selectedAdoptSpecies,
        petName: chosenName,
        userProfile: currentUserProfile
      });
      if (nameInput) nameInput.value = '';
      selectedPetId = res.pet.id;
      activePetTab = 'care';

      await progressIslandQuest('care_pet_zone').catch(() => {});
      if (islandGame?.getCurrentMapId() !== 'pet') {
        islandGame?.switchMap('pet');
      }
      setTimeout(() => triggerPetExcitedJump(res.pet.id), 180);
      islandGame?.spawnFloatingEffect(`${sp.icon} Chào mừng ${res.pet.name}!`, '#d94d72');
      showToast(`🎉 Đã đón ${sp.icon} ${res.pet.name} về Khu Thú Cưng (${res.count}/${MAX_PETS})!`, 'success', 4000);
      renderPetModalContent();
    } catch (err) {
      handleActionError(err);
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });

  // 9. Bảng Nhiệm vụ & Lịch sử điểm (#questModal)
  document.getElementById('openQuestModalBtn')?.addEventListener('click', () => openQuestModal('quests'));
  document.getElementById('mobileQuestQuickBtn')?.addEventListener('click', () => openQuestModal('quests'));
  document.getElementById('lovePointsPill')?.addEventListener('click', () => openQuestModal('history'));
  document.getElementById('closeQuestModalBtn')?.addEventListener('click', closeQuestModal);

  const questModal = document.getElementById('questModal');
  questModal?.addEventListener('click', (e) => {
    if (e.target === questModal) closeQuestModal();
  });

  document.getElementById('tabBtnQuests')?.addEventListener('click', () => switchQuestModalTab('quests'));
  document.getElementById('tabBtnHistory')?.addEventListener('click', () => switchQuestModalTab('history'));

  document.getElementById('txFilterBar')?.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('[data-tx-filter]');
    if (!filterBtn) return;
    activeTxFilter = filterBtn.getAttribute('data-tx-filter') || 'all';
    renderFilteredTransactions();
  });

  document.getElementById('questListContainer')?.addEventListener('click', async (e) => {
    const claimBtn = e.target.closest('[data-claim-quest]');
    if (claimBtn) {
      if (!navigator.onLine) {
        showToast('Cần kết nối Internet để nhận thưởng Điểm yêu thương.', 'warning');
        return;
      }

      const questId = claimBtn.getAttribute('data-claim-quest');
      setButtonLoading(claimBtn, true, 'Đang nhận...');
      try {
        const res = await claimQuestReward({
          questId,
          userProfile: currentUserProfile
        });
        islandGame?.spawnFloatingEffect(`💖 +${res.reward} Điểm!`, '#d94d72');
        showToast(`🎁 Đã nhận +${res.reward} Điểm yêu thương từ "${res.title}"!`, 'success');
      } catch (err) {
        handleActionError(err);
        setButtonLoading(claimBtn, false);
      }
      return;
    }

    const gotoBtn = e.target.closest('[data-goto-zone]');
    if (gotoBtn) {
      const targetMapId = gotoBtn.getAttribute('data-goto-zone');
      closeQuestModal();
      islandGame?.switchMap(targetMapId);
    }
  });

  // 10. Nút tương tác cổng khu vực (PC & Điện thoại)
  document.getElementById('interactZoneBtn')?.addEventListener('click', () => {
    islandGame?.triggerCurrentZoneInteraction();
  });
  document.getElementById('mobileInteractBtn')?.addEventListener('click', () => {
    islandGame?.triggerCurrentZoneInteraction();
  });

  // 11. Đăng xuất
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
      const confirmed = await showConfirm({
        title: 'Rời đảo & Đăng xuất?',
        message: 'Vị trí, khu vườn, ngôi nhà và đàn thú cưng của hai bạn đã được lưu an toàn trên đảo.',
        confirmText: 'Đăng xuất',
        cancelText: 'Ở lại chơi tiếp',
        variant: 'danger'
      });
      if (!confirmed) return;

      await cleanupSession(true);
      await signOut(auth);
      window.location.replace('./login.html');
    } catch (err) {
      showToast(translateAuthError(err), 'error');
    }
  });

  // 12. Đổi tên hòn đảo
  const openRenameBtn = document.getElementById('openRenameModalBtn');
  const renameModal = document.getElementById('renameWorldModal');
  const closeRenameBtn = document.getElementById('closeRenameModalBtn');
  const renameForm = document.getElementById('renameWorldForm');
  const renameInput = document.getElementById('renameWorldInput');
  const renameSubmitBtn = document.getElementById('renameSubmitBtn');

  openRenameBtn?.addEventListener('click', () => {
    if (!currentWorldData) return;
    if (renameInput) renameInput.value = currentWorldData.worldName || '';
    renameModal?.classList.remove('hidden');
    renameInput?.focus();
  });

  closeRenameBtn?.addEventListener('click', () => {
    renameModal?.classList.add('hidden');
  });

  renameModal?.addEventListener('click', (e) => {
    if (e.target === renameModal) renameModal.classList.add('hidden');
  });

  renameForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!navigator.onLine) {
      showToast('Cần kết nối Internet để đổi tên đảo.', 'warning');
      return;
    }

    const newName = (renameInput?.value || '').trim();
    if (newName.length < 2 || newName.length > 30) {
      showToast('Tên đảo cần từ 2 đến 30 ký tự.', 'warning');
      return;
    }

    if (newName === currentWorldData?.worldName) {
      renameModal?.classList.add('hidden');
      return;
    }

    setButtonLoading(renameSubmitBtn, true, 'Đang lưu...');
    try {
      await renameWorld(newName);
      renameModal?.classList.add('hidden');
    } catch (err) {
      handleActionError(err);
    } finally {
      setButtonLoading(renameSubmitBtn, false);
    }
  });

  // 13. Tương tác Đôi Lứa trực tiếp: Biểu cảm nhanh & Bong bóng Chat trên đầu nhân vật
  document.getElementById('quickEmoteBar')?.addEventListener('click', (e) => {
    const emoteBtn = e.target.closest('[data-send-emote]');
    if (!emoteBtn) return;
    const emote = emoteBtn.getAttribute('data-send-emote');
    if (islandGame?.sendLoveEmote(emote)) {
      recordCoupleMomentQuest();
    }
  });

  document.getElementById('quickChatForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('quickChatInput');
    const text = (input?.value || '').trim();
    if (!text) return;

    if (islandGame?.sendChatBubble(text)) {
      if (input) {
        input.value = '';
        input.blur();
      }
      recordCoupleMomentQuest();
    }
  });

  // 14. Tủ Đồ Nhân Vật (#wardrobeModal)
  document.getElementById('openWardrobeModalBtn')?.addEventListener('click', () => openWardrobeModal('outfit'));
  document.getElementById('closeWardrobeModalBtn')?.addEventListener('click', closeWardrobeModal);
  const wardrobeModal = document.getElementById('wardrobeModal');
  wardrobeModal?.addEventListener('click', (e) => {
    if (e.target === wardrobeModal) closeWardrobeModal();
  });

  document.querySelectorAll('[data-wardrobe-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeWardrobeTab = btn.getAttribute('data-wardrobe-tab') || 'outfit';
      renderWardrobeModalContent();
    });
  });

  document.getElementById('wardrobeItemsGrid')?.addEventListener('click', async (e) => {
    const equipBtn = e.target.closest('[data-equip-wardrobe]');
    if (equipBtn) {
      const itemId = equipBtn.getAttribute('data-equip-wardrobe');
      setButtonLoading(equipBtn, true, 'Đang mặc...');
      try {
        await applyCharacterWardrobeItem(itemId);
        renderWardrobeModalContent();
      } catch (err) {
        handleActionError(err);
      } finally {
        setButtonLoading(equipBtn, false);
      }
      return;
    }

    const buyEquipBtn = e.target.closest('[data-buy-and-equip]');
    if (buyEquipBtn) {
      if (!navigator.onLine) {
        showToast('Cần kết nối Internet để mua trang phục.', 'warning');
        return;
      }
      const itemId = buyEquipBtn.getAttribute('data-buy-and-equip');
      setButtonLoading(buyEquipBtn, true, 'Đang mở khóa...');
      try {
        const res = await buyShopItem({
          itemId,
          quantity: 1,
          userProfile: currentUserProfile
        });
        await applyCharacterWardrobeItem(itemId);
        showToast(`✨ Đã mở khóa & mặc ngay "${res.item.name}" (-${res.totalCost} ❤️)!`, 'success', 3500);
      } catch (err) {
        handleActionError(err);
      } finally {
        setButtonLoading(buyEquipBtn, false);
        renderWardrobeModalContent();
      }
    }
  });

  // 15. Cây Kỷ Niệm & Sổ Lưu Bút Đôi (#memoryModal)
  document.getElementById('openMemoryModalBtn')?.addEventListener('click', () => openMemoryModal('list'));
  document.getElementById('closeMemoryModalBtn')?.addEventListener('click', closeMemoryModal);
  const memoryModal = document.getElementById('memoryModal');
  memoryModal?.addEventListener('click', (e) => {
    if (e.target === memoryModal) closeMemoryModal();
  });

  document.querySelectorAll('[data-memory-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchMemoryModalTab(btn.getAttribute('data-memory-tab') || 'list');
    });
  });

  document.getElementById('loveDateForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!navigator.onLine) {
      showToast('Cần kết nối Internet để lưu ngày kỷ niệm.', 'warning');
      return;
    }
    const input = document.getElementById('loveStartDateInput');
    const dateVal = (input?.value || '').trim();
    if (!dateVal) {
      showToast('Hãy chọn ngày bắt đầu yêu nhau trước khi bấm Lưu nhé!', 'warning');
      return;
    }
    const saveBtn = document.getElementById('saveLoveDateBtn');
    setButtonLoading(saveBtn, true, 'Đang lưu...');
    try {
      const days = await saveLoveStartDate(dateVal);
      updateLoveDaysDisplay(dateVal);
      islandGame?.spawnFloatingEffect(`💑 Bên nhau ${days} ngày!`, '#d94d72');
      showToast(`💑 Đã lưu cột mốc ngày yêu! Hai bạn đã bên nhau ${days.toLocaleString('vi-VN')} ngày 💖`, 'success', 4000);
    } catch (err) {
      handleActionError(err);
    } finally {
      setButtonLoading(saveBtn, false);
    }
  });

  document.getElementById('memoryMoodBar')?.addEventListener('click', (e) => {
    const moodBtn = e.target.closest('[data-select-mood]');
    if (!moodBtn) return;
    selectedMemoryMood = moodBtn.getAttribute('data-select-mood') || 'sweet';
    renderMemoryMoodBar();
  });

  document.getElementById('memoryListContainer')?.addEventListener('click', async (e) => {
    if (e.target.closest('[data-switch-write-memory]')) {
      switchMemoryModalTab('write');
      document.getElementById('memoryTitleInput')?.focus();
      return;
    }

    const delBtn = e.target.closest('[data-delete-memory]');
    if (delBtn) {
      const memId = delBtn.getAttribute('data-delete-memory');
      if (!memId) return;
      const confirmed = await showConfirm({
        title: 'Xóa trang lưu bút này?',
        message: 'Trang kỷ niệm này sẽ được gỡ khỏi Sổ lưu bút chung của hai bạn.',
        confirmText: 'Xóa kỷ niệm',
        cancelText: 'Giữ lại',
        variant: 'danger'
      });
      if (!confirmed) return;

      setButtonLoading(delBtn, true, '...');
      try {
        await deleteSharedMemory(memId);
        showToast('🗑️ Đã xóa trang lưu bút.', 'info', 2500);
        loadAndRenderMemories();
      } catch (err) {
        handleActionError(err);
        setButtonLoading(delBtn, false);
      }
    }
  });

  document.getElementById('createMemoryForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!navigator.onLine) {
      showToast('Cần kết nối Internet để lưu kỷ niệm lên đảo.', 'warning');
      return;
    }

    const titleInput = document.getElementById('memoryTitleInput');
    const contentInput = document.getElementById('memoryContentInput');
    const submitBtn = document.getElementById('memorySubmitBtn');

    const title = (titleInput?.value || '').trim();
    const content = (contentInput?.value || '').trim();

    setButtonLoading(submitBtn, true, 'Đang treo lên Cây Kỷ Niệm...');
    try {
      await createSharedMemory({
        title,
        content,
        mood: selectedMemoryMood,
        userProfile: currentUserProfile
      });
      if (titleInput) titleInput.value = '';
      if (contentInput) contentInput.value = '';
      islandGame?.spawnFloatingEffect('💌 Đã treo lời nhắn lên Cây Kỷ Niệm!', '#d94d72');
      showToast('💌 Đã lưu trang kỷ niệm mới vào Sổ lưu bút của hai đứa!', 'success', 3800);
      recordCoupleMomentQuest();
      switchMemoryModalTab('list');
    } catch (err) {
      handleActionError(err);
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });
}

/* ==========================================================================
   Khởi chạy
   ========================================================================== */
initLandingPage();
initGamePage();
