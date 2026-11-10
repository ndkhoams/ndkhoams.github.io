/**
 * TV Play Strand Edition — Channels & M3U Engine
 */

class ChannelManager {
  constructor(player) {
    this.player = player;
    this.channels = [];
    this.filteredChannels = [];
    this.currentCategory = 'all';
    this.currentIndex = -1;
    this.searchQuery = '';
    
    // Default online M3U from ndkhoams repository
    this.defaultM3uUrl = 'https://fastly.jsdelivr.net/gh/ndkhoams/iptv@main/ktv.m3u';
    this.armbianHubUrl = localStorage.getItem('tvplay_hub_url') || 'http://10.0.0.222:8080';
    this.useArmbian = localStorage.getItem('tvplay_use_armbian') === 'true';
  }

  async loadChannels() {
    this.renderSkeleton();

    try {
      let m3uText = '';
      
      // If user configured to fetch from Armbian LAN hub directly
      if (this.useArmbian) {
        try {
          const res = await fetch(`${this.armbianHubUrl}/api/channels`, { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            const jsonChannels = await res.json();
            if (Array.isArray(jsonChannels) && jsonChannels.length > 0) {
              this.channels = jsonChannels.map((ch, idx) => ({
                id: idx,
                name: ch.name || `Kênh ${idx + 1}`,
                url: ch.url,
                logo: ch.logo || '',
                group: ch.group || 'Khác',
                epgId: ch.epg_id || ''
              }));
              this.onChannelsReady();
              return;
            }
          }
        } catch (hubErr) {
          console.warn('[Channels] Armbian Hub offline or blocked by mixed-content, falling back to CDN M3U:', hubErr);
        }
      }

      // Fetch from fastly jsdelivr CDN
      const m3uUrl = localStorage.getItem('tvplay_custom_m3u') || this.defaultM3uUrl;
      const res = await fetch(m3uUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      m3uText = await res.text();
      this.channels = this.parseM3U(m3uText);
      this.onChannelsReady();

    } catch (err) {
      console.error('[Channels] Error loading M3U:', err);
      this.renderError('Không thể tải danh sách kênh. Vui lòng kiểm tra kết nối mạng.');
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
    if (!container) return;
    container.innerHTML = `
      <div class="p-8 text-center text-sm text-[var(--red)]">
        ${msg}
      </div>
    `;
  }
}

window.ChannelManager = ChannelManager;
