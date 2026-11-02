/**
 * CTISLAND - Map Riêng Khu Thú Cưng: Vui Chơi Tối Đa 10 Con (pet.js)
 * - Hỗ trợ nhận nuôi tối đa 10 bé thú cưng (Mèo, Chó, Thỏ). Bé đầu tiên miễn phí!
 * - Thú cưng chạy nhảy tự nhiên trực tiếp trên Map Sân Chơi 2D.
 * - Chạm vào thú cưng để Đặt tên, Cho ăn, Vuốt ve, Chơi đùa & Xem chỉ số theo thời gian thực.
 */

import {
  db,
  doc,
  updateDoc,
  runTransaction,
  serverTimestamp
} from './firebase.js';
import { SHARED_WORLD_ID, MAP_WIDTH, MAP_HEIGHT } from './world.js';
import { getPetAccessoryInfo, buildDefaultInventory } from './shop.js';

export const MAX_PETS = 10;
export const PET_ADOPT_COST = 55; // Bé đầu tiên miễn phí (0 ❤️), từ bé thứ 2 giá 55 ❤️

export const PET_SPECIES = {
  cat: {
    id: 'cat',
    name: 'Mèo Mochi',
    icon: '🐱',
    bodyColor: '#fff5eb',
    earColor: '#ffb3c6',
    sound: 'Meow~ 💕',
    defaultName: 'Mochi'
  },
  dog: {
    id: 'dog',
    name: 'Cún Corgi',
    icon: '🐶',
    bodyColor: '#f6d5b0',
    earColor: '#d49a6a',
    sound: 'Gâu gâu~ 💖',
    defaultName: 'Bơ'
  },
  bunny: {
    id: 'bunny',
    name: 'Thỏ Bông',
    icon: '🐰',
    bodyColor: '#fffafa',
    earColor: '#ffc2d1',
    sound: 'Chít chít~ 🌸',
    defaultName: 'Mây'
  }
};

export const PET_EXIT_PORTAL = {
  id: 'exit_to_island',
  targetMap: 'island',
  name: 'Về Đảo Chính',
  icon: '🏝️',
  x: 480,
  y: 66,
  radius: 42
};

export const PET_SPAWN = { x: 480, y: 108 };

/**
 * Chuẩn hóa danh sách thú cưng từ worldData (tối đa 10 con).
 */
export function getNormalizedPets(worldData) {
  const list = Array.isArray(worldData?.pets) ? worldData.pets : [];
  return list.slice(0, MAX_PETS);
}

/**
 * Tính chỉ số Hunger / Happiness / Energy theo thời gian thực mà không cần server chạy ngầm.
 * @param {Object} pet
 * @param {number} [nowMs]
 */
export function computePetLiveStats(pet, nowMs = Date.now()) {
  const elapsedHours = Math.max(0, (nowMs - (pet.lastUpdatedMs || nowMs)) / 3600000);
  const hunger = Math.round(Math.max(8, Math.min(100, (pet.hunger ?? 85) - elapsedHours * 7)));
  const happiness = Math.round(Math.max(8, Math.min(100, (pet.happiness ?? 85) - elapsedHours * 5.5)));
  const energy = Math.round(Math.max(12, Math.min(100, (pet.energy ?? 85) - elapsedHours * 3.5)));

  let mood = 'Vui vẻ 💗';
  if (hunger < 35) mood = 'Đang đói bụng 🍖';
  else if (energy < 30) mood = 'Buồn ngủ 💤';
  else if (happiness < 40) mood = 'Muốn được cưng nựng 🥺';

  return { hunger, happiness, energy, mood };
}

/**
 * Nhận nuôi thú cưng mới (Bé đầu tiên 0 ❤️, từ bé 2 -> 10 tốn 55 ❤️).
 */
