(() => {
  'use strict';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const wrapper = document.getElementById('game-wrapper');
  const scoreEl = document.getElementById('score-display');
  const gameOverOverlay = document.getElementById('game-over-overlay');
  const finalScoreEl = document.getElementById('final-score');
  const bestScoreEl = document.getElementById('best-score');
  const playAgainBtn = document.getElementById('play-again-btn');
  const audioControls = document.getElementById('audio-controls');
  const musicToggleBtn = document.getElementById('music-toggle-btn');
  const musicVolumeInput = document.getElementById('music-volume');

  // Logical game dimensions matching the 720p portrait reference viewport
  const WIDTH = 720;
  const HEIGHT = 1420;

  // Physics & obstacle constants tuned directly from frame-by-frame reference analysis
  const PLAYER_X = 208;
  const PLAYER_START_Y = 690;
  const HEAD_DRAW_W = 112;
  const HEAD_DRAW_H = 123;
  const HEAD_HIT_RADIUS = 43;

  const GRAVITY = 1720;
  const FLAP_VELOCITY = -610;
  const MAX_FALL_SPEED = 860;

  const BOTTLE_W = 128;
  const BOTTLE_H = 396;
  const PILLAR_W = 112;
  const PIPE_SPEED = 250; // Measured ~250.8 px/s in reference video
  const PIPE_SPAWN_INTERVAL = 2.0; // 500 px horizontal spacing at 250 px/s
  const PIPE_GAP = 378; // Generous playable gap matching video (~380 px)
  const FIRST_PIPE_DELAY = 1.65;

  const CRASH_DELAY_MS = 380; // Time between impact explosion and YOU FAILED! modal
  const BEST_STORAGE_KEY = 'balayya_flappy_best_score';
  const MUSIC_ENABLED_KEY = 'balayya_music_enabled';
  const MUSIC_VOLUME_KEY = 'balayya_music_volume';

  // Assets
  const headImg = new Image();
  headImg.src = 'assets/balayya_head.png';

  const bottleImg = new Image();
  bottleImg.src = 'assets/mansion_house_bottle.png';

  const bgmAudio = new Audio('assets/ne_kanti_chuppuloki.mp3');
  bgmAudio.loop = true;
  bgmAudio.preload = 'auto';

  const failAudio = new Audio('assets/fail_dialogue.mp3');
  failAudio.volume = 1.0;
  failAudio.preload = 'auto';

  let musicEnabled = localStorage.getItem(MUSIC_ENABLED_KEY) !== 'false';
  const savedVol = parseFloat(localStorage.getItem(MUSIC_VOLUME_KEY));
  let musicVolume = Number.isFinite(savedVol) ? Math.min(1, Math.max(0, savedVol)) : 0.8;
  let bgmStarted = false;
  bgmAudio.volume = musicVolume;

  // Background parallax clouds (translucent overlapping circle puffs)
  const clouds = [
    { x: 120, y: 120, scale: 1.35, speed: 34, alpha: 0.11 },
    { x: 420, y: 450, scale: 1.05, speed: 44, alpha: 0.12 },
    { x: 690, y: 400, scale: 1.25, speed: 38, alpha: 0.10 },
    { x: 960, y: 210, scale: 1.15, speed: 42, alpha: 0.11 },
  ];

  // Repeating city skyline silhouette
  const skylineBuildings = [
    { w: 72, h: 160 },
    { w: 94, h: 95 },
    { w: 86, h: 210 },
    { w: 112, h: 140 },
    { w: 78, h: 245 },
    { w: 105, h: 120 },
    { w: 88, h: 185 },
    { w: 96, h: 150 },
  ];
  const SKYLINE_TOTAL_W = skylineBuildings.reduce((acc, b) => acc + b.w + 38, 0);

  // Game state: 'ready' (gentle idle hover on initial load), 'playing', 'crashing', 'gameover'
  let gameState = 'ready';
  let score = 0;
  let bestScore = parseInt(localStorage.getItem(BEST_STORAGE_KEY) || '0', 10) || 0;
  let skylineOffset = 0;

  const player = {
    x: PLAYER_X,
    y: PLAYER_START_Y,
    vy: 0,
    rotation: 0,
    bobTime: 0,
  };

  let pipes = [];
  let spawnTimer = FIRST_PIPE_DELAY;
  let trailParticles = [];
  let crashParticles = [];
  let crashTimer = 0;
  let modalShowTimestamp = 0;
  let lastTime = performance.now();

  function safePlay(audio, restart = false) {
    if (restart) {
      audio.currentTime = 0;
    }
    const promise = audio.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {});
    }
  }

  function stopAudio(audio) {
    audio.pause();
    audio.currentTime = 0;
  }

  function updateScoreUI() {
    scoreEl.textContent = String(score);
  }

  function updateAudioControlsUI() {
    musicToggleBtn.textContent = musicEnabled ? 'Music: ON' : 'Music: OFF';
    musicToggleBtn.setAttribute('aria-pressed', String(musicEnabled));
    musicVolumeInput.value = String(Math.round(musicVolume * 100));
    bgmAudio.volume = musicVolume;
  }

  function ensureMusicPlaying() {
    if (!musicEnabled) return;
    if (!bgmStarted) {
      bgmStarted = true;
      safePlay(bgmAudio, true);
    } else if (bgmAudio.paused) {
      safePlay(bgmAudio, false);
    }
  }

  function spawnFlapParticles() {
    const colors = ['#ffffff', '#5cc2f2', '#8cd4f5', '#9ab0c4'];
    const count = 5;
    for (let i = 0; i < count; i++) {
      trailParticles.push({
        x: player.x - 10 + (Math.random() * 26 - 13),
        y: player.y + 42 + (Math.random() * 18 - 9),
        vx: -95 - Math.random() * 90,
        vy: 30 + Math.random() * 80,
        r: 7 + Math.random() * 8,
        alpha: 0.78 + Math.random() * 0.22,
        life: 0,
        maxLife: 0.48 + Math.random() * 0.28,
        color: colors[i % colors.length],
      });
    }
  }

  function spawnCrashParticles() {
    const colors = ['#eb5350', '#42a5f5', '#ffffff', '#e57373', '#64b5f6'];
    const count = 30;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.35 - 0.175);
      const speed = 160 + Math.random() * 340;
      crashParticles.push({
        x: player.x + (Math.random() * 24 - 12),
        y: player.y + (Math.random() * 24 - 12),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        r: 7 + Math.random() * 12,
        alpha: 0.95,
        life: 0,
        maxLife: 0.65 + Math.random() * 0.35,
        color: colors[i % colors.length],
      });
    }
  }

  function spawnPipe() {
    // Keep gaps comfortably inside playable zone so both top & bottom bottles remain visible
    const minTopCapY = 230;
    const maxTopCapY = HEIGHT - PIPE_GAP - 360; // ~682
    const topCapY = minTopCapY + Math.random() * (maxTopCapY - minTopCapY);
    const bottomCapY = topCapY + PIPE_GAP;

    pipes.push({
      x: WIDTH + 20,
      topCapY,
      bottomCapY,
      passed: false,
    });
  }

  function flap() {
    if (gameState === 'crashing' || gameState === 'gameover') {
      return;
    }

    if (gameState === 'ready') {
      gameState = 'playing';
      spawnTimer = FIRST_PIPE_DELAY;
      ensureMusicPlaying();
    } else {
      ensureMusicPlaying();
    }

    player.vy = FLAP_VELOCITY;
    player.rotation = -0.32;
    spawnFlapParticles();
  }

  function triggerCrash() {
    if (gameState === 'crashing' || gameState === 'gameover') return;
    gameState = 'crashing';
    crashTimer = 0;
    player.vy = -180;
    spawnCrashParticles();
  }

  function showGameOver() {
    gameState = 'gameover';
    modalShowTimestamp = performance.now();

    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem(BEST_STORAGE_KEY, String(bestScore));
    }

    finalScoreEl.textContent = String(score);
    bestScoreEl.textContent = String(bestScore);
    scoreEl.classList.add('hidden');
    gameOverOverlay.classList.remove('hidden');

    safePlay(failAudio, true);
  }

  function restartGame() {
    stopAudio(failAudio);
    score = 0;
    updateScoreUI();
    scoreEl.classList.remove('hidden');
    gameOverOverlay.classList.add('hidden');

    player.y = PLAYER_START_Y;
    player.vy = FLAP_VELOCITY * 0.72;
    player.rotation = -0.25;
    pipes = [];
    trailParticles = [];
    crashParticles = [];
    spawnTimer = FIRST_PIPE_DELAY;
    gameState = 'playing';

    spawnFlapParticles();
    ensureMusicPlaying();
  }

  function circleIntersectsRect(cx, cy, r, rx, ry, rw, rh) {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy < r * r;
  }

  function checkPipeCollision(pipe) {
    const cx = player.x;
    const cy = player.y;
    const r = HEAD_HIT_RADIUS;
    const centerX = pipe.x + BOTTLE_W / 2;

    // Top upside-down bottle hitboxes (cap at bottom -> neck -> shoulders -> body -> pillar)
    const topCapH = BOTTLE_H * 0.25;
    const topShoulderH = BOTTLE_H * 0.18;
    const topBodyH = BOTTLE_H * 0.57;

    const topCapRect = [centerX - 21, pipe.topCapY - topCapH, 42, topCapH];
    const topShoulderRect = [centerX - 42, pipe.topCapY - topCapH - topShoulderH, 84, topShoulderH];
    const topBodyRect = [centerX - 59, pipe.topCapY - BOTTLE_H, 118, topBodyH];
    const topBaseY = pipe.topCapY - BOTTLE_H;

    if (
      circleIntersectsRect(cx, cy, r, ...topCapRect) ||
      circleIntersectsRect(cx, cy, r, ...topShoulderRect) ||
      circleIntersectsRect(cx, cy, r, ...topBodyRect) ||
      (topBaseY > 0 && circleIntersectsRect(cx, cy, r, centerX - PILLAR_W / 2, 0, PILLAR_W, topBaseY + 6))
    ) {
      return true;
    }

    // Bottom upright bottle hitboxes (cap at top -> neck -> shoulders -> body -> pillar)
    const botCapRect = [centerX - 21, pipe.bottomCapY, 42, topCapH];
    const botShoulderRect = [centerX - 42, pipe.bottomCapY + topCapH, 84, topShoulderH];
    const botBodyRect = [centerX - 59, pipe.bottomCapY + topCapH + topShoulderH, 118, topBodyH];
    const botBaseY = pipe.bottomCapY + BOTTLE_H;

    if (
      circleIntersectsRect(cx, cy, r, ...botCapRect) ||
      circleIntersectsRect(cx, cy, r, ...botShoulderRect) ||
      circleIntersectsRect(cx, cy, r, ...botBodyRect) ||
      circleIntersectsRect(cx, cy, r, centerX - PILLAR_W / 2, botBaseY - 6, PILLAR_W, HEIGHT - botBaseY + 6)
    ) {
      return true;
    }

    return false;
  }

  function updateParticles(list, dt, applyGravity = false) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        list.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (applyGravity) {
        p.vy += 480 * dt;
      }
    }
  }

  function update(dt) {
    // Clouds and skyline scroll during ready & playing states
    if (gameState === 'ready' || gameState === 'playing') {
      skylineOffset = (skylineOffset + 38 * dt) % SKYLINE_TOTAL_W;
      for (const c of clouds) {
        c.x -= c.speed * dt;
        if (c.x < -220) {
          c.x = WIDTH + 200;
        }
      }
    }

    updateParticles(trailParticles, dt, false);
    updateParticles(crashParticles, dt, true);

    if (gameState === 'ready') {
      player.bobTime += dt;
      player.y = PLAYER_START_Y + Math.sin(player.bobTime * 3.2) * 14;
      player.rotation = Math.sin(player.bobTime * 3.2) * 0.04;
      return;
    }

    if (gameState === 'playing') {
      player.vy = Math.min(MAX_FALL_SPEED, player.vy + GRAVITY * dt);
      player.y += player.vy * dt;

      // Subtle tilt based on vertical velocity
      const targetRot = player.vy < 0 ? -0.32 : Math.min(0.48, (player.vy / MAX_FALL_SPEED) * 0.52);
      player.rotation += (targetRot - player.rotation) * Math.min(1, dt * 10);

      // Soft top ceiling clamp
      if (player.y - HEAD_HIT_RADIUS < 0) {
        player.y = HEAD_HIT_RADIUS;
        player.vy = 0;
      }

      // Ground collision
      if (player.y + HEAD_HIT_RADIUS >= HEIGHT) {
        player.y = HEIGHT - HEAD_HIT_RADIUS;
        triggerCrash();
        return;
      }

      // Spawn & move bottle obstacles
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnPipe();
        spawnTimer = PIPE_SPAWN_INTERVAL;
      }

      for (let i = pipes.length - 1; i >= 0; i--) {
        const pipe = pipes[i];
        pipe.x -= PIPE_SPEED * dt;

        // Increment score when passing center of obstacle
        if (!pipe.passed && pipe.x + BOTTLE_W / 2 < player.x) {
          pipe.passed = true;
          score += 1;
          updateScoreUI();
        }

        if (checkPipeCollision(pipe)) {
          triggerCrash();
          return;
        }

        if (pipe.x + BOTTLE_W < -60) {
          pipes.splice(i, 1);
        }
      }
    } else if (gameState === 'crashing') {
      crashTimer += dt * 1000;
      player.vy += GRAVITY * 0.85 * dt;
      player.y += player.vy * dt;
      player.rotation -= 4.8 * dt;

      if (crashTimer >= CRASH_DELAY_MS) {
        showGameOver();
      }
    }
  }

  function drawSkyAndBackground() {
    // Deep navy gradient matching reference frames
    const skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    skyGrad.addColorStop(0, '#131d31');
    skyGrad.addColorStop(0.45, '#1c2638');
    skyGrad.addColorStop(1, '#27354c');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Translucent layered clouds
    for (const c of clouds) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(c.scale, c.scale);
      ctx.fillStyle = `rgba(255, 255, 255, ${c.alpha})`;

      const puffs = [
        { x: -45, y: 12, r: 48 },
        { x: -5, y: -16, r: 58 },
        { x: 48, y: 6, r: 50 },
        { x: 8, y: 24, r: 44 },
      ];
      for (const puff of puffs) {
        ctx.beginPath();
        ctx.arc(puff.x, puff.y, puff.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Subtle dark city skyline silhouette at bottom
    ctx.fillStyle = 'rgba(13, 20, 32, 0.56)';
    for (let pass = 0; pass < 2; pass++) {
      let drawX = -skylineOffset + pass * SKYLINE_TOTAL_W;
      for (const b of skylineBuildings) {
        if (drawX + b.w > -20 && drawX < WIDTH + 20) {
          ctx.fillRect(drawX, HEIGHT - b.h, b.w, b.h);
        }
        drawX += b.w + 38;
      }
    }
  }

  function drawPillar(x, y, width, height) {
    if (height <= 0) return;
    const grad = ctx.createLinearGradient(x, 0, x + width, 0);
    grad.addColorStop(0, '#0d141e');
    grad.addColorStop(0.28, '#283444');
    grad.addColorStop(0.48, '#3d4c5f');
    grad.addColorStop(0.75, '#1e2736');
    grad.addColorStop(1, '#0b1018');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, width, height);
  }

  function drawPipes() {
    for (const pipe of pipes) {
      const centerX = pipe.x + BOTTLE_W / 2;
      const pillarX = centerX - PILLAR_W / 2;

      // Top inverted bottle + optional top pillar
      const topBottleTopY = pipe.topCapY - BOTTLE_H;
      if (topBottleTopY > 0) {
        drawPillar(pillarX, 0, PILLAR_W, topBottleTopY + 8);
      }

      if (bottleImg.complete && bottleImg.naturalWidth > 0) {
        ctx.save();
        ctx.translate(centerX, pipe.topCapY);
        ctx.scale(1, -1);
        ctx.drawImage(bottleImg, -BOTTLE_W / 2, 0, BOTTLE_W, BOTTLE_H);
        ctx.restore();

        // Bottom pillar + upright bottle
        const botBaseY = pipe.bottomCapY + BOTTLE_H;
        drawPillar(pillarX, botBaseY - 8, PILLAR_W, HEIGHT - botBaseY + 8);
        ctx.drawImage(bottleImg, pipe.x, pipe.bottomCapY, BOTTLE_W, BOTTLE_H);
      }
    }
  }

  function drawParticles(list) {
    for (const p of list) {
      const progress = p.life / p.maxLife;
      const opacity = Math.max(0, p.alpha * (1 - progress));
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPlayer() {
    // Soft ambient radial glow behind head
    const glow = ctx.createRadialGradient(player.x, player.y, 12, player.x, player.y, 88);
    glow.addColorStop(0, 'rgba(165, 205, 235, 0.24)');
    glow.addColorStop(0.6, 'rgba(130, 175, 210, 0.08)');
    glow.addColorStop(1, 'rgba(130, 175, 210, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 88, 0, Math.PI * 2);
    ctx.fill();

    if (headImg.complete && headImg.naturalWidth > 0) {
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.rotation);
      ctx.drawImage(headImg, -HEAD_DRAW_W / 2, -HEAD_DRAW_H / 2, HEAD_DRAW_W, HEAD_DRAW_H);
      ctx.restore();
    }
  }

  function render() {
    drawSkyAndBackground();
    drawPipes();
    drawParticles(trailParticles);
    drawPlayer();
    drawParticles(crashParticles);
  }

  function gameLoop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    update(dt);
    render();
    requestAnimationFrame(gameLoop);
  }

  // Controls: Pointer/Touch anywhere on game area, Space/ArrowUp/W on keyboard
  wrapper.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#game-over-overlay') || e.target.closest('#audio-controls')) return;
    e.preventDefault();
    flap();
  });

  ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach((evtName) => {
    audioControls.addEventListener(evtName, (e) => {
      e.stopPropagation();
    });
  });

  musicToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    musicEnabled = !musicEnabled;
    localStorage.setItem(MUSIC_ENABLED_KEY, String(musicEnabled));

    if (musicEnabled) {
      if (musicVolume === 0) {
        musicVolume = 0.5;
        localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume));
      }
      ensureMusicPlaying();
    } else {
      bgmAudio.pause();
    }
    updateAudioControlsUI();
    musicToggleBtn.blur();
  });

  musicVolumeInput.addEventListener('input', (e) => {
    e.stopPropagation();
    musicVolume = Math.min(1, Math.max(0, Number(e.target.value) / 100));
    bgmAudio.volume = musicVolume;
    localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume));
  });

  musicVolumeInput.addEventListener('change', () => {
    musicVolumeInput.blur();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      if (gameState === 'gameover') {
        if (performance.now() - modalShowTimestamp > 450) {
          restartGame();
        }
        return;
      }
      if (!e.repeat) {
        flap();
      }
    } else if (e.code === 'Enter' && gameState === 'gameover') {
      if (performance.now() - modalShowTimestamp > 450) {
        restartGame();
      }
    }
  });

  playAgainBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    restartGame();
  });

  updateScoreUI();
  updateAudioControlsUI();
  requestAnimationFrame(gameLoop);
})();
