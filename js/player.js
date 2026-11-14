/**
 * TV Play — Player Engine
 * Supports Native Safari HLS (iOS) and Hls.js fallback for desktop/other browsers.
 */

class StrandPlayer {
  constructor() {
    this.video = document.getElementById('mainVideo');
    this.hls = null;
    this.shakaPlayer = null;
    this.currentChannel = null;
    this.isPlaying = false;
    this.isPseudoFullscreen = false;
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

    // Initialize volume from localStorage or default
    this.initVolume();

    // Pseudo-fullscreen & standard fullscreen listeners
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
      if (this.isPseudoFullscreen) {
        this.updatePseudoFullscreenLayout();
      }
    });
    window.addEventListener('orientationchange', () => {
      if (this.isPseudoFullscreen) {
        setTimeout(() => this.updatePseudoFullscreenLayout(), 150);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isPseudoFullscreen) {
        this.exitPseudoFullscreen();
      }
    });
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
        this.safePlay();
      }).catch(err => {
        console.error('[Player] Shaka error, falling back:', err);
        this.video.src = targetUrl;
        this.safePlay();
      });
    }
    // 2. Hls.js for Desktop Chrome, Firefox, Edge, Android (MSE supported)
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
      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        this.safePlay();
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
              console.error('[Player] Unrecoverable HLS error, falling back to Shaka Player / Native...');
              this.hls.destroy();
              if (window.shaka && window.shaka.Player && window.shaka.Player.isBrowserSupported()) {
                const sp = new window.shaka.Player();
                this.shakaPlayer = sp;
                sp.attach(this.video).then(() => sp.load(targetUrl)).then(() => this.safePlay()).catch(() => {
                  this.video.src = targetUrl;
                  this.safePlay();
                });
              } else {
                this.video.src = targetUrl;
                this.safePlay();
              }
              break;
          }
        }
      });
    } 
    // 3. Native iOS Safari support (Preferred on Apple screens where MSE HLS is not supported)
    else if (!isDash && this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = targetUrl;
      this.safePlay();
    } 
    // 4. Fallback direct src
    else {
      this.video.src = targetUrl;
      this.safePlay();
    }

    // Update Ambient Glow based on group or title
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
        console.warn('[Player] Unmuted autoplay blocked by browser policy, retrying muted...', err);
        // Trình duyệt máy tính (Chrome/Edge) chặn phát kèm tiếng nếu chưa click trực tiếp vào video
        // Tự động chuyển sang muted để video bắt đầu phát ngay lập tức
        this.video.muted = true;
        this.updateMuteUI(true);

        const retryPromise = this.video.play();
        if (retryPromise !== undefined) {
          retryPromise.then(() => {
            this.showPlayButtonOverlay(false);
            this.showBuffering(false);
          }).catch(err2 => {
            console.warn('[Player] Autoplay completely blocked, showing play button:', err2);
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
        const restoreVol = (this.currentVolume > 0) ? this.currentVolume : 1.0;
        this.video.volume = restoreVol;
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

    const slider = document.getElementById('volumeSlider');
    if (slider) {
      slider.value = vol;
      slider.style.background = `linear-gradient(to right, var(--accent) ${vol * 100}%, rgba(255,255,255,0.2) ${vol * 100}%)`;
    }

    const volHigh = document.getElementById('volHighIcon');
    const volLow = document.getElementById('volLowIcon');
    const volMute = document.getElementById('volMuteIcon');

    if (volHigh && volLow && volMute) {
      if (isMuted || vol === 0) {
        volMute.classList.remove('hidden');
        volLow.classList.add('hidden');
        volHigh.classList.add('hidden');
      } else if (vol <= 0.5) {
        volMute.classList.add('hidden');
        volLow.classList.remove('hidden');
        volHigh.classList.add('hidden');
      } else {
        volMute.classList.add('hidden');
        volLow.classList.add('hidden');
        volHigh.classList.remove('hidden');
      }
    }

    // Legacy IDs
    const muteIcon = document.getElementById('muteIcon');
    const unmuteIcon = document.getElementById('unmuteIcon');
    if (muteIcon && unmuteIcon) {
      if (isMuted) {
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

  isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  updateFullscreenIcon(isFullscreen) {
    const enterIcons = document.querySelectorAll('.fullscreen-enter-icon');
    const exitIcons = document.querySelectorAll('.fullscreen-exit-icon');
    enterIcons.forEach(el => el.classList.toggle('hidden', isFullscreen));
    exitIcons.forEach(el => el.classList.toggle('hidden', !isFullscreen));
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

    // Kích hoạt hiệu ứng xoay mượt mà trở lại khung phát
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

    if (this._exitTimeout) {
      clearTimeout(this._exitTimeout);
      this._exitTimeout = null;
    }

    // 1. Nếu đang ở chế độ pseudo-fullscreen (iOS / Mobile fallback) -> Thoát
    if (this.isPseudoFullscreen) {
      this.exitPseudoFullscreen();
      return;
    }

    // 2. Kiểm tra chế độ Native Fullscreen chuẩn -> Thoát nếu đang bật
    const isNativeFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (isNativeFullscreen) {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      } catch (err) {
        console.warn('[Player] Exit fullscreen error:', err);
      }
      if (screen.orientation && screen.orientation.unlock) {
        try { screen.orientation.unlock(); } catch (e) {}
      }
      this.updateFullscreenIcon(false);
      return;
    }

    // 3. Xử lý riêng cho iPhone / iOS hoặc trình duyệt không hỗ trợ Element.requestFullscreen:
    // Tự động xoay ngang 90 độ lấp đầy toàn bộ màn hình (bất kể iOS bật Khóa xoay màn hình)
    const container = document.getElementById('playerSection') || this.video;
    const canNativeRequest = !!(container && (container.requestFullscreen || container.webkitRequestFullscreen));
    const isIOS = this.isIOSDevice();

    if (isIOS || !canNativeRequest) {
      this.isPseudoFullscreen = true;
      this.updatePseudoFullscreenLayout();
      this.updateFullscreenIcon(true);
      return;
    }

    // 4. Trình duyệt chuẩn (Desktop, Android) -> Dùng Fullscreen API gốc và lock landscape
    try {
      if (container.requestFullscreen) {
        await container.requestFullscreen();
      } else if (container.webkitRequestFullscreen) {
        await container.webkitRequestFullscreen();
      }
      this.updateFullscreenIcon(true);

      // Khóa xoay ngang màn hình trên Android khi vào fullscreen
      if (screen.orientation && screen.orientation.lock) {
        const isLandscape = (this.video.videoWidth && this.video.videoHeight)
          ? this.video.videoWidth >= this.video.videoHeight
          : true;
        screen.orientation.lock(isLandscape ? 'landscape' : 'portrait').catch(() => {});
      }
    } catch (err) {
      console.warn('[Player] Standard fullscreen failed, falling back to pseudo-fullscreen:', err);
      this.isPseudoFullscreen = true;
      this.updatePseudoFullscreenLayout();
      this.updateFullscreenIcon(true);
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