export async function adoptPet({ speciesId, petName, userProfile }) {
  const species = PET_SPECIES[speciesId];
  if (!species) throw new Error('Loại thú cưng không hợp lệ.');

  const cleanName = String(petName || species.defaultName).trim().slice(0, 18);
  if (cleanName.length < 1) throw new Error('Hãy đặt tên cho bé thú cưng nhé!');

  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  const txId = `pet_${Date.now()}_${userProfile.uid.slice(0, 5)}`;
  const txRef = doc(db, 'transactions', txId);

  return runTransaction(db, async (tx) => {
    const worldSnap = await tx.get(worldRef);
    if (!worldSnap.exists()) throw new Error('Không tìm thấy dữ liệu đảo.');

    const worldData = worldSnap.data();
    const pets = getNormalizedPets(worldData);

    if (pets.length >= MAX_PETS) {
      throw new Error(`Khu thú cưng đã đạt tối đa ${MAX_PETS}/${MAX_PETS} bé rồi!`);
    }

    const cost = pets.length === 0 ? 0 : PET_ADOPT_COST;
    const currentPoints = Number(worldData.lovePoints || 0);

    if (currentPoints < cost) {
      throw new Error(`Cần ${cost} ❤️ để đón thêm bé mới (hiện có ${currentPoints} ❤️).`);
    }

    const newPet = {
      id: `pet_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: species.id,
      name: cleanName,
      hunger: 85,
      happiness: 90,
      energy: 90,
      lastUpdatedMs: Date.now(),
      adoptedBy: userProfile.displayName
    };

    const updatedPets = [...pets, newPet];
    const newBalance = currentPoints - cost;

    if (cost > 0) {
      tx.set(txRef, {
        txId,
        worldId: SHARED_WORLD_ID,
        type: 'spend',
        source: 'pet_adopt',
        amount: cost,
        balanceAfter: newBalance,
        description: `Đón thú cưng ${species.icon} ${cleanName} (#${updatedPets.length}/${MAX_PETS})`,
        actorUid: userProfile.uid,
        actorName: userProfile.displayName,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now()
      });

      tx.update(worldRef, {
        lovePoints: newBalance,
        lastTxId: txId,
        pets: updatedPets,
        updatedAt: serverTimestamp()
      });
    } else {
      tx.update(worldRef, {
        pets: updatedPets,
        updatedAt: serverTimestamp()
      });
    }

    return { pet: newPet, cost, count: updatedPets.length };
  });
}

/**
 * Chăm sóc & Vui chơi với thú cưng (`feed`, `pet`, `play`, `rest`).
 */
export async function careForPet({ petId, action }) {
  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);

  return runTransaction(db, async (tx) => {
    const worldSnap = await tx.get(worldRef);
    if (!worldSnap.exists()) throw new Error('Không tìm thấy dữ liệu đảo.');

    const pets = getNormalizedPets(worldSnap.data());
    const idx = pets.findIndex((p) => p.id === petId);
    if (idx === -1) throw new Error('Không tìm thấy bé thú cưng này.');

    const target = pets[idx];
    const live = computePetLiveStats(target, Date.now());

    let { hunger, happiness, energy } = live;
    let effectLabel = '';

    if (action === 'feed') {
      hunger = Math.min(100, hunger + 28);
      happiness = Math.min(100, happiness + 8);
      energy = Math.min(100, energy + 5);
      effectLabel = '🍖 Măm măm ngon quá!';
    } else if (action === 'pet') {
      happiness = Math.min(100, happiness + 20);
      energy = Math.min(100, energy + 4);
      effectLabel = '🤚 Đã vuốt ve cưng nựng!';
    } else if (action === 'play') {
      if (energy < 18) {
        throw new Error(`${target.name} đang thấm mệt rồi, hãy cho bé nghỉ ngơi chút nhé! 💤`);
      }
      happiness = Math.min(100, happiness + 26);
      hunger = Math.max(8, hunger - 6);
      energy = Math.max(10, energy - 12);
      effectLabel = '🎾 Chơi đùa thích mê!';
    } else if (action === 'rest') {
      energy = Math.min(100, energy + 35);
      happiness = Math.min(100, happiness + 6);
      effectLabel = '💤 Bé đã nạp đầy năng lượng!';
    } else {
      throw new Error('Hành động không hợp lệ.');
    }

    const updatedPet = {
      ...target,
      hunger,
      happiness,
      energy,
      lastUpdatedMs: Date.now()
    };

    const nextPets = [...pets];
    nextPets[idx] = updatedPet;

    tx.update(worldRef, {
      pets: nextPets,
      updatedAt: serverTimestamp()
    });

    return { pet: updatedPet, effectLabel };
  });
}

