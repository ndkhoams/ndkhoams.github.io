/**
 * TV Play Strand Edition — Channels & Multiple Playlists Engine
 * Supports managing multiple M3U playlist sources with instant switching.
 */

class ChannelManager {
  constructor(player) {
    this.player = player;
    this.channels = [];
    this.tvChannels = [];
    this.sportsChannels = [];
    this.filteredChannels = [];
    this.currentCategory = 'all';
    this.currentIndex = -1;
    this.searchQuery = '';
    
    // Default system playlists
    this.defaultPlaylists = [
      {
        id: 'ktv_main',
        name: 'KTV Chuẩn (VTV, Thể Thao, Tin Tức)',
        url: 'https://fastly.jsdelivr.net/gh/ndkhoams/iptv@main/ktv.m3u',
        isDefault: true
      }
    ];

    this.initPlaylists();
  }

  initPlaylists() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('tvplay_playlists'));
    } catch (e) {}

    if (!Array.isArray(saved) || saved.length === 0) {
      this.playlists = [...this.defaultPlaylists];
      this.savePlaylists();
    } else {
      this.playlists = saved;
    }

    this.activePlaylistId = localStorage.getItem('tvplay_active_playlist_id') || this.playlists[0].id;
  }

  savePlaylists() {
    localStorage.setItem('tvplay_playlists', JSON.stringify(this.playlists));
    localStorage.setItem('tvplay_active_playlist_id', this.activePlaylistId);
  }

  getActivePlaylist() {
    return this.playlists.find(p => p.id === this.activePlaylistId) || this.playlists[0];
  }

  addPlaylist(name, url) {
    const cleanName = (name || '').trim();
    const cleanUrl = (url || '').trim();

    if (!cleanName || !cleanUrl) {
      alert('Vui lòng nhập đầy đủ tên nguồn và đường dẫn M3U.');
      return false;
    }

    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      alert('Đường dẫn M3U phải bắt đầu bằng http:// hoặc https://');
      return false;
    }

    const newPl = {
      id: 'pl_' + Date.now(),
      name: cleanName,
      url: cleanUrl,
      isDefault: false
    };

    this.playlists.push(newPl);
    this.activePlaylistId = newPl.id;
    this.savePlaylists();
    this.renderPlaylistsUI();
    this.loadChannels();
    return true;
  }

  deletePlaylist(id) {
    const pl = this.playlists.find(p => p.id === id);
    if (!pl) return;

    if (pl.isDefault) {
      alert('Không thể xóa nguồn mặc định của hệ thống.');
      return;
    }

    if (!confirm(`Bạn có chắc chắn muốn xóa nguồn "${pl.name}"?`)) return;

    this.playlists = this.playlists.filter(p => p.id !== id);
    if (this.activePlaylistId === id) {
      this.activePlaylistId = this.playlists[0].id;
    }
    this.savePlaylists();
    this.renderPlaylistsUI();
    this.loadChannels();
  }

  selectPlaylist(id) {
    if (this.activePlaylistId === id) return;
    this.activePlaylistId = id;
    this.savePlaylists();
    this.renderPlaylistsUI();
    this.loadChannels();
  }

  async loadSportsM3U() {
    const cacheBuster = `?t=${Date.now()}`;
    const hubUrl = localStorage.getItem('tvplay_hub_url') || 'http://10.0.0.222:8080';
    const useArmbian = localStorage.getItem('tvplay_use_armbian') === 'true';

    let text = null;

    // 1. Armbian LAN Hub (nếu được bật và trong mạng nội bộ)
    if (useArmbian) {
      try {
        const res = await fetch(`${hubUrl}/data/thethao.m3u${cacheBuster}`, {
          signal: AbortSignal.timeout(2500),
          cache: 'no-store'
        });
        if (res.ok) text = await res.text();
      } catch (e) {
        console.warn('[Channels] Armbian thethao.m3u offline, fallback to GitHub');
      }
    }

    // 2. Raw GitHub (luôn cập nhật mới nhất ngay khi updater đẩy lên)
    if (!text) {
      try {
        const res = await fetch(`https://raw.githubusercontent.com/ndkhoams/iptv/main/thethao.m3u${cacheBuster}`, {
          signal: AbortSignal.timeout(6000),
          cache: 'no-store'
        });
        if (res.ok) text = await res.text();
      } catch (e) {
        console.warn('[Channels] Raw GitHub thethao.m3u error, fallback to CDN');
      }
    }

    // 3. Dự phòng qua jsDelivr CDN
    if (!text) {
      try {
        const res = await fetch(`https://fastly.jsdelivr.net/gh/ndkhoams/iptv@main/thethao.m3u${cacheBuster}`, {
          cache: 'no-store'
        });
        if (res.ok) text = await res.text();
      } catch (e) {}
    }

    return text;
  }

  async loadChannels() {
    this.renderSkeleton();
    const activePl = this.getActivePlaylist();

    try {
      // 1. Tải danh sách kênh TV từ playlist hiện tại
      const res = await fetch(activePl.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m3uText = await res.text();
      this.tvChannels = this.parseM3U(m3uText, false);

      // 2. Tải toàn bộ danh sách các trận đấu từ thethao.m3u (nếu nguồn đang dùng chưa phải là thethao.m3u)
      this.sportsChannels = [];
      if (!activePl.url.includes('thethao.m3u')) {
        try {
          const sportsText = await this.loadSportsM3U();
          if (sportsText) {
            this.sportsChannels = this.parseM3U(sportsText, true);
          }
        } catch (sErr) {
          console.warn('[Channels] Không tải được thethao.m3u:', sErr);
        }
      }

      // 3. Hợp nhất cả kênh TV và các trận đấu thể thao
      this.channels = [...this.tvChannels, ...this.sportsChannels];
      this.channels.forEach((ch, idx) => { ch.id = idx; });

      this.onChannelsReady();

    } catch (err) {
      console.error('[Channels] Error loading M3U from', activePl.url, err);
      this.renderError(`Không thể tải nguồn "${activePl.name}". Vui lòng kiểm tra lại đường dẫn mạng.`);
    }
  }

  async reloadSportsChannels() {
    const activePl = this.getActivePlaylist();
    if (activePl.url.includes('thethao.m3u')) return;

    try {
      const sportsText = await this.loadSportsM3U();
      if (!sportsText) return;
      this.sportsChannels = this.parseM3U(sportsText, true);

      // Lưu lại channel đang chọn hiện tại để duy trì trạng thái
      const currentSelectedUrl = this.currentIndex >= 0 && this.channels[this.currentIndex] 
        ? this.channels[this.currentIndex].url 
        : null;

      this.channels = [...this.tvChannels, ...this.sportsChannels];
      this.channels.forEach((ch, idx) => { ch.id = idx; });

      if (currentSelectedUrl) {
        const newIdx = this.channels.findIndex(c => c.url === currentSelectedUrl);
        if (newIdx !== -1) this.currentIndex = newIdx;
      }

      this.extractCategories();
      this.filterChannels();
    } catch (e) {
      console.warn('[Channels] Error reloading sports channels:', e);
    }
  }

  parseM3U(text, isSports = false) {
    if (!text) return [];
    const lines = text.split('\n');
    const channels = [];
    let currentChannel = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        currentChannel = {
          id: 0,
          name: 'Kênh',
          logo: '',
          group: isSports ? '⚽ Thể Thao' : 'Khác',
          epgId: '',
          isSports: isSports
        };

        // Extract tvg-logo
        const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
        if (logoMatch) currentChannel.logo = logoMatch[1];

        // Extract group-title
        const groupMatch = line.match(/group-title="([^"]*)"/i);
        if (groupMatch && groupMatch[1]) {
          currentChannel.group = groupMatch[1].trim();
        }

        // Extract tvg-id
        const epgMatch = line.match(/tvg-id="([^"]*)"/i);
        if (epgMatch) currentChannel.epgId = epgMatch[1];

        // Extract channel name (after last comma)
        const commaIdx = line.lastIndexOf(',');
        if (commaIdx !== -1) {
          currentChannel.name = line.substring(commaIdx + 1).trim();
        }
      } else if (line.startsWith('http://') || line.startsWith('https://')) {
        if (currentChannel) {
          // Bỏ qua luồng refresh ảo của playlist
          if (!line.includes('127.0.0.1/refresh')) {
            currentChannel.url = line;
            channels.push(currentChannel);
          }
          currentChannel = null;
        }
      }
    }

    return channels;
  }

  onChannelsReady() {
    this.extractCategories();
    this.filterChannels();
    
    // Auto-select first channel or VTV1
    if (this.channels.length > 0 && this.currentIndex === -1) {
      const vtv1Idx = this.channels.findIndex(c => c.name.toLowerCase().includes('vtv1'));
      this.selectChannel(vtv1Idx !== -1 ? vtv1Idx : 0, false);
    }

    // Update active playlist label in settings modal
    this.renderPlaylistsUI();
  }

  extractCategories() {
    const groupSet = new Set();
    this.channels.forEach(ch => {
      if (ch.group) groupSet.add(ch.group);
    });

    const categoryList = Array.from(groupSet);
    const filterContainer = document.getElementById('categoryFilters');
    if (!filterContainer) return;

    let html = `
      <button onclick="window.channelManager.setCategory('all')" id="cat-btn-all" 
              class="px-3.5 py-1.5 rounded-full glass-pill text-xs font-semibold shrink-0 transition ${this.currentCategory === 'all' ? 'bg-white/20 text-white' : 'text-[var(--label-2)] hover:text-white'}">
        Tất cả (${this.channels.length})
      </button>
    `;

    // Filter pill riêng cho toàn bộ trận đấu trong thethao.m3u
    if (this.sportsChannels && this.sportsChannels.length > 0) {
      const isSportsSelected = this.currentCategory === 'sports_all';
      html += `
        <button onclick="window.channelManager.setCategory('sports_all')" id="cat-btn-sports_all" 
                class="px-3.5 py-1.5 rounded-full glass-pill text-xs font-semibold shrink-0 transition flex items-center gap-1.5 ${isSportsSelected ? 'bg-orange-500/25 text-orange-400 border border-orange-500/40' : 'text-orange-400/80 hover:text-orange-300'}">
          <span>⚽ Thể Thao (${this.sportsChannels.length})</span>
        </button>
      `;
    }

    // Filter pill riêng cho các kênh TV chuẩn
    if (this.tvChannels && this.tvChannels.length > 0) {
      const isTvSelected = this.currentCategory === 'tv_all';
      html += `
        <button onclick="window.channelManager.setCategory('tv_all')" id="cat-btn-tv_all" 
                class="px-3.5 py-1.5 rounded-full glass-pill text-xs font-medium shrink-0 transition ${isTvSelected ? 'bg-white/20 text-white font-semibold' : 'text-[var(--label-2)] hover:text-white'}">
          📺 Kênh TV (${this.tvChannels.length})
        </button>
      `;
    }

    categoryList.forEach(grp => {
      const isSelected = this.currentCategory === grp;
      html += `
        <button onclick="window.channelManager.setCategory('${encodeURIComponent(grp)}')" id="cat-btn-${encodeURIComponent(grp)}" 
                class="px-3.5 py-1.5 rounded-full glass-pill text-xs font-medium shrink-0 transition ${isSelected ? 'bg-white/20 text-white font-semibold' : 'text-[var(--label-2)] hover:text-white'}">
          ${grp}
        </button>
      `;
    });

    filterContainer.innerHTML = html;
  }

  setCategory(category) {
    if (category === 'all' || category === 'sports_all' || category === 'tv_all') {
      this.currentCategory = category;
    } else {
      this.currentCategory = decodeURIComponent(category);
    }
    
    // Update button states
    const buttons = document.querySelectorAll('#categoryFilters button');
    buttons.forEach(b => {
      if (b.id === 'cat-btn-sports_all') {
        b.className = 'px-3.5 py-1.5 rounded-full glass-pill text-xs font-semibold shrink-0 transition flex items-center gap-1.5 text-orange-400/80 hover:text-orange-300';
      } else {
        b.className = 'px-3.5 py-1.5 rounded-full glass-pill text-xs font-medium shrink-0 text-[var(--label-2)] hover:text-white transition';
      }
    });

    const activeBtn = document.getElementById(`cat-btn-${encodeURIComponent(category)}`);
    if (activeBtn) {
      if (category === 'sports_all') {
        activeBtn.className = 'px-3.5 py-1.5 rounded-full glass-pill text-xs font-semibold shrink-0 transition flex items-center gap-1.5 bg-orange-500/25 text-orange-400 border border-orange-500/40';
      } else {
        activeBtn.className = 'px-3.5 py-1.5 rounded-full glass-pill text-xs font-semibold shrink-0 bg-white/20 text-white transition';
      }
    }

    this.filterChannels();
  }

  setSearchQuery(query) {
    this.searchQuery = (query || '').toLowerCase().trim();
    this.filterChannels();
  }

  filterChannels() {
    this.filteredChannels = this.channels.filter(ch => {
      let matchesCategory = false;
      if (this.currentCategory === 'all') {
        matchesCategory = true;
      } else if (this.currentCategory === 'sports_all') {
        matchesCategory = !!ch.isSports || (ch.group && ch.group.toLowerCase().includes('thể thao'));
      } else if (this.currentCategory === 'tv_all') {
        matchesCategory = !ch.isSports;
      } else {
        matchesCategory = ch.group === this.currentCategory;
      }

      const matchesSearch = !this.searchQuery || 
        ch.name.toLowerCase().includes(this.searchQuery) ||
        (ch.group && ch.group.toLowerCase().includes(this.searchQuery));

      return matchesCategory && matchesSearch;
    });

    this.renderChannelList();
  }

  renderChannelList() {
    const container = document.getElementById('channelContainer');
    if (!container) return;

    if (this.filteredChannels.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-sm text-[var(--label-2)]">
          Không tìm thấy kênh hoặc trận đấu phù hợp với tìm kiếm.
        </div>
      `;
      return;
    }

    let html = '';
    this.filteredChannels.forEach(ch => {
      const isActive = this.currentIndex === ch.id;
      const logoHtml = ch.logo
        ? `<img src="${ch.logo}" alt="${ch.name}" class="w-full h-full object-contain" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
           <span style="display:none;" class="text-xs font-black text-[var(--orange)]">${ch.isSports ? '⚽' : ch.name.substring(0, 4)}</span>`
        : `<span class="text-xs font-black text-[var(--orange)]">${ch.isSports ? '⚽' : ch.name.substring(0, 4)}</span>`;

      html += `
        <div onclick="window.channelManager.selectChannel(${ch.id}, true)" 
             id="chan-row-${ch.id}" 
             class="channel-row p-3.5 sm:p-4 flex items-center justify-between gap-4 cursor-pointer ${isActive ? 'active' : ''}">
          <div class="flex items-center gap-3.5 min-w-0 flex-1">
            <div class="w-11 h-11 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-white/10 flex items-center justify-center p-1.5 shrink-0 shadow-inner overflow-hidden">
              ${logoHtml}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                <span class="text-sm font-semibold text-white truncate ${ch.isSports ? 'text-amber-100' : ''}">${ch.name}</span>
                ${isActive ? '<span class="w-2 h-2 rounded-full bg-[var(--green)] shrink-0"></span>' : ''}
                <span class="text-[10px] font-mono text-[var(--label-3)] shrink-0 px-1.5 py-0.5 rounded bg-white/5 border border-white/5">${ch.group}</span>
              </div>
              <p class="text-xs text-[var(--label-2)] truncate mt-0.5">
                ${ch.isSports ? '🔥 Trực tiếp trận đấu • Chạm để phát' : '● Trực tiếp HD • Chạm để phát'}
              </p>
            </div>
          </div>
          <div class="hidden sm:block text-right shrink-0">
            <span class="text-[11px] text-[var(--label-3)]">#${ch.id + 1}</span>
            <p class="text-xs font-mono ${ch.isSports ? 'text-orange-400 font-bold' : 'text-[var(--label-2)]'}">${ch.isSports ? 'LIVE ⚽' : '1080p'}</p>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  selectChannel(channelId, autoPlay = true) {
    const ch = this.channels.find(c => c.id === channelId);
    if (!ch) return;

    this.currentIndex = channelId;

    // Update active row visual
    document.querySelectorAll('.channel-row').forEach(row => row.classList.remove('active'));
    const rowEl = document.getElementById(`chan-row-${channelId}`);
    if (rowEl) rowEl.classList.add('active');

    // Update timeline cells visual
    document.querySelectorAll('.timeline-channel-cell').forEach(cell => cell.classList.remove('active'));

    // Inform player
    if (this.player && autoPlay) {
      this.player.playStream(ch.url, {
        name: ch.name,
        title: ch.isSports ? ch.name : `${ch.name} (Trực tiếp)`,
        subtitle: ch.isSports ? `Trực tiếp thể thao • ${ch.group}` : `Phát từ nguồn: ${ch.group} • Nền tảng Apple Screens & Web`,
        group: ch.group
      });
    }
  }

  playNextChannel() {
    if (this.channels.length === 0) return;
    const nextIdx = (this.currentIndex + 1) % this.channels.length;
    this.selectChannel(nextIdx, true);
  }

  playPrevChannel() {
    if (this.channels.length === 0) return;
    const prevIdx = (this.currentIndex - 1 + this.channels.length) % this.channels.length;
    this.selectChannel(prevIdx, true);
  }

  renderSkeleton() {
    const container = document.getElementById('channelContainer');
    if (!container) return;

    let html = '';
    for (let i = 0; i < 5; i++) {
      html += `
        <div class="p-4 flex items-center justify-between gap-4">
          <div class="flex items-center gap-3.5">
            <div class="w-11 h-11 rounded-xl skeleton"></div>
            <div class="space-y-2">
              <div class="w-32 h-4 rounded skeleton"></div>
              <div class="w-20 h-3 rounded skeleton"></div>
            </div>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;
  }

  renderError(msg) {
    const container = document.getElementById('channelContainer');
    if (container) {
      container.innerHTML = `<div class="p-8 text-center text-sm text-[var(--red)]">${msg}</div>`;
    }
  }

  renderPlaylistsUI() {
    const listContainer = document.getElementById('savedPlaylistsList');
    if (!listContainer) return;

    let html = '';
    this.playlists.forEach(pl => {
      const isSelected = pl.id === this.activePlaylistId;

      html += `
        <div class="p-3.5 rounded-2xl glass-card flex items-center justify-between gap-3 border ${
          isSelected ? 'border-[var(--accent)] bg-orange-500/10' : 'border-white/10 hover:border-white/20'
        } transition-all">
          <div onclick="window.channelManager.selectPlaylist('${pl.id}')" class="min-w-0 flex-1 cursor-pointer">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full ${isSelected ? 'bg-[var(--accent)] ring-4 ring-orange-500/20' : 'bg-white/30'} shrink-0"></span>
              <span class="text-xs font-bold text-white truncate">${pl.name}</span>
              ${isSelected ? '<span class="px-1.5 py-0.2 rounded bg-orange-500/20 text-orange-400 text-[9px] font-bold">ĐANG DÙNG</span>' : ''}
              ${pl.isDefault ? '<span class="px-1.5 py-0.2 rounded bg-white/10 text-white/60 text-[9px]">Hệ thống</span>' : ''}
            </div>
            <p class="text-[11px] text-[var(--label-3)] font-mono truncate mt-1 pl-4.5">${pl.url}</p>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            ${!isSelected ? `
              <button onclick="window.channelManager.selectPlaylist('${pl.id}')" class="px-3 py-1 rounded-xl glass-pill text-[11px] font-semibold text-white/90 hover:text-white hover:bg-white/20 transition">
                Chọn
              </button>
            ` : ''}
            ${!pl.isDefault ? `
              <button onclick="window.channelManager.deletePlaylist('${pl.id}')" title="Xóa nguồn này" class="w-7 h-7 rounded-full hover:bg-red-500/20 text-white/60 hover:text-red-400 flex items-center justify-center transition">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    });

    listContainer.innerHTML = html;
  }
}

window.ChannelManager = ChannelManager;
