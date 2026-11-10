/**
 * TV Play Strand Edition — Channels & Multiple Playlists Engine
 * Supports managing multiple M3U playlist sources with instant switching.
 */

class ChannelManager {
  constructor(player) {
    this.player = player;
    this.channels = [];
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

  async loadChannels() {
    this.renderSkeleton();
    const activePl = this.getActivePlaylist();

    try {
      const res = await fetch(activePl.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m3uText = await res.text();
      this.channels = this.parseM3U(m3uText);
      this.onChannelsReady();

    } catch (err) {
      console.error('[Channels] Error loading M3U from', activePl.url, err);
      this.renderError(`Không thể tải nguồn "${activePl.name}". Vui lòng kiểm tra lại đường dẫn mạng.`);
    }
  }

  parseM3U(text) {
    const lines = text.split('\n');
    const channels = [];
    let currentChannel = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        currentChannel = {
          id: channels.length,
          name: 'Kênh',
          logo: '',
          group: 'Khác',
          epgId: ''
        };

        // Extract tvg-logo
        const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
        if (logoMatch) currentChannel.logo = logoMatch[1];

        // Extract group-title
        const groupMatch = line.match(/group-title="([^"]*)"/i);
        if (groupMatch) currentChannel.group = groupMatch[1];

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
          currentChannel.url = line;
          channels.push(currentChannel);
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
              class="px-3.5 py-1.5 rounded-full glass-pill text-xs font-semibold shrink-0 transition bg-white/20 text-white">
        Tất cả (${this.channels.length})
      </button>
    `;

    categoryList.forEach(grp => {
      html += `
        <button onclick="window.channelManager.setCategory('${encodeURIComponent(grp)}')" id="cat-btn-${encodeURIComponent(grp)}" 
                class="px-3.5 py-1.5 rounded-full glass-pill text-xs font-medium shrink-0 text-[var(--label-2)] hover:text-white transition">
          ${grp}
        </button>
      `;
    });

    filterContainer.innerHTML = html;
  }

  setCategory(category) {
    this.currentCategory = decodeURIComponent(category);
    
    // Update button states
    const buttons = document.querySelectorAll('#categoryFilters button');
    buttons.forEach(b => {
      b.className = 'px-3.5 py-1.5 rounded-full glass-pill text-xs font-medium shrink-0 text-[var(--label-2)] hover:text-white transition';
    });

    const activeBtn = document.getElementById(`cat-btn-${encodeURIComponent(category)}`);
    if (activeBtn) {
      activeBtn.className = 'px-3.5 py-1.5 rounded-full glass-pill text-xs font-semibold shrink-0 bg-white/20 text-white transition';
    }

    this.filterChannels();
  }

  setSearchQuery(query) {
    this.searchQuery = (query || '').toLowerCase().trim();
    this.filterChannels();
  }

  filterChannels() {
    this.filteredChannels = this.channels.filter(ch => {
      const matchesCategory = this.currentCategory === 'all' || ch.group === this.currentCategory;
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
          Không tìm thấy kênh phù hợp với tìm kiếm.
        </div>
      `;
      return;
    }

    let html = '';
    this.filteredChannels.forEach(ch => {
      const isActive = this.currentIndex === ch.id;
      const logoHtml = ch.logo
        ? `<img src="${ch.logo}" alt="${ch.name}" class="w-full h-full object-contain" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
           <span style="display:none;" class="text-xs font-black text-[var(--orange)]">${ch.name.substring(0, 4)}</span>`
        : `<span class="text-xs font-black text-[var(--orange)]">${ch.name.substring(0, 4)}</span>`;

      html += `
        <div onclick="window.channelManager.selectChannel(${ch.id}, true)" 
             id="chan-row-${ch.id}" 
             class="channel-row p-3.5 sm:p-4 flex items-center justify-between gap-4 cursor-pointer ${isActive ? 'active' : ''}">
          <div class="flex items-center gap-3.5 min-w-0">
            <div class="w-11 h-11 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-white/10 flex items-center justify-center p-1.5 shrink-0 shadow-inner overflow-hidden">
              ${logoHtml}
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-white truncate">${ch.name}</span>
                ${isActive ? '<span class="w-2 h-2 rounded-full bg-[var(--green)]"></span>' : ''}
                <span class="text-[10px] font-mono text-[var(--label-3)]">${ch.group}</span>
              </div>
              <p class="text-xs text-[var(--label-2)] truncate mt-0.5">
                ● Trực tiếp HD • Chạm để phát
              </p>
            </div>
          </div>
          <div class="hidden sm:block text-right shrink-0">
            <span class="text-[11px] text-[var(--label-3)]">#${ch.id + 1}</span>
            <p class="text-xs text-[var(--label-2)] font-mono">1080p</p>
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
        title: `${ch.name} (Trực tiếp)`,
        subtitle: `Phát từ nguồn: ${ch.group} • Nền tảng Apple Screens & Web`,
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
