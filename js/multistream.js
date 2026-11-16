/**
 * TV Play — Multi-Stream / Multi-View Engine
 * Inspired by StreamFree Multi View (https://streamfree.top/multi-stream)
 * Supports:
 * - 1x1 (Single), 1x2 (Dual Split), 1+2 (Triple Master+Sidebars), 2x2 (Quad 4 Screens)
 * - Independent Hls.js stream playback per slot
 * - Single-stream audio arbitration (smart unmute active slot, mute other slots)
 * - Stream selector modal with live sports matches & TV channels
 * - Fullscreen per slot & fullscreen grid
 */

class MultiStreamManager {
  constructor() {
    this.isActive = false;
    this.currentLayout = '1x2';
    this.slots = {
      1: { stream: null, hls: null, isMuted: false },
      2: { stream: null, hls: null, isMuted: true },
      3: { stream: null, hls: null, isMuted: true },
      4: { stream: null, hls: null, isMuted: true }
    };
    this.activeAudioSlot = 1;
    this.selectedTargetSlot = null;
    this.selectorTab = 'sports'; // 'sports' | 'channels'
    this.init();
  }

  init() {
    this.renderFrames();
  }

  // Toggle between Normal Single Player & Multi-View
  toggleMultiView() {
    if (this.isActive) {
      this.exitMultiView();
    } else {
      this.enterMultiView();
    }
  }

  enterMultiView() {
    this.isActive = true;
    const playerSection = document.getElementById('playerSection');
    const multiViewSection = document.getElementById('multiViewSection');
    const playerDetailsCard = document.getElementById('playerDetailsCard');
    const btnHeader = document.getElementById('btnHeaderMultiView');

    if (playerSection) playerSection.classList.add('hidden');
    if (multiViewSection) multiViewSection.classList.remove('hidden');
    if (playerDetailsCard) playerDetailsCard.classList.add('hidden');
    if (btnHeader) btnHeader.classList.add('bg-white/20', 'border-amber-400/50');

    // Tạm dừng video chính để tránh ngốn băng thông & tiếng lồng tiếng
    if (window.player && window.player.video) {
      const currentCh = window.player.currentChannel;
      const currentSrc = window.player.video.src || (window.player.hls ? window.player.hls.url : null);
      window.player.video.pause();

      // Nạp luồng hiện tại của player vào Slot 1
      if (currentSrc && !this.slots[1].stream) {
        this.loadStreamIntoSlot(1, {
          name: (currentCh && (currentCh.title || currentCh.name)) || 'Luồng Đang Phát',
          url: currentSrc,
          logo: (currentCh && currentCh.logoUrl) || ''
        });
      }
    }

    this.changeLayout(this.currentLayout);
  }

  exitMultiView() {
    this.isActive = false;
    const playerSection = document.getElementById('playerSection');
    const multiViewSection = document.getElementById('multiViewSection');
    const playerDetailsCard = document.getElementById('playerDetailsCard');
    const btnHeader = document.getElementById('btnHeaderMultiView');

    if (playerSection) playerSection.classList.remove('hidden');
    if (multiViewSection) multiViewSection.classList.add('hidden');
    if (playerDetailsCard) playerDetailsCard.classList.remove('hidden');
    if (btnHeader) btnHeader.classList.remove('bg-white/20', 'border-amber-400/50');

    // Dừng toàn bộ các luồng trong Multi-View để giải phóng tài nguyên CPU/RAM
    for (let slotId = 1; slotId <= 4; slotId++) {
      this.destroySlotPlayer(slotId);
    }

    // Tiếp tục phát lại trên player chính nếu có luồng
    if (window.player && window.player.video && window.player.video.src) {
      window.player.safePlay();
    }
  }

  changeLayout(layout) {
    this.currentLayout = layout;
    const grid = document.getElementById('multiViewGrid');
    if (!grid) return;

    // Cập nhật class hiển thị layout
    grid.className = `ms-grid layout-${layout} layout-${layout.replace('+', 'plus')} bg-black min-h-[360px] sm:min-h-[520px] rounded-2xl overflow-hidden relative border border-white/5`;

    // Cập nhật active cho các nút layout
    document.querySelectorAll('.ms-layout-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layout === layout);
    });

