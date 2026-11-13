/**
 * TV Play Strand Edition — Player Engine
 * Supports Native Safari HLS (iOS) and Hls.js fallback for desktop/other browsers.
 */

class StrandPlayer {
  constructor() {
    this.video = document.getElementById('mainVideo');
    this.hls = null;
    this.shakaPlayer = null;
    this.currentChannel = null;
    this.isPlaying = false;
    this.init();
  }

  init() {
    if (!this.video) return;

    // Listen to video events
    this.video.addEventListener('play', () => this.onPlayStateChange(true));
    this.video.addEventListener('pause', () => this.onPlayStateChange(false));
    this.video.addEventListener('waiting', () => this.showBuffering(true));
    this.video.addEventListener('playing', () => this.showBuffering(false));
    this.video.addEventListener('error', (e) => this.onError(e));

    // Touch swipe gestures on video screen
    this.initTouchGestures();

    // Check AirPlay availability
    this.initAirPlay();

    // Auto-hide Top HUD after 5s
    this.initHUDAutoHide();
  }

  playStream(streamUrl, channelInfo = {}) {
    if (!this.video || !streamUrl) return;

    // Chuẩn hóa stream URL nếu chứa cờ header (ví dụ |Referer=...)
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

    // Clean up previous player instances
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
        this.video.play().catch(e => console.warn('[Player] Shaka play catch:', e));
      }).catch(err => {
        console.error('[Player] Shaka error, falling back:', err);
        this.video.src = targetUrl;
        this.video.play().catch(() => {});
      });
    }
    // 2. Native iOS Safari support (Preferred on Apple screens for HLS)
    else if (!isDash && this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = targetUrl;
      const playPromise = this.video.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.warn('[Player] Autoplay prevented, waiting for user tap:', err);
          this.showPlayButtonOverlay(true);
        });
      }
    } 
    // 3. Hls.js fallback for Desktop Chrome, Firefox, Edge
    else if (window.Hls && window.Hls.isSupported() && isHls) {
      this.hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60
      });
      this.hls.loadSource(targetUrl);
      this.hls.attachMedia(this.video);
      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        this.video.play().catch(e => console.warn('[Player] HLS play catch:', e));
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
              console.error('[Player] Unrecoverable HLS error');
              this.hls.destroy();
              break;
          }
        }
      });
    } 
    // 3. Fallback direct src
    else {
      this.video.src = targetUrl;
      this.video.play().catch(() => {});
    }

    // Update Ambient Glow based on group or title
    this.updateAmbientGlow(channelInfo);
  }

  togglePlay() {
    if (!this.video) return;
    if (this.video.paused) {
      this.video.play().catch(() => {});
    } else {
      this.video.pause();
    }
  }

  toggleMute() {
    if (!this.video) return;
    this.video.muted = !this.video.muted;
    const muteIcon = document.getElementById('muteIcon');
    const unmuteIcon = document.getElementById('unmuteIcon');
    if (muteIcon && unmuteIcon) {
      if (this.video.muted) {
        muteIcon.classList.remove('hidden');
        unmuteIcon.classList.add('hidden');
      } else {
        muteIcon.classList.add('hidden');
        unmuteIcon.classList.remove('hidden');
      }
    }
  }

  async requestPiP() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (this.video && this.video.requestPictureInPicture) {
        await this.video.requestPictureInPicture();
      } else if (this.video && this.video.webkitSetPresentationMode) {
        // Safari iOS presentation mode
        this.video.webkitSetPresentationMode('picture-in-picture');
      } else {
        alert('Thiết bị hoặc trình duyệt này chưa hỗ trợ Picture-in-Picture trực tiếp.');
      }
    } catch (err) {
      console.warn('[Player] PiP failed:', err);
    }
  }

  toggleFullscreen() {
    const container = document.getElementById('playerSection') || this.video;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      } else if (container.webkitRequestFullscreen) {
        container.webkitRequestFullscreen();
      } else if (this.video.webkitEnterFullscreen) {
        // Safari iOS native fullscreen video
        this.video.webkitEnterFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  initAirPlay() {
    if (window.WebKitPlaybackTargetAvailabilityEvent && this.video) {
      this.video.addEventListener('webkitplaybacktargetavailabilitychanged', event => {
        const airplayBtn = document.getElementById('airplayBtn');
        if (airplayBtn) {
          airplayBtn.style.display = event.availability === 'available' ? 'inline-flex' : 'none';
        }
      });
    }
  }

  triggerAirPlay() {
    if (this.video && this.video.webkitShowPlaybackTargetPicker) {
      this.video.webkitShowPlaybackTargetPicker();
    } else {
      alert('AirPlay: Đang sẵn sàng truyền tới Apple TV hoặc Samsung TV (10.0.0.9). Đảm bảo thiết bị cùng mạng Wi-Fi.');
    }
  }

  onPlayStateChange(playing) {
    this.isPlaying = playing;
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    if (playIcon && pauseIcon) {
      if (playing) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
      } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
      }
    }
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
      // Giữ nguyên hiển thị điều khiển nếu video đang tạm dừng
      if (this.video && this.video.paused) return;
      overlay.classList.add('player-hud-hidden');
      surface.style.cursor = 'none';
    };

    this.resetHUDTimer = () => {
      clearTimeout(this.hudTimer);
      this.hudTimer = setTimeout(this.hideHUD, 5000);
    };

    surface.addEventListener('mousemove', this.showHUD);
    surface.addEventListener('mouseenter', this.showHUD);
    surface.addEventListener('touchstart', this.showHUD, { passive: true });
    surface.addEventListener('click', this.showHUD);

    // Bắt đầu đếm ngược 5 giây khi vừa khởi tạo
    this.resetHUDTimer();
  }

  showBuffering(loading) {
    const spinner = document.getElementById('bufferingSpinner');
    if (spinner) {
      if (loading) spinner.classList.remove('hidden');
      else spinner.classList.add('hidden');
    }
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

    if (badge && info.name) badge.textContent = info.name;
    if (title && info.title) title.textContent = info.title;
    if (subtitle && info.subtitle) subtitle.textContent = info.subtitle;

    // Desktop player info card
    const dName = document.getElementById('desktopChannelName');
    const dSub = document.getElementById('desktopChannelSub');
    const dBadge = document.getElementById('desktopChannelBadge');
    if (dName && (info.title || info.name)) dName.textContent = info.title || info.name;
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

      // Horizontal swipe detected (threshold 50px, diffX > diffY)
      if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX < 0) {
          // Swipe Left -> Next Channel
          if (window.channelManager) window.channelManager.playNextChannel();
        } else {
          // Swipe Right -> Previous Channel
          if (window.channelManager) window.channelManager.playPrevChannel();
        }
      }
    }, { passive: true });
  }
}

window.StrandPlayer = StrandPlayer;

