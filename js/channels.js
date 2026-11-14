/**
 * TV Play — Channels & Multiple Playlists Engine
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
        url: 'https://raw.githubusercontent.com/ndkhoams/iptv/main/ktv.m3u',
        isDefault: true
      }
    ];

    this.initPlaylists();

    // Close category dropdown on outside click
    document.addEventListener('click', (e) => {
      const container = document.getElementById('categoryDropdownContainer');
      if (container && !container.contains(e.target)) {
        this.closeCategoryDropdown();
      }
    });
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
      // Tự động nâng cấp link CDN jsDelivr cũ sang Raw GitHub để luôn phản ánh thay đổi tức thời
      let updated = false;
      this.playlists.forEach(p => {
        if (p.url && p.url.includes('jsdelivr.net/gh/ndkhoams/iptv')) {
          p.url = 'https://raw.githubusercontent.com/ndkhoams/iptv/main/ktv.m3u';
          updated = true;
        }
      });
      if (updated) this.savePlaylists();
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
      // 1. Tải danh sách kênh TV từ playlist hiện tại (thêm cache-buster & no-store để luôn có dữ liệu mới nhất)
      let targetUrl = activePl.url;
      if (targetUrl.includes('jsdelivr.net/gh/ndkhoams/iptv')) {
        targetUrl = 'https://raw.githubusercontent.com/ndkhoams/iptv/main/ktv.m3u';
        activePl.url = targetUrl;
        this.savePlaylists();
      }

      const cacheBuster = targetUrl.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
      let m3uText = null;

      try {
        const res = await fetch(`${targetUrl}${cacheBuster}`, {
          signal: AbortSignal.timeout(6000),
          cache: 'no-store'
        });
        if (res.ok) m3uText = await res.text();
      } catch (fErr) {
        console.warn('[Channels] Fetch targetUrl error, fallback:', fErr);
      }

      // Dự phòng nếu không tải được từ URL chính
      if (!m3uText) {
        const fallbackUrl = targetUrl.includes('raw.githubusercontent.com')
          ? targetUrl.replace('raw.githubusercontent.com/ndkhoams/iptv/main', 'fastly.jsdelivr.net/gh/ndkhoams/iptv@main')
          : `https://raw.githubusercontent.com/ndkhoams/iptv/main/ktv.m3u`;
        const resFb = await fetch(`${fallbackUrl}${cacheBuster}`, { cache: 'no-store' });
        if (resFb.ok) m3uText = await resFb.text();
      }

      if (!m3uText) throw new Error('Không thể tải dữ liệu M3U');

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
          let grp = groupMatch[1].trim();

          // 1. Gộp Film4k / Antsports và các sự kiện trực tiếp vào chung 🔴 Live Events (Film4k)
          if (isSports && (
            grp.includes('Film4k') ||
            grp.includes('Antsports') ||
            grp.includes('Sự Kiện Trực Tiếp / TV360') ||
            grp.includes('Live Events (Film4k)')
          )) {
            grp = '🔴 Live Events (Film4k)';
          }

          // 2. Gộp các thư mục kênh thể thao quốc tế
          if (
            grp === 'THỂ THAO QUỐC TẾ' ||
            grp === '⚽| Thể thao quốc tế' ||
            grp === 'Thể Thao' ||
            grp === '📺 SPORT 24/7 TV' ||
            grp === 'SPORT 24/7 TV' ||
            grp === '⚽ Thể Thao Quốc Tế'
          ) {
            grp = '⚽ Thể Thao Quốc Tế';
          }

          // 3. Gộp các thư mục kênh truyền hình quốc tế
          const grpLower = grp.toLowerCase();
          if (
            grp === 'Quốc Tế' ||
            grp === '🌐 Kênh Quốc Tế' ||
            grpLower.includes('trung quốc') ||
            grpLower.includes('hàn quốc') ||
            grpLower.includes('thái lan') ||
            grpLower.includes('israel') ||
            grpLower.includes('tvb')
          ) {
            grp = '🌐 Kênh Quốc Tế';
          }

          if (grp === '🇬🇧 UK Radio') {
            grp = 'Radio';
          }

          currentChannel.group = grp;
        }

        // Extract tvg-id
        const epgMatch = line.match(/tvg-id="([^"]*)"/i);
        if (epgMatch) currentChannel.epgId = epgMatch[1];

        // Extract channel name (after last comma)
        const commaIdx = line.lastIndexOf(',');
        if (commaIdx !== -1) {
          currentChannel.name = line.substring(commaIdx + 1).trim();
        }
      } else if (line.startsWith('#KODIPROP:inputstream.adaptive.license_key=')) {
        if (currentChannel) {
          const val = line.replace('#KODIPROP:inputstream.adaptive.license_key=', '').trim();
          const parts = val.split(':');
          if (parts.length === 2) {
            currentChannel.clearKey = { keyId: parts[0], key: parts[1] };
            currentChannel.dash = true;
          }
        }
      } else if (line.startsWith('#KODIPROP:inputstream.adaptive.manifest_type=mpd')) {
        if (currentChannel) {
          currentChannel.dash = true;
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

  toggleCategoryDropdown(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('categoryDropdownMenu');
    const arrow = document.getElementById('categoryDropdownArrow');
    if (!menu) return;

    const isHidden = menu.classList.contains('hidden');
    if (isHidden) {
      menu.classList.remove('hidden');
      if (arrow) arrow.classList.add('rotate-180');
    } else {
      menu.classList.add('hidden');
      if (arrow) arrow.classList.remove('rotate-180');
    }
  }

  closeCategoryDropdown() {
    const menu = document.getElementById('categoryDropdownMenu');
    const arrow = document.getElementById('categoryDropdownArrow');
    if (menu) menu.classList.add('hidden');
    if (arrow) arrow.classList.remove('rotate-180');
  }

  updateDropdownButton() {
    const labelEl = document.getElementById('categoryDropdownLabel');
    const badgeEl = document.getElementById('categoryDropdownBadge');
    if (!labelEl || !badgeEl) return;

    if (this.currentCategory === 'all') {
      labelEl.textContent = 'Tất cả';
      badgeEl.textContent = this.channels.length;
    } else if (this.currentCategory === 'film4k_live_events') {
      labelEl.textContent = '🔴 Live Events (Film4k)';
      const count = this.channels.filter(c => c.isSports && c.group === '🔴 Live Events (Film4k)').length;
      badgeEl.textContent = count;
    } else if (this.currentCategory === 'sports_all') {
      labelEl.textContent = '⚽ Trận Đấu & Sự Kiện';
      const count = this.channels.filter(c => c.isSports).length;
      badgeEl.textContent = count;
    } else if (this.currentCategory === 'tv_all') {
      labelEl.textContent = '📺 Kênh Truyền Hình';
      const count = this.channels.filter(c => !c.isSports).length;
      badgeEl.textContent = count;
    } else {
      labelEl.textContent = this.currentCategory;
      const count = this.channels.filter(c => c.group === this.currentCategory).length;
      badgeEl.textContent = count;
    }
  }

  extractCategories() {
    const groupCounts = {};
    this.channels.forEach(ch => {
      // Nhóm Film4k Live Events chỉ tính khi thuộc sportsChannels
      if (ch.isSports && ch.group === '🔴 Live Events (Film4k)') {
        groupCounts['🔴 Live Events (Film4k)'] = (groupCounts['🔴 Live Events (Film4k)'] || 0) + 1;
      } else {
        const g = ch.group || 'Khác';
        groupCounts[g] = (groupCounts[g] || 0) + 1;
      }
    });

    const menu = document.getElementById('categoryDropdownMenu');
    if (!menu) return;

    const renderItem = (id, label, count, icon, isHighlighted = false) => {
      const isSelected = this.currentCategory === id;
      const highlightClasses = isHighlighted ? 'text-amber-300 font-semibold' : 'text-white/90 font-medium';
      const activeBg = isSelected ? 'bg-white/15 text-white font-bold' : 'hover:bg-white/10 text-white/80';
      return `
        <button type="button" onclick="window.channelManager.setCategory('${encodeURIComponent(id)}')"
          class="w-full px-3 py-2 rounded-xl flex items-center justify-between text-xs transition cursor-pointer text-left ${activeBg}">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="text-sm shrink-0">${icon}</span>
            <span class="truncate ${highlightClasses}">${label}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[10px] px-1.5 py-0.5 rounded-md bg-white/10 text-[var(--label-3)] font-mono">${count}</span>
            ${isSelected ? '<span class="text-[var(--accent)] font-bold text-xs">✓</span>' : '<span class="w-3"></span>'}
          </div>
        </button>
      `;
    };

    let html = '';

    // 1. Tất cả kênh
    html += renderItem('all', 'Tất cả kênh & sự kiện', this.channels.length, '📁');

    // 2. Thư mục dành riêng: 🔴 Live Events (Film4k) - CHỈ tính luồng sự kiện trực tiếp từ Film4k / TV360
    const film4kCount = this.channels.filter(c => c.isSports && c.group === '🔴 Live Events (Film4k)').length;
    if (film4kCount > 0) {
      html += renderItem('film4k_live_events', '🔴 Live Events (Film4k)', film4kCount, '🔴', true);
    }

    // 3. Tổng hợp Trận Đấu Trực Tiếp & Kênh Truyền Hình
    const sportsLiveCount = this.channels.filter(c => c.isSports).length;
    if (sportsLiveCount > 0) {
      html += renderItem('sports_all', '⚽ Trực Tiếp Trận Đấu', sportsLiveCount, '⚽');
    }
    const tvCount = this.channels.filter(c => !c.isSports).length;
    if (tvCount > 0) {
      html += renderItem('tv_all', '📺 Tất Cả Kênh Truyền Hình', tvCount, '📺');
    }

    // Đường phân cách
    html += `<div class="my-1 border-t border-white/10"></div>`;

    // Nhóm Trận Đấu Thể Thao Trực Tiếp (CHỈ gồm các nhóm luồng trận đấu từ thethao.m3u)
    const sportsMatchGroups = Object.keys(groupCounts).filter(g => 
      g !== '🔴 Live Events (Film4k)' && 
      this.channels.some(c => c.isSports && c.group === g)
    );
    if (sportsMatchGroups.length > 0) {
      html += `<div class="px-3 py-1 text-[10px] font-semibold tracking-wider text-[var(--orange)] uppercase">Trận Đấu &amp; Sự Kiện Trực Tiếp</div>`;
      sportsMatchGroups.forEach(grp => {
        let icon = '⚽';
        if (grp.includes('🍌') || grp.includes('Chuối')) icon = '🍌';
        else if (grp.includes('🐔') || grp.includes('Gà')) icon = '🐔';
        else if (grp.includes('🍵') || grp.includes('Xôi')) icon = '🍵';
        else if (grp.includes('🥤') || grp.includes('Cola')) icon = '🥤';
        else if (grp.includes('🏀') || grp.includes('Bóng rổ')) icon = '🏀';
        html += renderItem(grp, grp, groupCounts[grp], icon);
      });
      html += `<div class="my-1 border-t border-white/10"></div>`;
    }

    // Nhóm Kênh Truyền Hình (bao gồm cả các kênh TV thể thao 24/7 như Sky Sport, TNT Sports, Canal+...)
    const tvGroups = Object.keys(groupCounts).filter(g => 
      g !== '🔴 Live Events (Film4k)' && !sportsMatchGroups.includes(g)
    );
    if (tvGroups.length > 0) {
      html += `<div class="px-3 py-1 text-[10px] font-semibold tracking-wider text-[var(--label-3)] uppercase">Nhóm Kênh Truyền Hình</div>`;
      tvGroups.forEach(grp => {
        let icon = '📺';
        if (grp.toLowerCase().includes('phim')) icon = '🎬';
        else if (grp.includes('Thể Thao') || grp.includes('SPORT')) icon = '⚽';
        else if (grp.includes('Quốc Tế') || grp.includes('Thiết yếu')) icon = '🌐';
        else if (grp.includes('Radio')) icon = '📻';
        html += renderItem(grp, grp, groupCounts[grp], icon);
      });
    }

    menu.innerHTML = html;
    this.updateDropdownButton();
  }

  setCategory(category) {
    if (category === 'all' || category === 'sports_all' || category === 'tv_all' || category === 'film4k_live_events') {
      this.currentCategory = category;
    } else {
      this.currentCategory = decodeURIComponent(category);
    }
    
    this.closeCategoryDropdown();
    this.updateDropdownButton();
    this.extractCategories();
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
      } else if (this.currentCategory === 'film4k_live_events') {
        matchesCategory = !!ch.isSports && ch.group === '🔴 Live Events (Film4k)';
      } else if (this.currentCategory === 'sports_all') {
        // CHỈ giữ lại các sự kiện & trận đấu trực tiếp, TUYỆT ĐỐI không đưa kênh truyền hình vào đây
        matchesCategory = !!ch.isSports;
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

  getChannelSportInfo(ch) {
    if (!ch) return null;
    if (!ch.isSports && !ch.group?.includes('Thể Thao') && !ch.group?.includes('Live Events') && !ch.group?.includes('SPORT')) {
      return null;
    }

    const name = (ch.name || '').toLowerCase();
    const group = (ch.group || '').toLowerCase();
    const logo = (ch.logo || '').toLowerCase();
    const combined = `${name} ${group} ${logo}`;

    // 1. Khắc phục nhầm lẫn: AFC Wimbledon & các CLB bóng đá bị gán nhầm thành giải Tennis
    const isWimbledonFootball = combined.includes('afc wimbledon') || combined.includes('wimbledon fc') ||
      (combined.includes('wimbledon') && (combined.includes('blackpool') || combined.includes('efl') || combined.includes('fa cup') || combined.includes('league two') || combined.includes('league 2')));

    if (isWimbledonFootball) {
      return {
        name: 'Bóng đá',
        icon: '⚽',
        badgeColor: 'bg-sky-500/15 border-sky-500/35 text-sky-300'
      };
    }

    // 2. Rugby / Bóng bầu dục (Nations Championship, Autumn Nations, Six Nations, All Blacks, Springboks...)
    if (logo.includes('/rugby/') || combined.includes('rugby') || combined.includes('bóng bầu dục') || combined.includes('nations championship') || 
        combined.includes('autumn nations') || combined.includes('six nations') || combined.includes('all blacks') ||
        (combined.includes('italy') && combined.includes('argentina') && (combined.includes('nations') || combined.includes('rugby') || combined.includes('18:40'))) ||
        (combined.includes('wales') && combined.includes('new zealand') && (combined.includes('nations') || combined.includes('rugby') || combined.includes('21:10')))) {
      return {
        name: 'Bóng bầu dục',
        icon: '🏉',
        badgeColor: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
      };
    }

    // 3. F1 / Đua xe tốc độ
    if (combined.includes('f1') || combined.includes('formula 1') || combined.includes('grand prix') || combined.includes('motogp') || combined.includes('đua xe')) {
      return {
        name: 'Đua xe F1',
        icon: '🏎️',
        badgeColor: 'bg-rose-500/15 border-rose-500/35 text-rose-300'
      };
    }

    // 4. Tennis / Quần vợt
    if (logo.includes('/tennis/') || combined.includes('tennis') || combined.includes('quần vợt') || combined.includes('atp') || combined.includes('wta') || combined.includes('grand slam') || (combined.includes('wimbledon') && !combined.includes('afc'))) {
      return {
        name: 'Quần vợt',
        icon: '🎾',
        badgeColor: 'bg-yellow-500/15 border-yellow-500/35 text-yellow-300'
      };
    }

    // 5. Basketball / Bóng rổ
    if (logo.includes('/basketball/') || combined.includes('nba') || combined.includes('bóng rổ') || combined.includes('basketball')) {
      return {
        name: 'Bóng rổ',
        icon: '🏀',
        badgeColor: 'bg-amber-500/15 border-amber-500/35 text-amber-300'
      };
    }

    // 6. American football / NFL / NCAA Football
    if (logo.includes('/american-football/') || combined.includes('nfl') || combined.includes('ncaaf') || combined.includes('american football') || combined.includes('bóng bầu dục mỹ')) {
      return {
        name: 'Bóng bầu dục Mỹ',
        icon: '🏈',
        badgeColor: 'bg-orange-500/15 border-orange-500/35 text-orange-300'
      };
    }

    // 7. Ice Hockey / Khúc côn cầu
    if (logo.includes('/hockey/') || combined.includes('nhl') || combined.includes('khúc côn cầu') || combined.includes('hockey')) {
      return {
        name: 'Khúc côn cầu',
        icon: '🏒',
        badgeColor: 'bg-cyan-500/15 border-cyan-500/35 text-cyan-300'
      };
    }

    // 8. Võ thuật / UFC / Boxing / MMA
    if (logo.includes('/mma/') || combined.includes('ufc') || combined.includes('boxing') || combined.includes('mma') || combined.includes('one championship') || combined.includes('võ thuật')) {
      return {
        name: 'Võ thuật',
        icon: '🥊',
        badgeColor: 'bg-red-500/15 border-red-500/35 text-red-300'
      };
    }

    // 9. Volleyball / Bóng chuyền
    if (logo.includes('/volleyball/') || combined.includes('volleyball') || combined.includes('bóng chuyền')) {
      return {
        name: 'Bóng chuyền',
        icon: '🏐',
        badgeColor: 'bg-blue-500/15 border-blue-500/35 text-blue-300'
      };
    }

    // 10. Sự kiện âm nhạc / ca nhạc / giải trí
    if (combined.includes('y - fest') || combined.includes('y fest') || combined.includes('ca nhạc') || combined.includes('concert') || combined.includes('liveshow')) {
      return {
        name: 'Sự kiện âm nhạc',
        icon: '🎵',
        badgeColor: 'bg-purple-500/15 border-purple-500/35 text-purple-300'
      };
    }

    // 11. Mặc định là Bóng đá
    return {
      name: 'Bóng đá',
      icon: '⚽',
      badgeColor: 'bg-sky-500/15 border-sky-500/35 text-sky-300'
    };
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
      const sport = ch.isSports ? this.getChannelSportInfo(ch) : null;
      let displayName = ch.name;
      if (sport) {
        displayName = displayName.replace(/^[⚽🎾🏀🏎️🏉🏈🥊🏒🚴🏐🎱🏸🎵🔴]\uFE0F?\s*/, '').trim();
      }

      const logoHtml = ch.logo
        ? `<img src="${ch.logo}" alt="${displayName}" class="w-full h-full object-contain" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
           <span style="display:none;" class="text-xs font-black text-[var(--orange)]">${sport ? sport.icon : displayName.substring(0, 4)}</span>`
        : `<span class="text-xs font-black text-[var(--orange)]">${sport ? sport.icon : displayName.substring(0, 4)}</span>`;

      const sportBadgeHtml = sport
        ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${sport.badgeColor} shrink-0">${sport.icon} ${sport.name}</span>`
        : '';

      html += `
        <div onclick="window.channelManager.selectChannel(${ch.id}, true)" 
             id="chan-row-${ch.id}" 
             class="channel-row p-3.5 sm:p-4 flex items-center justify-between gap-4 cursor-pointer ${isActive ? 'active' : ''}">
          <div class="flex items-center gap-3.5 min-w-0 flex-1">
            <div class="w-11 h-11 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-white/10 flex items-center justify-center p-1.5 shrink-0 shadow-inner overflow-hidden">
              ${logoHtml}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap sm:flex-nowrap min-w-0">
                ${sportBadgeHtml}
                <span class="text-sm font-semibold text-white truncate ${ch.isSports ? 'text-amber-100' : ''}">${displayName}</span>
                ${isActive ? '<span class="w-2 h-2 rounded-full bg-[var(--green)] shrink-0"></span>' : ''}
                <span class="text-[10px] font-mono text-[var(--label-3)] shrink-0 px-1.5 py-0.5 rounded bg-white/5 border border-white/5">${ch.group}</span>
              </div>
              <p class="text-xs text-[var(--label-2)] truncate mt-0.5">
                ${ch.isSports ? (sport ? `🔥 Trực tiếp ${sport.name} • Chạm để phát` : '🔥 Trực tiếp trận đấu • Chạm để phát') : '● Trực tiếp HD • Chạm để phát'}
              </p>
            </div>
          </div>
          <div class="hidden sm:block text-right shrink-0">
            <span class="text-[11px] text-[var(--label-3)]">#${ch.id + 1}</span>
            <p class="text-xs font-mono ${ch.isSports ? 'text-orange-400 font-bold' : 'text-[var(--label-2)]'}">${sport ? `${sport.icon} LIVE` : (ch.isSports ? 'LIVE' : '1080p')}</p>
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
      const sport = ch.isSports ? this.getChannelSportInfo(ch) : null;
      let cleanTitle = ch.name;
      if (sport) {
        cleanTitle = cleanTitle.replace(/^[⚽🎾🏀🏎️🏉🏈🥊🏒🚴🏐🎱🏸🎵🔴]\uFE0F?\s*/, '').trim();
      }

      this.player.playStream(ch.url, {
        name: ch.name,
        title: ch.isSports ? (sport ? `${sport.icon} ${cleanTitle}` : cleanTitle) : `${ch.name} (Trực tiếp)`,
        subtitle: ch.isSports ? `Trực tiếp ${sport ? sport.name : 'thể thao'} • ${ch.group}` : `Phát từ nguồn: ${ch.group} • Nền tảng Apple Screens & Web`,
        group: ch.group,
        dash: ch.dash,
        clearKey: ch.clearKey
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