/**
 * Đổi tên thú cưng.
 */
export async function renamePetById({ petId, newName, worldData }) {
  const cleanName = String(newName || '').trim();
  if (cleanName.length < 1 || cleanName.length > 18) {
    throw new Error('Tên thú cưng cần từ 1 đến 18 ký tự.');
  }

  const pets = getNormalizedPets(worldData);
  const nextPets = pets.map((p) => (p.id === petId ? { ...p, name: cleanName } : p));

  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  await updateDoc(worldRef, {
    pets: nextPets,
    updatedAt: serverTimestamp()
  });
}

/**
 * Đeo hoặc tháo Phụ kiện dễ thương cho thú cưng từ Túi đồ chung.
 * @param {{ petId: string, accessoryId: string|null }} params
 */
export async function equipPetAccessory({ petId, accessoryId }) {
  const worldRef = doc(db, 'worlds', SHARED_WORLD_ID);
  const invRef = doc(db, 'inventory', SHARED_WORLD_ID);

  return runTransaction(db, async (tx) => {
    const [worldSnap, invSnap] = await Promise.all([
      tx.get(worldRef),
      tx.get(invRef)
    ]);

    if (!worldSnap.exists()) throw new Error('Không tìm thấy dữ liệu đảo.');
    const pets = getNormalizedPets(worldSnap.data());
    const idx = pets.findIndex((p) => p.id === petId);
    if (idx === -1) throw new Error('Không tìm thấy bé thú cưng này.');

    if (accessoryId) {
      const info = getPetAccessoryInfo(accessoryId);
      if (!info) throw new Error('Phụ kiện thú cưng không hợp lệ.');

      const inv = invSnap.exists() ? invSnap.data() : buildDefaultInventory();
      const ownedCount = Number(inv.petAccessories?.[accessoryId] || 0);
      const equippedElsewhere = pets.filter((p) => p.id !== petId && p.accessoryId === accessoryId).length;

      if (equippedElsewhere >= ownedCount) {
        throw new Error(`Bạn đã đeo hết số "${info.name}" đang có (${ownedCount}/${ownedCount}). Hãy mua thêm ở Cửa hàng nhé!`);
      }
    }

    const nextPets = [...pets];
    nextPets[idx] = {
      ...nextPets[idx],
      accessoryId: accessoryId || null
    };

    tx.update(worldRef, {
      pets: nextPets,
      updatedAt: serverTimestamp()
    });

    return nextPets[idx];
  });
}

/* ==========================================================================
   Mô Phỏng Chuyển Động Tự Nhiên & Vẽ Map 2D Sân Chơi Thú Cưng (Tối Đa 10 Con)
   ========================================================================== */
const localPetActors = new Map();

function syncLocalPetActors(pets, dt) {
  const validIds = new Set(pets.map((p) => p.id));
  for (const key of localPetActors.keys()) {
    if (!validIds.has(key)) localPetActors.delete(key);
  }

  pets.forEach((pet, idx) => {
    let actor = localPetActors.get(pet.id);
    if (!actor) {
      // Xếp vị trí khởi đầu rải đều tự nhiên quanh sân chơi
      const angle = (idx / Math.max(1, pets.length)) * Math.PI * 2;
      const startX = 480 + Math.cos(angle) * (95 + (idx % 3) * 45);
      const startY = 300 + Math.sin(angle) * (65 + (idx % 2) * 40);
      actor = {
        x: startX,
        y: startY,
        tx: startX,
        ty: startY,
        waitTimer: 0.5 + (idx % 4) * 0.7,
        hopPhase: idx,
        excitedTimer: 0
      };
      localPetActors.set(pet.id, actor);
    }

    if (actor.excitedTimer > 0) {
      actor.excitedTimer = Math.max(0, actor.excitedTimer - dt);
    }

    const dx = actor.tx - actor.x;
    const dy = actor.ty - actor.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 4) {
      const speed = 58;
      actor.x += (dx / dist) * speed * dt;
      actor.y += (dy / dist) * speed * dt;
      actor.hopPhase += dt * 10;
    } else {
      actor.waitTimer -= dt;
      if (actor.waitTimer <= 0) {
        actor.waitTimer = 1.6 + Math.random() * 2.8;
        actor.tx = 130 + Math.random() * 700;
        actor.ty = 155 + Math.random() * 315;
      }
    }
  });
}