    // Xác định số frame cần hiển thị theo layout
    const activeFrames = {
      '1x1': [1],
      '1x2': [1, 2],
      '1+2': [1, 2, 3],
      '2x2': [1, 2, 3, 4]
    }[layout] || [1, 2];

    for (let i = 1; i <= 4; i++) {
      const frameEl = document.querySelector(`.ms-frame[data-frame="${i}"]`);
      if (frameEl) {
        if (activeFrames.includes(i)) {
          frameEl.classList.remove('hidden');
          // Khởi tạo nội dung nếu chưa có
          if (!frameEl.innerHTML.trim()) {
            this.renderSlotUI(i);
          }
        } else {
          frameEl.classList.add('hidden');
          // Tạm dừng player của slot bị ẩn
          const video = frameEl.querySelector('video');
          if (video) video.pause();
        }
      }
    }
  }

  renderFrames() {
    for (let i = 1; i <= 4; i++) {
      this.renderSlotUI(i);
    }
  }

  renderSlotUI(slotId) {
    const frameEl = document.querySelector(`.ms-frame[data-frame="${slotId}"]`);
    if (!frameEl) return;

    const slot = this.slots[slotId];
    if (!slot.stream) {
      // Khung trống: Hiển thị nút Thêm luồng
      frameEl.innerHTML = `
        <div class="ms-empty-slot h-full w-full flex flex-col items-center justify-center p-6 text-center cursor-pointer group hover:bg-white/5 transition"
             onclick="window.multiStreamManager.openSelector(${slotId})">
          <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/10 group-hover:bg-[#ff6500]/20 border border-white/20 group-hover:border-orange-500/40 flex items-center justify-center text-white/80 group-hover:text-white transition-all transform group-hover:scale-105 shadow-xl mb-3">
            <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
            </svg>
          </div>
          <span class="text-sm font-bold text-white group-hover:text-amber-300 transition">Thêm Luồng #${slotId}</span>
          <span class="text-xs text-[var(--label-2)] mt-1">Bấm để chọn trận đấu hoặc kênh TV</span>
        </div>
      `;
    } else {
      // Khung đã nạp luồng phát
      const isMuted = (this.activeAudioSlot !== slotId);
      frameEl.innerHTML = `
        <div class="ms-video-container relative w-full h-full bg-black group select-none">
          <video id="msVideo_${slotId}" class="w-full h-full object-contain" playsinline webkit-playsinline></video>
          
          <!-- Buffering Spinner -->
          <div id="msBuffering_${slotId}" class="absolute inset-0 flex items-center justify-center z-10 pointer-events-none hidden">
            <div class="w-10 h-10 rounded-full border-3 border-white/20 border-t-[var(--accent)] animate-spin"></div>
          </div>

          <!-- Top Action Bar (Auto-reveals on hover / touch) -->
          <div class="ms-top-bar absolute top-0 left-0 right-0 p-2 sm:p-3 bg-gradient-to-b from-black/85 via-black/40 to-transparent flex items-center justify-between z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div class="flex items-center gap-2 min-w-0 pr-2">
              <span class="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold uppercase shrink-0">#${slotId}</span>
              <span class="text-xs font-semibold text-white truncate drop-shadow">${this.escapeHtml(slot.stream.name)}</span>
            </div>
            
            <div class="flex items-center gap-1.5 shrink-0">
              <!-- Audio Switch Button -->
              <button onclick="window.multiStreamManager.setAudioSlot(${slotId})" 
                      title="${isMuted ? 'Bật tiếng cho màn hình này' : 'Đang phát tiếng'}"
                      class="ms-audio-btn p-1.5 rounded-lg ${isMuted ? 'bg-black/60 text-white/70' : 'bg-green-500 text-white shadow-lg shadow-green-500/40'} hover:scale-105 transition">
                ${isMuted ? `
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M17 14l4-4m0 4l-4-4" />
                  </svg>` : `
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>`
                }
              </button>
              
              <!-- Change Stream -->
              <button onclick="window.multiStreamManager.openSelector(${slotId})" title="Đổi trận / kênh khác"
                      class="p-1.5 rounded-lg bg-black/60 text-white/80 hover:text-white transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              </button>

              <!-- Fullscreen Slot -->
              <button onclick="window.multiStreamManager.fullscreenSlot(${slotId})" title="Phóng to màn này"
                      class="p-1.5 rounded-lg bg-black/60 text-white/80 hover:text-white transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/>
                </svg>
              </button>

              <!-- Remove Stream -->
              <button onclick="window.multiStreamManager.removeStreamFromSlot(${slotId})" title="Đóng màn hình này"
                      class="p-1.5 rounded-lg bg-black/60 text-red-400 hover:bg-red-500/30 transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
          
          <!-- Active Audio Glow Border Indicator -->
          ${!isMuted ? '<div class="absolute inset-0 border-2 border-green-500/80 pointer-events-none rounded-lg z-10 shadow-[inset_0_0_15px_rgba(34,197,94,0.3)]"></div>' : ''}
        </div>
      `;

      // Khởi động phát video cho slot
      this.initSlotPlayer(slotId);
    }
  }

  loadStreamIntoSlot(slotId, streamInfo) {
    if (!streamInfo || !streamInfo.url) return;
    this.destroySlotPlayer(slotId);
    this.slots[slotId].stream = streamInfo;
    this.renderSlotUI(slotId);
  }

  removeStreamFromSlot(slotId) {
    this.destroySlotPlayer(slotId);
    this.slots[slotId].stream = null;
    this.renderSlotUI(slotId);
  }

  destroySlotPlayer(slotId) {
    const slot = this.slots[slotId];
    if (slot && slot.hls) {
      slot.hls.destroy();
      slot.hls = null;
    }
    const video = document.getElementById(`msVideo_${slotId}`);
    if (video) {
      video.pause();
      video.src = '';
      video.load();
    }
  }

  initSlotPlayer(slotId) {
    const slot = this.slots[slotId];
    if (!slot || !slot.stream) return;

    const video = document.getElementById(`msVideo_${slotId}`);
    if (!video) return;

    let targetUrl = slot.stream.url;
    if (typeof targetUrl === 'string' && targetUrl.includes('|')) {
      targetUrl = targetUrl.split('|')[0].trim();
    }

    const isMuted = (this.activeAudioSlot !== slotId);
    video.muted = isMuted;

    const isHls = targetUrl.includes('.m3u8') || targetUrl.includes('play.m3u8');
    const spinner = document.getElementById(`msBuffering_${slotId}`);

    video.addEventListener('waiting', () => { if (spinner) spinner.classList.remove('hidden'); });
    video.addEventListener('playing', () => { if (spinner) spinner.classList.add('hidden'); });

    // Click vào màn hình nào thì chuyển âm thanh sang màn hình đó
    video.addEventListener('click', () => {
      this.setAudioSlot(slotId);
    });

    if (window.Hls && window.Hls.isSupported() && isHls) {
      const hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30
      });
      slot.hls = hls;
      hls.loadSource(targetUrl);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      });
      hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              video.src = targetUrl;
              video.play().catch(() => {});
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = targetUrl;
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    } else {
      video.src = targetUrl;
      video.play().catch(() => {});
    }
  }

  // Chuyển âm thanh duy nhất sang 1 màn hình đã chọn
  setAudioSlot(slotId) {
    this.activeAudioSlot = slotId;
    for (let i = 1; i <= 4; i++) {
      const video = document.getElementById(`msVideo_${i}`);
      if (video) {
        video.muted = (i !== slotId);
      }
    }
    // Cập nhật lại viền xanh và icon loa
    this.updateAudioUI();
  }

  muteAll() {
    this.activeAudioSlot = -1;
    for (let i = 1; i <= 4; i++) {
      const video = document.getElementById(`msVideo_${i}`);
      if (video) video.muted = true;
    }
    this.updateAudioUI();
  }

  updateAudioUI() {
    for (let i = 1; i <= 4; i++) {
      const frameEl = document.querySelector(`.ms-frame[data-frame="${i}"]`);
      if (frameEl && this.slots[i].stream) {
        const isMuted = (this.activeAudioSlot !== i);
        const btn = frameEl.querySelector('.ms-audio-btn');
        if (btn) {
          btn.className = `ms-audio-btn p-1.5 rounded-lg ${isMuted ? 'bg-black/60 text-white/70' : 'bg-green-500 text-white shadow-lg shadow-green-500/40'} hover:scale-105 transition`;
          btn.innerHTML = isMuted ? `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 14l4-4m0 4l-4-4" />
            </svg>` : `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>`;
        }
        // Viền xanh phát sáng cho màn hình đang có tiếng
        let border = frameEl.querySelector('.ms-video-container > div:last-child');
        if (!isMuted) {
          if (!frameEl.querySelector('.border-green-500\\/80')) {
            const glow = document.createElement('div');
            glow.className = 'absolute inset-0 border-2 border-green-500/80 pointer-events-none rounded-lg z-10 shadow-[inset_0_0_15px_rgba(34,197,94,0.3)]';
            frameEl.querySelector('.ms-video-container')?.appendChild(glow);
          }
        } else {
          frameEl.querySelector('.border-green-500\\/80')?.remove();
        }
      }
    }
  }

  fullscreenSlot(slotId) {
    const video = document.getElementById(`msVideo_${slotId}`);
    if (!video) return;
    if (video.requestFullscreen) video.requestFullscreen();
    else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
  }

  toggleFullscreen() {
    const grid = document.getElementById('multiViewSection');
    if (!grid) return;
    if (!document.fullscreenElement) {
      if (grid.requestFullscreen) grid.requestFullscreen();
      else if (grid.webkitRequestFullscreen) grid.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }

  // ================= MODAL CHỌN TRẬN ĐẤU / KÊNH TV =================
  openSelector(slotId) {
    this.selectedTargetSlot = slotId;
    const modal = document.getElementById('msSelectorModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.getElementById('msSlotBadge').textContent = `MÀN HÌNH #${slotId}`;
    this.switchSelectorTab(this.selectorTab);
    const searchInput = document.getElementById('msSearchInput');
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
  }

  closeSelector() {
    const modal = document.getElementById('msSelectorModal');
    if (modal) modal.classList.add('hidden');
    this.selectedTargetSlot = null;
  }

  switchSelectorTab(tab) {
    this.selectorTab = tab;
    document.getElementById('msTabSports')?.classList.toggle('active', tab === 'sports');
    document.getElementById('msTabChannels')?.classList.toggle('active', tab === 'channels');
    this.filterSelectorItems();
  }

  filterSelectorItems() {
    const searchInput = document.getElementById('msSearchInput');
    const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const container = document.getElementById('msItemsList');
    if (!container) return;

    if (this.selectorTab === 'sports') {
      this.renderSportsInSelector(container, query);
    } else {
      this.renderChannelsInSelector(container, query);
    }
  }

  renderSportsInSelector(container, query) {
    const events = (window.sportsManager && window.sportsManager.liveEvents) || [];
    if (events.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-xs text-[var(--label-2)]">Không có trận đấu trực tiếp nào.</div>';
      return;
    }

    const filtered = events.filter(ev => {
      if (!query) return true;
      const h = (ev.homeTeam || '').toLowerCase();
      const a = (ev.awayTeam || '').toLowerCase();
      const lg = (ev.league || '').toLowerCase();
      const lgn = (ev.leagueName || '').toLowerCase();
      return h.includes(query) || a.includes(query) || lg.includes(query) || lgn.includes(query);
    });

    this.filteredEvents = filtered;

    if (filtered.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-xs text-[var(--label-2)]">Không tìm thấy trận đấu phù hợp.</div>';
      return;
    }

    let html = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3">';
    filtered.forEach((ev, idx) => {
      const isOngoing = (ev.time === 'LIVE' || ev.isOngoing);
      const timeStr = ev.date ? `${ev.time} ${ev.date}` : ev.time;
      const sources = ev.sources || [];
      const sourcesCount = sources.length;
      
      html += `
        <div class="glass-card p-3 rounded-xl border border-white/10 hover:border-orange-500/40 hover:bg-white/10 transition flex flex-col justify-between gap-2"
             onclick="window.multiStreamManager.pickSportsEventByIdx(${idx})">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-bold px-2 py-0.5 rounded ${isOngoing ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/10 text-white/70'}">
              ${isOngoing ? '🔴 LIVE' : timeStr}
            </span>
            <span class="text-[11px] font-semibold text-amber-300 truncate">${this.escapeHtml(ev.leagueName || ev.league || 'Bóng đá')}</span>
          </div>

          <div class="flex items-center justify-between text-xs font-bold text-white py-1">
            <span class="truncate pr-2">${this.escapeHtml(ev.homeTeam)}</span>
            <span class="text-orange-400 px-1 text-[11px]">VS</span>
            <span class="truncate pl-2 text-right">${this.escapeHtml(ev.awayTeam)}</span>
          </div>

          <div class="flex items-center justify-between text-[11px] text-[var(--label-2)] pt-1 border-t border-white/5">
            <span>${sourcesCount} nguồn phát khả dụng</span>
            <span class="text-amber-400 font-semibold group-hover:underline">Chọn trận này ➜</span>
          </div>

          ${sourcesCount > 1 ? `
            <div class="flex flex-wrap gap-1 pt-1 border-t border-white/5">
              ${sources.map((s, sIdx) => `
                <button type="button" onclick="event.stopPropagation(); window.multiStreamManager.pickSportsSourceByIdx(${idx}, ${sIdx})"
                  class="px-2 py-0.5 rounded text-[10px] font-medium bg-white/10 hover:bg-orange-500/30 text-white/80 hover:text-white border border-white/10 hover:border-orange-500/40 transition">
                  ${this.escapeHtml(s.name || 'Nguồn ' + (sIdx + 1))}
                </button>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;
  }

  renderChannelsInSelector(container, query) {
    const channels = (window.channelManager && window.channelManager.allChannels) || [];
    if (channels.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-xs text-[var(--label-2)]">Đang tải danh sách kênh TV...</div>';
      return;
    }

    const filtered = channels.filter(ch => {
      if (!query) return true;
      const name = (ch.name || '').toLowerCase();
      const grp = (ch.group || '').toLowerCase();
      return name.includes(query) || grp.includes(query);
    });

    this.filteredChannels = filtered;

    if (filtered.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-xs text-[var(--label-2)]">Không tìm thấy kênh phù hợp.</div>';
      return;
    }

    let html = '<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 p-3">';
    filtered.slice(0, 100).forEach((ch, idx) => {
      html += `
        <div class="glass-card p-2.5 rounded-xl border border-white/10 hover:border-orange-500/40 hover:bg-white/10 transition cursor-pointer flex items-center gap-2.5"
             onclick="window.multiStreamManager.pickChannelByIdx(${idx})">
          ${ch.logo ? `<img src="${ch.logo}" class="w-8 h-8 rounded-lg object-contain bg-black/40 p-1 shrink-0" onerror="this.remove()">` : ''}
          <div class="min-w-0">
            <div class="text-xs font-bold text-white truncate">${this.escapeHtml(ch.name)}</div>
            <div class="text-[10px] text-[var(--label-2)] truncate">${this.escapeHtml(ch.group || 'Kênh TV')}</div>
          </div>
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;
  }

  pickSportsEventByIdx(idx) {
    if (!this.selectedTargetSlot || !this.filteredEvents) return;
    const eventObj = this.filteredEvents[idx];
    if (!eventObj) return;
    const sources = eventObj.sources || [];
    if (sources.length === 0) {
      alert('Trận đấu này chưa có luồng phát.');
      return;
    }
    const stream = sources[0];
    this.loadStreamIntoSlot(this.selectedTargetSlot, {
      name: `${eventObj.homeTeam} vs ${eventObj.awayTeam}`,
      url: stream.url,
      logo: eventObj.logo || stream.logo || ''
    });
    this.closeSelector();
  }

  pickSportsSourceByIdx(eventIdx, sourceIdx) {
    if (!this.selectedTargetSlot || !this.filteredEvents) return;
    const eventObj = this.filteredEvents[eventIdx];
    if (!eventObj) return;
    const sources = eventObj.sources || [];
    const stream = sources[sourceIdx];
    if (!stream || !stream.url) return;
    this.loadStreamIntoSlot(this.selectedTargetSlot, {
      name: `${eventObj.homeTeam} vs ${eventObj.awayTeam} (${stream.name || 'Nguồn ' + (sourceIdx + 1)})`,
      url: stream.url,
      logo: eventObj.logo || stream.logo || ''
    });
    this.closeSelector();
  }

  pickChannelByIdx(idx) {
    if (!this.selectedTargetSlot || !this.filteredChannels) return;
    const channelObj = this.filteredChannels[idx];
    if (!channelObj) return;
    this.loadStreamIntoSlot(this.selectedTargetSlot, {
      name: channelObj.name,
      url: channelObj.url,
      logo: channelObj.logo || ''
    });
    this.closeSelector();
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  escapeQuotes(str) {
    if (!str) return "''";
    return "'" + str.replace(/'/g, "\\'") + "'";
  }
}

window.MultiStreamManager = MultiStreamManager;
