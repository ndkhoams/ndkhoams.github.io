/**
 * TV Play — Player Engine (YouTube-Style Controls & Cinema Experience)
 * Features:
 * - YouTube-Style Bottom Control Bar (Play/Pause, Next, Volume Slider, Live Badge, Quality Gear, Multi-View, PiP, Theater, Fullscreen)
 * - Auto-hiding HUD (3s timeout while playing)
 * - Single click toggle play/pause, double click toggle fullscreen
 * - Native Safari HLS + Desktop Hls.js + Shaka Player ClearKey DASH
 * - Dynamic HLS quality switching (Auto / 1080p / 720p / 540p)
 * - Theater Mode (Full width layout)
 */

class StrandPlayer {
  constructor() {
    this.video = document.getElementById('mainVideo');
    this.hls = null;
    this.shakaPlayer = null;
    this.currentChannel = null;
    this.isPlaying = false;
    this.isPseudoFullscreen = false;
    this.currentVolume = 1.0;
    this.clickTimer = null;
    this.init();
  }

  init() {
    if (!this.video) return;

    // 1. Listen to video playback events
    this.video.addEventListener('play', () => this.onPlayStateChange(true));
    this.video.addEventListener('pause', () => this.onPlayStateChange(false));
    this.video.addEventListener('waiting', () => this.showBuffering(true));
    this.video.addEventListener('playing', () => this.showBuffering(false));
    this.video.addEventListener('error', (e) => this.onError(e));
    this.video.addEventListener('timeupdate', () => this.onTimeUpdate());

    // 2. Click & Double-click on Video Surface
    const surface = document.getElementById('playerSurface');
    if (surface) {
      surface.addEventListener('click', (e) => {
        // Tránh kích hoạt khi click vào các nút điều khiển
        if (e.target.closest('.yt-control-bar') || e.target.closest('#centerPlayBtn') || e.target.closest('#ytSettingsMenu')) {
          return;
        }
        if (this.clickTimer) {
          clearTimeout(this.clickTimer);
          this.clickTimer = null;
          // Double click -> Toggle Fullscreen
          this.toggleFullscreen();
        } else {
          this.clickTimer = setTimeout(() => {
            this.clickTimer = null;
            // Single click -> Toggle Play/Pause
            this.togglePlay();
          }, 240);
        }
      });
    }

    // 3. Touch swipe gestures for mobile (chuyển kênh)
    this.initTouchGestures();

    // 4. AirPlay availability
    this.initAirPlay();

    // 5. YouTube Controls Auto-Hide
    this.initHUDAutoHide();

    // 6. Volume
    this.initVolume();

    // 7. Fullscreen change listeners
    const onFsChange = () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement) || this.isPseudoFullscreen;
      this.updateFullscreenIcon(isFs);
      if (!isFs && screen.orientation && screen.orientation.unlock) {
        try { screen.orientation.unlock(); } catch (e) {}
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);