export function triggerPetExcitedJump(petId) {
  const actor = localPetActors.get(petId);
  if (actor) {
    actor.excitedTimer = 2.2;
  }
}

/**
 * Kiểm tra người chơi có vừa click / chạm trực tiếp vào bé thú cưng nào trên sân không.
 */
export function findTappedPetOnCanvas(mapX, mapY, worldData) {
  const pets = getNormalizedPets(worldData);
  for (let i = pets.length - 1; i >= 0; i--) {
    const p = pets[i];
    const actor = localPetActors.get(p.id);
    if (!actor) continue;
    if (Math.hypot(mapX - actor.x, mapY - (actor.y - 10)) <= 30) {
      return p;
    }
  }
  return null;
}

/**
 * Vẽ Map Khu Thú Cưng & đàn thú cưng chạy nhảy trên sân.
 */
export function drawPetPlaygroundMap(ctx, dt, timeSec, worldData, isNearExit) {
  const pets = getNormalizedPets(worldData);
  syncLocalPetActors(pets, dt);

  // 1. Thảm cỏ công viên thú cưng ấm áp
  ctx.fillStyle = '#e2f6e6';
  ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  ctx.fillStyle = '#fef8ec';
  ctx.strokeStyle = '#e7cfB6'.replace('B', 'b');
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(48, 42, MAP_WIDTH - 96, MAP_HEIGHT - 84, 40);
  ctx.fill();
  ctx.stroke();

  // Thảm cỏ non xanh ở trung tâm sân chơi
  ctx.fillStyle = '#dff5e3';
  ctx.beginPath();
  ctx.roundRect(86, 110, MAP_WIDTH - 172, MAP_HEIGHT - 172, 34);
  ctx.fill();

  // 2. Cổng ra Đảo Chính ở phía Bắc
  ctx.fillStyle = isNearExit ? '#ff8fab' : '#ffffff';
  ctx.strokeStyle = isNearExit ? '#ffffff' : '#f4978e';
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

  // Huy hiệu số lượng thú cưng
  ctx.fillStyle = 'rgba(255, 253, 248, 0.94)';
  ctx.strokeStyle = '#ffc2d1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(66, 54, 206, 30, 15);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d94d72';
  ctx.font = '800 12px Nunito, sans-serif';
  ctx.fillText(`🐾 Thú cưng trên sân: ${pets.length}/${MAX_PETS}`, 169, 69);

  // 3. Đồ chơi công viên thú cưng (Nệm êm, Hồ nước nhỏ, Bát ăn, Bóng len)
  // Hồ nước tròn bên phải
  ctx.fillStyle = '#bde8f1';
  ctx.strokeStyle = '#faedcd';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(760, 210, 56, 36, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Nệm ngủ pastel bên trái
  for (const cushion of [
    { x: 175, y: 205, c: '#ffd6e0' },
    { x: 245, y: 185, c: '#d8f3dc' },
    { x: 185, y: 415, c: '#faedcd' }
  ]) {
    ctx.fillStyle = cushion.c;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cushion.x, cushion.y, 28, 19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Khay thức ăn & bóng lăn
  ctx.fillStyle = '#ff8fab';
  ctx.beginPath();
  ctx.arc(745, 415, 12, 0, Math.PI * 2);
  ctx.arc(778, 415, 12, 0, Math.PI * 2);
  ctx.fill();

  const ballRoll = Math.sin(timeSec * 2) * 14;
  ctx.fillStyle = '#cdb4db';
  ctx.beginPath();
  ctx.arc(480 + ballRoll, 395, 9, 0, Math.PI * 2);
  ctx.fill();

  // Nếu chưa nhận nuôi bé nào -> hiện dòng gợi ý dễ thương giữa sân
  if (pets.length === 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = '#ffc2d1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(290, 255, 380, 54, 27);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#d94d72';
    ctx.font = '800 13.5px Nunito, sans-serif';
    ctx.fillText('🐾 Bấm nút "➕ Đón thú cưng" bên dưới để nhận bé đầu tiên miễn phí!', 480, 282);
    return;
  }

  // 4. Vẽ tất cả các bé thú cưng (tối đa 10 con)
  const sortedPets = [...pets].sort((a, b) => {
    const ya = localPetActors.get(a.id)?.y || 0;
    const yb = localPetActors.get(b.id)?.y || 0;
    return ya - yb;
  });

  for (const pet of sortedPets) {
    const actor = localPetActors.get(pet.id);
    if (!actor) continue;
    drawCutePetActor(ctx, pet, actor, timeSec);
  }
}

function drawCutePetActor(ctx, pet, actor, timeSec) {
  const sp = PET_SPECIES[pet.type] || PET_SPECIES.cat;
  const isJumping = actor.excitedTimer > 0;
  const hopY = isJumping
    ? Math.abs(Math.sin(timeSec * 12)) * -12
    : Math.abs(Math.sin(actor.hopPhase)) * -3.5;

  const x = actor.x;
  const y = actor.y;

  ctx.save();

  // Bóng chân
  ctx.fillStyle = 'rgba(74, 59, 50, 0.14)';
  ctx.beginPath();
  ctx.ellipse(x, y + 3, 14, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Thân tròn mũm mĩm
  const cy = y - 10 + hopY;
  ctx.fillStyle = sp.bodyColor;
  ctx.strokeStyle = '#c9a98d';
  ctx.lineWidth = 1.8;

  // Tai theo loài (Mèo nhọn, Thỏ dài, Cún cụp)
  if (pet.type === 'bunny') {
    ctx.fillStyle = sp.bodyColor;
    ctx.beginPath();
    ctx.ellipse(x - 6, cy - 16, 4, 10, -0.15, 0, Math.PI * 2);
    ctx.ellipse(x + 6, cy - 16, 4, 10, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (pet.type === 'cat') {
    ctx.fillStyle = sp.earColor;
    ctx.beginPath();
    ctx.moveTo(x - 11, cy - 6);
    ctx.lineTo(x - 8, cy - 17);
    ctx.lineTo(x - 2, cy - 10);
    ctx.moveTo(x + 11, cy - 6);
    ctx.lineTo(x + 8, cy - 17);
    ctx.lineTo(x + 2, cy - 10);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = sp.earColor;
    ctx.beginPath();
    ctx.ellipse(x - 12, cy - 4, 4.5, 8, 0.3, 0, Math.PI * 2);
    ctx.ellipse(x + 12, cy - 4, 4.5, 8, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Đầu & thân
  ctx.fillStyle = sp.bodyColor;
  ctx.beginPath();
  ctx.arc(x, cy, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Mắt long lanh & má hồng
  ctx.fillStyle = '#4a3b32';
  ctx.beginPath();
  ctx.arc(x - 4.5, cy - 1, 1.8, 0, Math.PI * 2);
  ctx.arc(x + 4.5, cy - 1, 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ff8fab';
  ctx.beginPath();
  ctx.arc(x, cy + 2, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Phụ kiện thú cưng đang đeo (Nơ hồng, Chuông vàng, Hoa đào, Vương miện)
  if (pet.accessoryId) {
    const accInfo = getPetAccessoryInfo(pet.accessoryId);
    if (accInfo) {
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const isCrownOrFlower = pet.accessoryId === 'pet_acc_crown' || pet.accessoryId === 'pet_acc_flower';
      ctx.fillText(accInfo.icon, x, isCrownOrFlower ? cy - 15 : cy + 10);
    }
  }

  // Trái tim bay lên khi vừa được cưng nựng / cho ăn
  if (isJumping) {
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💕', x, cy - 26);
  }

  // Nhãn tên nhỏ dưới chân thú cưng
  ctx.font = '800 10.5px Nunito, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  const tw = ctx.measureText(pet.name).width + 10;
  ctx.beginPath();
  ctx.roundRect(x - tw / 2, y + 6, tw, 16, 8);
  ctx.fill();

  ctx.fillStyle = '#5c4b40';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pet.name, x, y + 14);

  ctx.restore();
}