    window.addEventListener('resize', () => {
      if (this.isPseudoFullscreen) this.updatePseudoFullscreenLayout();
    });
    window.addEventListener('orientationchange', () => {
      if (this.isPseudoFullscreen) setTimeout(() => this.updatePseudoFullscreenLayout(), 150);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isPseudoFullscreen) {
        this.exitPseudoFullscreen();
      }
    });

    // 8. Close settings menu on outside click
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('ytSettingsMenu');
      const btn = document.getElementById('ytSettingsBtn');
      if (menu && !menu.classList.contains('hidden')) {
        if (!menu.contains(e.target) && !btn?.contains(e.target)) {
          menu.classList.add('hidden');
        }
      }
    });

    // Restore Theater Mode preference
    try {
      if (localStorage.getItem('tvplay_theater_mode') === 'true') {
        document.body.classList.add('is-theater-mode');
        this.updateTheaterUI(true);
      }
    } catch (e) {}
  }

  playStream(streamUrl, channelInfo = {}) {
    if (!this.video || !streamUrl) return;

    let targetUrl = streamUrl;
    if (typeof streamUrl === 'string' && streamUrl.includes('|')) {
      targetUrl = streamUrl.split('|')[0].trim();
    }

    if (this.showHUD) this.showHUD();
    this.currentChannel = channelInfo;
    this.updateHUD(channelInfo);
    this.showBuffering(true);

    const isDash = targetUrl.includes('.mpd') || !!channelInfo.dash || !!channelInfo.clearKey;
    const isHls = targetUrl.includes('.m3u8') || targetUrl.includes('play.m3u8');

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.shakaPlayer) {
      this.shakaPlayer.destroy().catch(() => {});
      this.shakaPlayer = null;
    }

    // 1. DASH with ClearKey (Shaka Player)
    if (isDash && window.shaka && window.shaka.Player && window.shaka.Player.isBrowserSupported()) {
      window.shaka.polyfill.installAll();
      const shakaInstance = new window.shaka.Player();
      this.shakaPlayer = shakaInstance;

      shakaInstance.attach(this.video).then(() => {
        if (channelInfo.clearKey && channelInfo.clearKey.keyId && channelInfo.clearKey.key) {
          shakaInstance.configure({
            drm: {
              clearKeys: {
                [channelInfo.clearKey.keyId]: channelInfo.clearKey.key
              }
            }
          });
        }
        return shakaInstance.load(targetUrl);
      }).then(() => {
        this.safePlay();
      }).catch(err => {
        console.error('[Player] Shaka error, falling back:', err);
        this.video.src = targetUrl;
        this.safePlay();
      });
    }
    // 2. Hls.js for Desktop & Android browsers
    else if (window.Hls && window.Hls.isSupported() && isHls) {
      this.hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        xhrSetup: function(xhr, url) {
          xhr.withCredentials = false;
        }
      });
      this.hls.loadSource(targetUrl);
      this.hls.attachMedia(this.video);
      this.hls.on(window.Hls.Events.MANIFEST_PARSED, (event, data) => {
        this.updateQualityMenu();
        this.safePlay();
      });
      this.hls.on(window.Hls.Events.LEVEL_SWITCHED, (event, data) => {
        this.onLevelSwitched(data.level);
      });
      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('[Player] HLS Network error, trying recovery...');
              this.hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('[Player] HLS Media error, attempting recovery...');
              this.hls.recoverMediaError();
              break;
            default:
              console.error('[Player] Unrecoverable HLS error, falling back...');
              this.hls.destroy();
              this.video.src = targetUrl;
              this.safePlay();
              break;
          }
        }
      });
    }
    // 3. Native iOS Safari support
    else if (!isDash && this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = targetUrl;
      this.safePlay();
    }
    // 4. Direct src fallback
    else {
      this.video.src = targetUrl;
      this.safePlay();
    }

    this.updateAmbientGlow(channelInfo);
  }

  safePlay() {
    if (!this.video) return;
    const playPromise = this.video.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        this.showPlayButtonOverlay(false);
        this.showBuffering(false);
      }).catch(err => {
        console.warn('[Player] Autoplay unmuted blocked, falling back to muted...', err);
        this.video.muted = true;
        this.updateMuteUI(true);

        const retryPromise = this.video.play();
        if (retryPromise !== undefined) {
          retryPromise.then(() => {
            this.showPlayButtonOverlay(false);
            this.showBuffering(false);
          }).catch(err2 => {
            console.warn('[Player] Autoplay blocked, showing center play button:', err2);
            this.showPlayButtonOverlay(true);
            this.showBuffering(false);
          });
        }
      });
    }
  }

  togglePlay() {
    if (!this.video) return;
    if (this.video.paused) {
      this.video.muted = false;
      this.updateMuteUI(false);
      this.video.play().catch(() => {
        this.video.muted = true;
        this.updateMuteUI(true);
        this.video.play().catch(() => {});
      });
      this.showPlayButtonOverlay(false);
    } else {
      this.video.pause();
      this.showPlayButtonOverlay(true);
    }
  }

  onTimeUpdate() {
    if (!this.video) return;
    // For live streams with finite duration, or VOD
    const cur = this.video.currentTime;
    const dur = this.video.duration;
    const playLine = document.getElementById('ytProgressPlay');
    if (playLine && dur && !isNaN(dur) && isFinite(dur) && dur > 0) {
      const pct = Math.min(100, (cur / dur) * 100);
      playLine.style.width = `${pct}%`;
    }
  }

  seek(event) {
    if (!this.video) return;
    const bar = document.getElementById('ytProgressBar');
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    if (this.video.duration && isFinite(this.video.duration)) {
      this.video.currentTime = pos * this.video.duration;
    }
  }

  // ================= VOLUME & AUDIO =================
  initVolume() {
    if (!this.video) return;
    const saved = localStorage.getItem('tvplay_volume');
    this.currentVolume = (saved !== null) ? parseFloat(saved) : 1.0;
    this.video.volume = this.currentVolume;
    this.updateVolumeUI();
  }

  setVolume(val) {
    if (!this.video) return;
    const num = Math.max(0, Math.min(1, parseFloat(val)));
    this.currentVolume = num;
    this.video.volume = num;
    if (num > 0 && this.video.muted) {
      this.video.muted = false;
    } else if (num === 0) {
      this.video.muted = true;
    }
    try {
      localStorage.setItem('tvplay_volume', num.toString());
    } catch (e) {}
    this.updateVolumeUI();
  }

  toggleMute() {
    if (!this.video) return;
    if (this.video.muted || this.video.volume === 0) {
      this.video.muted = false;
      if (this.video.volume === 0) {
        this.video.volume = (this.currentVolume > 0) ? this.currentVolume : 1.0;
      }
    } else {
      this.video.muted = true;
    }
    this.updateVolumeUI();
  }

  updateMuteUI(isMuted) {
    this.updateVolumeUI();
  }

  updateVolumeUI() {
    if (!this.video) return;
    const isMuted = this.video.muted || this.video.volume === 0;
    const vol = isMuted ? 0 : this.video.volume;

    // Cập nhật cả 2 slider (thanh YouTube mới và thanh cũ nếu có)
    const sliders = [
      document.getElementById('ytVolSlider'),
      document.getElementById('volumeSlider')
    ];
    sliders.forEach(slider => {
      if (slider) {
        slider.value = vol;
        slider.style.background = `linear-gradient(to right, #ffffff ${vol * 100}%, rgba(255,255,255,0.2) ${vol * 100}%)`;
      }
    });

    const updateIcons = (highId, lowId, muteId) => {
      const h = document.getElementById(highId);
      const l = document.getElementById(lowId);
      const m = document.getElementById(muteId);
      if (h && l && m) {
        if (isMuted || vol === 0) {
          m.classList.remove('hidden');
          l.classList.add('hidden');
          h.classList.add('hidden');
        } else if (vol <= 0.5) {
          m.classList.add('hidden');
          l.classList.remove('hidden');
          h.classList.add('hidden');
        } else {
          m.classList.add('hidden');
          l.classList.add('hidden');
          h.classList.remove('hidden');
        }
      }
    };

    updateIcons('ytVolHighIcon', 'ytVolLowIcon', 'ytVolMuteIcon');
    updateIcons('volHighIcon', 'volLowIcon', 'volMuteIcon');
  }

  // ================= THEATER & FULLSCREEN =================
  toggleTheaterMode() {
    const isTheater = document.body.classList.toggle('is-theater-mode');
    try {
      localStorage.setItem('tvplay_theater_mode', isTheater ? 'true' : 'false');
    } catch (e) {}
    this.updateTheaterUI(isTheater);
  }

  updateTheaterUI(isTheater) {
    const iconNormal = document.getElementById('ytTheaterNormalIcon');
    const iconWide = document.getElementById('ytTheaterWideIcon');
    if (iconNormal && iconWide) {
      iconNormal.classList.toggle('hidden', isTheater);
      iconWide.classList.toggle('hidden', !isTheater);
    }
  }

  async requestPiP() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (this.video && this.video.requestPictureInPicture) {
        await this.video.requestPictureInPicture();
      } else if (this.video && this.video.webkitSetPresentationMode) {
        this.video.webkitSetPresentationMode('picture-in-picture');
      } else {
        alert('Trình duyệt của bạn chưa hỗ trợ tính năng Picture-in-Picture.');
      }
    } catch (err) {
      console.warn('[Player] PiP failed:', err);
    }
  }

  isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  updateFullscreenIcon(isFullscreen) {
    const enterIcons = document.querySelectorAll('.fullscreen-enter-icon');
    const exitIcons = document.querySelectorAll('.fullscreen-exit-icon');
    enterIcons.forEach(el => el.classList.toggle('hidden', isFullscreen));
    exitIcons.forEach(el => el.classList.toggle('hidden', !isFullscreen));

    const label = document.getElementById('desktopFsLabel');
    if (label) label.textContent = isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình';
  }

  updatePseudoFullscreenLayout() {
    const surface = document.getElementById('playerSurface');
    if (!surface || !this.isPseudoFullscreen) return;

    if (this._exitTimeout) {
      clearTimeout(this._exitTimeout);
      this._exitTimeout = null;
    }
    surface.classList.remove('pseudo-fullscreen-exit');

    const isLandscape = window.innerWidth > window.innerHeight;
    if (isLandscape) {
      surface.classList.remove('pseudo-fullscreen-landscape');
      surface.classList.add('pseudo-fullscreen-normal');
    } else {
      surface.classList.remove('pseudo-fullscreen-normal');
      surface.classList.add('pseudo-fullscreen-landscape');
    }
    document.body.classList.add('has-pseudo-fullscreen');
  }

  exitPseudoFullscreen() {
    const surface = document.getElementById('playerSurface');
    if (!this.isPseudoFullscreen || !surface) return;
    this.isPseudoFullscreen = false;
    this.updateFullscreenIcon(false);

    surface.classList.add('pseudo-fullscreen-exit');
    if (this._exitTimeout) clearTimeout(this._exitTimeout);

    this._exitTimeout = setTimeout(() => {
      surface.classList.remove(
        'pseudo-fullscreen-landscape',
        'pseudo-fullscreen-normal',
        'pseudo-fullscreen-exit'
      );
      document.body.classList.remove('has-pseudo-fullscreen');
      this._exitTimeout = null;
    }, 240);
  }

  async toggleFullscreen() {
    if (!this.video) return;

    if (this.isPseudoFullscreen) {
      this.exitPseudoFullscreen();
      return;
    }

    const isNativeFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (isNativeFullscreen) {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      } catch (err) {}
      this.updateFullscreenIcon(false);
      return;
    }

    const container = document.getElementById('playerSection') || this.video;
    const canNativeRequest = !!(container && (container.requestFullscreen || container.webkitRequestFullscreen));
    const isIOS = this.isIOSDevice();

    if (isIOS || !canNativeRequest) {
      this.isPseudoFullscreen = true;
      this.updatePseudoFullscreenLayout();
      this.updateFullscreenIcon(true);
      return;
    }

    try {
      if (container.requestFullscreen) {
        await container.requestFullscreen();
      } else if (container.webkitRequestFullscreen) {
        await container.webkitRequestFullscreen();
      }
      this.updateFullscreenIcon(true);
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (err) {
      this.isPseudoFullscreen = true;
      this.updatePseudoFullscreenLayout();
      this.updateFullscreenIcon(true);
    }
  }

  // ================= SETTINGS MENU (YOUTUBE POPUP) =================
  toggleSettingsMenu() {
    const menu = document.getElementById('ytSettingsMenu');
    if (!menu) return;
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) {
      this.updateQualityMenu();
    }
  }

  updateQualityMenu() {
    const container = document.getElementById('ytQualityOptions');
    if (!container) return;

    if (this.hls && this.hls.levels && this.hls.levels.length > 0) {
      let html = `
        <button onclick="window.player.setQuality(-1)" class="w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between hover:bg-white/10 ${this.hls.currentLevel === -1 ? 'text-amber-400 font-bold' : 'text-white/80'}">
          <span>Tự động (Auto)</span>
          ${this.hls.currentLevel === -1 ? '✓' : ''}
        </button>
      `;

      this.hls.levels.forEach((lvl, idx) => {
        const height = lvl.height || Math.round((lvl.bitrate || 0) / 1000) + 'k';
        const label = `${height}p`;
        const isCurrent = (this.hls.currentLevel === idx);
        html += `
          <button onclick="window.player.setQuality(${idx})" class="w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between hover:bg-white/10 ${isCurrent ? 'text-amber-400 font-bold' : 'text-white/80'}">
            <span>${label}</span>
            ${isCurrent ? '✓' : ''}
          </button>
        `;
      });
      container.innerHTML = html;
    } else {
      container.innerHTML = `
        <div class="px-2.5 py-1 text-white/50 text-[11px]">Tự động (Mặc định)</div>
      `;
    }
  }

  setQuality(levelIdx) {
    if (this.hls) {
      this.hls.currentLevel = levelIdx;
      this.updateQualityMenu();
    }
    const menu = document.getElementById('ytSettingsMenu');
    if (menu) menu.classList.add('hidden');
  }

  onLevelSwitched(levelIdx) {
    const badge = document.getElementById('ytQualityBadge');
    if (badge && this.hls && this.hls.levels && this.hls.levels[levelIdx]) {
      const h = this.hls.levels[levelIdx].height;
      if (h >= 720) {
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }

  reloadCurrentStream() {
    if (this.currentChannel && (this.currentChannel.url || this.currentChannel.streamUrl)) {
      this.playStream(this.currentChannel.url || this.currentChannel.streamUrl, this.currentChannel);
    }
    const menu = document.getElementById('ytSettingsMenu');
    if (menu) menu.classList.add('hidden');
  }

  // ================= AIRPLAY =================
  initAirPlay() {
    if (window.WebKitPlaybackTargetAvailabilityEvent && this.video) {
      this.video.addEventListener('webkitplaybacktargetavailabilitychanged', event => {
        const btns = document.querySelectorAll('.airplay-btn');
        btns.forEach(btn => {
          btn.style.display = event.availability === 'available' ? 'inline-flex' : 'none';
        });
      });
    }
  }

  triggerAirPlay() {
    if (this.video && this.video.webkitShowPlaybackTargetPicker) {
      this.video.webkitShowPlaybackTargetPicker();
    } else {
      alert('AirPlay: Đang sẵn sàng truyền tới Apple TV hoặc Samsung TV (10.0.0.9).');
    }
  }

  // ================= HUD & CONTROLS AUTO-HIDE =================
  onPlayStateChange(playing) {
    this.isPlaying = playing;
    const playIcons = [document.getElementById('playIcon'), document.getElementById('ytPlayIcon')];
    const pauseIcons = [document.getElementById('pauseIcon'), document.getElementById('ytPauseIcon')];

    playIcons.forEach(icon => {
      if (icon) icon.classList.toggle('hidden', playing);
    });
    pauseIcons.forEach(icon => {
      if (icon) icon.classList.toggle('hidden', !playing);
    });

    this.showPlayButtonOverlay(!playing);

    if (playing) {
      if (this.resetHUDTimer) this.resetHUDTimer();
    } else {
      if (this.showHUD) this.showHUD();
    }
  }

  initHUDAutoHide() {
    this.hudTimer = null;
    const surface = document.getElementById('playerSurface');
    const overlay = document.getElementById('playerHUDOverlay');
    if (!surface || !overlay) return;

    this.showHUD = () => {
      overlay.classList.remove('player-hud-hidden');
      surface.style.cursor = 'default';
      this.resetHUDTimer();
    };

    this.hideHUD = () => {
      // Giữ hiển thị nếu video đang tạm dừng hoặc settings menu đang mở
      const settingsMenu = document.getElementById('ytSettingsMenu');
      if (settingsMenu && !settingsMenu.classList.contains('hidden')) return;
      if (this.video && this.video.paused) return;

      overlay.classList.add('player-hud-hidden');
      surface.style.cursor = 'none';
    };

    this.resetHUDTimer = () => {
      clearTimeout(this.hudTimer);
      this.hudTimer = setTimeout(this.hideHUD, 3500);
    };

    surface.addEventListener('mousemove', this.showHUD);
    surface.addEventListener('mouseenter', this.showHUD);
    surface.addEventListener('touchstart', this.showHUD, { passive: true });

    this.resetHUDTimer();
  }

  showBuffering(loading) {
    const spinner = document.getElementById('bufferingSpinner');
    if (spinner) spinner.classList.toggle('hidden', !loading);
  }

  showPlayButtonOverlay(show) {
    const centerBtn = document.getElementById('centerPlayBtn');
    if (centerBtn) {
      centerBtn.style.opacity = show ? '1' : '0';
      centerBtn.style.pointerEvents = show ? 'auto' : 'none';
    }
  }

  updateHUD(info) {
    const badge = document.getElementById('playerBadgeChannel');
    const title = document.getElementById('playerProgramTitle');
    const subtitle = document.getElementById('playerProgramSubtitle');

    const displayName = info.title || info.name || 'TV Play';
    if (badge) badge.textContent = displayName;
    if (title) title.textContent = displayName;
    if (subtitle && info.subtitle) subtitle.textContent = info.subtitle;

    const ytLiveBadge = document.getElementById('ytBadgeChannel');
    if (ytLiveBadge) ytLiveBadge.textContent = displayName;

    const dName = document.getElementById('desktopChannelName');
    const dSub = document.getElementById('desktopChannelSub');
    const dBadge = document.getElementById('desktopChannelBadge');
    if (dName) dName.textContent = displayName;
    if (dSub && (info.subtitle || info.name)) dSub.textContent = info.subtitle || info.name;
    if (dBadge && info.group) dBadge.textContent = info.group.toUpperCase();
  }

  updateAmbientGlow(info) {
    const glow = document.getElementById('ambientGlow');
    if (!glow) return;
    glow.className = 'ambient-glow';
    const genre = (info.group || info.genre || '').toLowerCase();
    if (genre.includes('thể thao') || genre.includes('sport') || genre.includes('bóng đá')) {
      glow.classList.add('glow-sport');
    } else if (genre.includes('vtv') || genre.includes('tin tức') || genre.includes('news')) {
      glow.classList.add('glow-news');
    } else if (genre.includes('phim') || genre.includes('movie')) {
      glow.classList.add('glow-movie');
    }
  }

  onError(err) {
    console.warn('[Player] Video tag error:', err);
    this.showBuffering(false);
  }

  initTouchGestures() {
    let touchStartX = 0;
    let touchStartY = 0;
    const touchSurface = document.getElementById('playerSurface');
    if (!touchSurface) return;

    touchSurface.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    touchSurface.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].screenX;
      const touchEndY = e.changedTouches[0].screenY;
      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;

      if (Math.abs(diffX) > 60 && Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX < 0) {
          if (window.channelManager) window.channelManager.playNextChannel();
        } else {
          if (window.channelManager) window.channelManager.playPrevChannel();
        }
      }
    }, { passive: true });
  }
}

window.StrandPlayer = StrandPlayer;
