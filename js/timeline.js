/**
 * TV Play — Timeline EPG Engine
 * Replicates the Apple TV / iOS EPG Guide layout (Now & Next Matrix).
 * Features:
 * - Dropdown category selector matching the Channels tab design
 * - Pixel-accurate absolute time positioning for all broadcast programs
 * - Full multi-channel EPG matching from lichphatsong.io.vn (VTV, VTVcab, SCTV, HTV, TV360, Local TV)
 * - Dynamic real-time "HIỆN TẠI" time indicator with 1-click smooth jump
 */

class TimelineManager {
  constructor(channelManager, player) {
    this.channelManager = channelManager;
    this.player = player;
    this.epgData = {}; // channelId -> array of { start, stop, title, desc }
    this.epgMap = {};  // normalizedKey -> array of programmes
    this.pxPerMinute = 5.333; // 160px per 30 minutes
    this.slotMinutes = 30;
    this.totalSlots = 14; // 7 hours of timeline
    this.startTime = null; // Date object for start of timeline
    this.categories = [];
    this.currentCatIndex = 0;
    this.epgUrl = 'https://lichphatsong.io.vn/epg.xml';
    this.nowTimer = null;
  }

  init() {
    this.initTimelineTimeRange();
    this.loadEpgDataInBackground();

    // Re-render when channels are loaded
    if (this.channelManager.channels.length > 0) {
      this.onChannelsLoaded();
    }

    // Auto-update red line position every 60 seconds
    this.nowTimer = setInterval(() => {
      this.updateNowIndicator();
    }, 60000);

    // Close timeline category dropdown on outside click
    document.addEventListener('click', (e) => {
      const container = document.getElementById('timelineCategoryDropdownContainer');
      if (container && !container.contains(e.target)) {
        this.closeCategoryDropdown();
      }
    });
  }

  initTimelineTimeRange() {
    const now = new Date();
    // Start timeline 1 hour before current time, rounded down to nearest 30 mins
    const start = new Date(now.getTime() - 60 * 60 * 1000);
    const minutes = start.getMinutes();
    start.setMinutes(minutes < 30 ? 0 : 30, 0, 0);
    this.startTime = start;
  }

  normalizeKey(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/plus/g, '')
      .replace(/hd/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  onChannelsLoaded() {
    const catSet = new Set();
    const list = (this.channelManager.tvChannels && this.channelManager.tvChannels.length > 0) 
      ? this.channelManager.tvChannels 
      : this.channelManager.channels;
    
    list.forEach(ch => {
      if (ch.group) catSet.add(ch.group);
    });

    this.categories = Array.from(catSet);
    if (this.categories.length === 0) this.categories = ['VTV', 'Thể Thao', 'Khác'];

    // Prioritize VTV as first category
    const vtvIdx = this.categories.findIndex(c => c.toLowerCase() === 'vtv');
    if (vtvIdx !== -1) {
      this.currentCatIndex = vtvIdx;
    }

    this.render();
  }

  getCurrentCategory() {
    return this.categories[this.currentCatIndex] || 'VTV';
  }

  toggleCategoryDropdown(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const menu = document.getElementById('timelineCategoryDropdownMenu');
    const arrow = document.getElementById('timelineCategoryDropdownArrow');
    if (!menu) return;

    const isHidden = menu.classList.contains('hidden');
    if (isHidden) {
      this.renderTimelineCategoryDropdownItems();
      menu.classList.remove('hidden');
      if (arrow) arrow.classList.add('rotate-180');
    } else {
      this.closeCategoryDropdown();
    }
  }

  closeCategoryDropdown() {
    const menu = document.getElementById('timelineCategoryDropdownMenu');
    const arrow = document.getElementById('timelineCategoryDropdownArrow');
    if (menu) menu.classList.add('hidden');
    if (arrow) arrow.classList.remove('rotate-180');
  }

  selectCategory(catName, e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const idx = this.categories.indexOf(catName);
    if (idx !== -1) {
      this.currentCatIndex = idx;
    }
    this.closeCategoryDropdown();
    this.render();
  }

  renderTimelineCategoryDropdownItems() {
    const menu = document.getElementById('timelineCategoryDropdownMenu');
    if (!menu) return;

    const channelSource = (this.channelManager.tvChannels && this.channelManager.tvChannels.length > 0) 
      ? this.channelManager.tvChannels 
      : this.channelManager.channels;

    const currentCat = this.getCurrentCategory();

    let html = '';
    this.categories.forEach(cat => {
      const count = channelSource.filter(ch => ch.group === cat).length;
      const isSelected = (cat === currentCat);
      const safeCat = cat.replace(/'/g, "\\'");
      html += `
        <button type="button" onclick="window.timelineManager.selectCategory('${safeCat}', event)"
          class="w-full px-3 py-2 rounded-xl text-left text-xs flex items-center justify-between transition cursor-pointer ${isSelected ? 'bg-white/20 text-white font-bold' : 'text-white/80 hover:bg-white/10 hover:text-white'}">
          <div class="flex items-center gap-2 truncate">
            <span class="truncate">${cat}</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <span class="text-[10px] px-1.5 py-0.5 rounded-md bg-white/10 text-white/70 font-mono">${count}</span>
            ${isSelected ? '<svg class="w-3.5 h-3.5 text-[var(--orange)] shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' : ''}
          </div>
        </button>
      `;
    });

    menu.innerHTML = html;
  }

  render() {
    const container = document.getElementById('timelineContainer');
    if (!container) return;

    const currentCat = this.getCurrentCategory();
    const channelSource = (this.channelManager.tvChannels && this.channelManager.tvChannels.length > 0) 
      ? this.channelManager.tvChannels 
      : this.channelManager.channels;
    const channelsInCat = channelSource.filter(ch => ch.group === currentCat);
    const gridWidth = this.totalSlots * 160;

    let html = `
      <div class="strand-timeline-wrapper">
        
        <!-- Header Category Dropdown Bar -->
        <div class="timeline-cat-bar">
          
          <!-- Category Dropdown Selector -->
          <div id="timelineCategoryDropdownContainer" class="relative z-40 min-w-[200px] sm:min-w-[260px]">
            <button id="timelineCategoryDropdownBtn" type="button" onclick="window.timelineManager.toggleCategoryDropdown(event)"
              class="px-3.5 py-2 rounded-2xl glass-card border border-white/10 hover:border-white/20 text-white flex items-center justify-between gap-3 text-xs transition active:scale-[0.98] cursor-pointer shadow-lg">
              <div class="flex items-center gap-2 overflow-hidden">
                <svg class="w-4 h-4 text-[var(--orange)] shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                </svg>
                <span class="text-[var(--label-3)] shrink-0 hidden sm:inline">Nhóm:</span>
                <span id="timelineCategoryDropdownLabel" class="font-bold text-white truncate">${currentCat}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-md bg-white/10 text-white/80 shrink-0 font-mono">${channelsInCat.length} kênh</span>
              </div>
              <div class="flex items-center gap-1 text-[var(--label-2)] shrink-0">
                <svg id="timelineCategoryDropdownArrow" class="w-4 h-4 transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
                </svg>
              </div>
            </button>

            <!-- Dropdown Menu Items -->
            <div id="timelineCategoryDropdownMenu"
              class="absolute left-0 top-full mt-1.5 w-64 sm:w-72 p-1.5 rounded-2xl glass-modal border border-white/15 shadow-2xl backdrop-blur-2xl max-h-[380px] overflow-y-auto no-scrollbar space-y-1 hidden z-50">
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-[11px] text-[var(--label-2)] hidden sm:inline">Vuốt ngang xem lịch</span>
            <button onclick="window.timelineManager.scrollToNow()" title="Nhảy tới giờ hiện tại" class="px-3 py-1.5 rounded-full glass-pill text-[11px] font-bold text-[var(--orange)] hover:text-white transition flex items-center gap-1.5 cursor-pointer">
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--red)] animate-ping"></span>
              HIỆN TẠI
            </button>
          </div>
        </div>

        <!-- Scrollable Timeline Matrix -->
        <div id="timelineScrollArea" class="timeline-scroll-area no-scrollbar">
          
          <!-- Sticky Left Channel Logos Column -->
          <div class="timeline-channel-col">
            <div class="timeline-corner-cell">Kênh</div>
            ${channelsInCat.map(ch => this.renderChannelLogoCell(ch)).join('')}
          </div>

          <!-- Schedule Matrix with Top Time Ruler -->
          <div class="timeline-schedule-grid" style="width: ${gridWidth}px; min-width: ${gridWidth}px;">
            
            <!-- Top Time Ruler -->
            <div class="timeline-ruler">
              ${this.renderTimeSlots()}
            </div>

            <!-- Red Time Indicator Line -->
            <div id="timelineNowIndicator" class="timeline-now-indicator">
              <div class="timeline-now-triangle"></div>
            </div>

            <!-- Program Rows -->
            ${channelsInCat.map(ch => this.renderChannelProgramRow(ch)).join('')}

          </div>

        </div>

      </div>
    `;

    container.innerHTML = html;
    this.updateNowIndicator();
  }

  renderChannelLogoCell(ch) {
    const isActive = this.channelManager.currentIndex === ch.id;
    const logoSrc = ch.logo || '';
    const logoHtml = logoSrc 
      ? `<img src="${logoSrc}" alt="${ch.name}" class="w-full h-full object-contain p-1" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"/>
         <span style="display:none;" class="text-xs font-black text-[var(--orange)]">${ch.name.substring(0, 4)}</span>`
      : `<span class="text-xs font-black text-[var(--orange)]">${ch.name.substring(0, 4)}</span>`;

    return `
      <div onclick="window.channelManager.selectChannel(${ch.id}, true)" 
           class="timeline-channel-cell ${isActive ? 'active' : ''}" 
           title="${ch.name}">
        <div class="timeline-logo-card">
          ${logoHtml}
        </div>
      </div>
    `;
  }

  renderTimeSlots() {
    let html = '';
    const start = new Date(this.startTime.getTime());

    for (let i = 0; i < this.totalSlots; i++) {
      const hours = start.getHours();
      const minutes = start.getMinutes();
      const ampm = hours >= 12 ? 'pm' : 'am';
      const formattedHours = hours % 12 === 0 ? 12 : hours % 12;
      const formattedMinutes = minutes === 0 ? '00' : minutes;
      const timeLabel = `${formattedHours}:${formattedMinutes}${ampm}`;

      html += `<div class="time-slot-label">${timeLabel}</div>`;
      start.setMinutes(start.getMinutes() + this.slotMinutes);
    }

    return html;
  }

  renderChannelProgramRow(ch) {
    const programmes = this.getProgrammesForChannel(ch);
    const rowWidth = this.totalSlots * 160;

    return `
      <div class="timeline-row" style="position: relative; width: ${rowWidth}px; min-width: ${rowWidth}px;">
        ${programmes.map(p => this.renderProgramBlock(ch, p)).join('')}
      </div>
    `;
  }

  renderProgramBlock(ch, p) {
    const isNow = p.isCurrent;
    const startTimeStr = this.formatTime(p.startDate);
    const stopTimeStr = this.formatTime(p.stopDate);

    return `
      <div onclick="window.timelineManager.onProgramClick(${ch.id}, '${encodeURIComponent(p.title)}', '${encodeURIComponent(ch.name)}')" 
           class="program-block ${isNow ? 'active' : ''}" 
           style="left: ${p.leftPx}px; width: ${p.widthPx}px;"
           title="${ch.name} - ${p.title} (${startTimeStr} - ${stopTimeStr})">
        <div class="p-top">
          <span class="truncate">${ch.name}</span>
          <span class="px-1 py-0.2 rounded bg-white/10 text-[9px] font-bold shrink-0">HD</span>
          <span class="font-mono text-[var(--orange)] shrink-0">${startTimeStr}</span>
        </div>
        <div class="p-title">${p.title}</div>
      </div>
    `;
  }

  onProgramClick(channelId, encodedTitle, encodedChannelName) {
    const title = decodeURIComponent(encodedTitle);
    this.channelManager.selectChannel(channelId, true);

    // Update Player HUD subtitle to reflect clicked program
    const sub = document.getElementById('playerProgramSubtitle');
    if (sub) {
      sub.textContent = `${title} • Lịch phát sóng trực tuyến`;
    }
  }

  getProgrammesForChannel(ch) {
    const rawId = (ch.epgId || '').toLowerCase().trim();
    const normId = this.normalizeKey(ch.epgId);
    const normName = this.normalizeKey(ch.name);

    let channelEpg = null;
    if (rawId && this.epgData[rawId]) {
      channelEpg = this.epgData[rawId];
    } else if (normId && this.epgMap[normId]) {
      channelEpg = this.epgMap[normId];
    } else if (normName && this.epgMap[normName]) {
      channelEpg = this.epgMap[normName];
    }

    const now = new Date();
    const windowStart = this.startTime.getTime();
    const windowEnd = windowStart + this.totalSlots * this.slotMinutes * 60 * 1000;

    // 1. If real EPG data is available from lichphatsong.io.vn
    if (channelEpg && channelEpg.length > 0) {
      const filtered = channelEpg.filter(p => {
        const pStart = p.startDate.getTime();
        const pEnd = p.stopDate.getTime();
        return pEnd > windowStart && pStart < windowEnd;
      });

      if (filtered.length > 0) {
        return filtered.map(p => {
          const effectiveStart = Math.max(windowStart, p.startDate.getTime());
          const effectiveEnd = Math.min(windowEnd, p.stopDate.getTime());
          const leftPx = Math.max(0, Math.round((effectiveStart - windowStart) / (60 * 1000) * this.pxPerMinute));
          const widthPx = Math.max(28, Math.round((effectiveEnd - effectiveStart) / (60 * 1000) * this.pxPerMinute) - 4);

          return {
            title: p.title,
            desc: p.desc || '',
            startDate: p.startDate,
            stopDate: p.stopDate,
            leftPx: leftPx,
            widthPx: widthPx,
            isCurrent: now >= p.startDate && now < p.stopDate
          };
        });
      }
    }

    // 2. Realistic Dynamic Schedule fallback so timeline is properly aligned
    return this.generateMockSchedule(ch, windowStart, windowEnd);
  }

  generateMockSchedule(ch, windowStart, windowEnd) {
    const isTv360 = (ch.group || '').toLowerCase().includes('tv360') || ch.name.toLowerCase().includes('tv360');
    const isSport = (ch.group || '').toLowerCase().includes('thể thao');

    // TV360 channels in standby
    if (isTv360) {
      return [{
        title: 'Tiếp sóng sự kiện TV360',
        desc: `${ch.name} phát sóng trực tiếp sự kiện thể thao và giải trí`,
        startDate: new Date(windowStart),
        stopDate: new Date(windowEnd),
        leftPx: 0,
        widthPx: this.totalSlots * 160 - 6,
        isCurrent: true
      }];
    }

    const sampleTitles = isSport 
      ? ['Trực tiếp Ngoại Hạng Anh', 'Bản tin Thể thao 24/7', 'Tổng hợp Champions League', 'Tạp chí Tennis', 'Bóng đá Thế giới']
      : ['Thời sự & Tin tức', 'Phim truyện đặc sắc', 'Giai điệu âm nhạc', 'Chuyển động 24h', 'Khám phá thế giới'];

    const programmes = [];
    const now = new Date();
    let cursor = new Date(windowStart);
    let titleIdx = Math.abs(ch.id || 0) % sampleTitles.length;

    while (cursor.getTime() < windowEnd) {
      const duration = 60; // 60 mins blocks for clean grid alignment
      const pStart = new Date(cursor.getTime());
      const pEnd = new Date(cursor.getTime() + duration * 60 * 1000);

      const effectiveStart = Math.max(windowStart, pStart.getTime());
      const effectiveEnd = Math.min(windowEnd, pEnd.getTime());
      const leftPx = Math.max(0, Math.round((effectiveStart - windowStart) / (60 * 1000) * this.pxPerMinute));
      const widthPx = Math.max(28, Math.round((effectiveEnd - effectiveStart) / (60 * 1000) * this.pxPerMinute) - 4);

      programmes.push({
        title: sampleTitles[titleIdx % sampleTitles.length],
        desc: `${ch.name} phát sóng chất lượng Full HD`,
        startDate: pStart,
        stopDate: pEnd,
        leftPx: leftPx,
        widthPx: widthPx,
        isCurrent: now >= pStart && now < pEnd
      });

      cursor.setMinutes(cursor.getMinutes() + duration);
      titleIdx++;
    }

    return programmes;
  }

  updateNowIndicator() {
    const indicator = document.getElementById('timelineNowIndicator');
    if (!indicator || !this.startTime) return;

    const now = new Date();
    const diffMinutes = (now.getTime() - this.startTime.getTime()) / (60 * 1000);

    if (diffMinutes >= 0 && diffMinutes <= this.totalSlots * this.slotMinutes) {
      const leftOffset = Math.round(diffMinutes * this.pxPerMinute);
      indicator.style.left = `${leftOffset}px`;
      indicator.style.display = 'block';
    } else {
      indicator.style.display = 'none';
    }
  }

  scrollToNow() {
    const scrollArea = document.getElementById('timelineScrollArea');
    const indicator = document.getElementById('timelineNowIndicator');
    if (!scrollArea || !indicator) return;

    const left = parseInt(indicator.style.left || '0', 10);
    scrollArea.scrollTo({ left: Math.max(0, left - 150), behavior: 'smooth' });
  }

  formatTime(date) {
    if (!date) return '';
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    const formattedHours = hours % 12 === 0 ? 12 : hours % 12;
    const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
    return `${formattedHours}:${formattedMinutes}${ampm}`;
  }

  async loadEpgDataInBackground() {
    try {
      // Check memory cache first
      if (window.tvplay_epgData && Object.keys(window.tvplay_epgData).length > 0) {
        this.epgData = window.tvplay_epgData;
        this.epgMap = window.tvplay_epgMap || {};
        this.render();
        return;
      }

      // Fetch live EPG XML
      const res = await fetch(this.epgUrl);
      if (!res.ok) return;
      const xmlText = await res.text();

      this.parseEpgXml(xmlText);
      window.tvplay_epgData = this.epgData;
      window.tvplay_epgMap = this.epgMap;
      this.render();
    } catch (err) {
      console.warn('[Timeline] EPG fetch background warning:', err);
    }
  }

  parseEpgXml(xmlText) {
    const progRegex = /<programme start="(\d{14}) \+0700" stop="(\d{14}) \+0700" channel="([^"]+)">\s*<title[^>]*>([^<]+)<\/title>(?:\s*<desc[^>]*>([^<]*)<\/desc>)?/g;
    let match;
    const epg = {};
    const map = {};

    while ((match = progRegex.exec(xmlText)) !== null) {
      const startStr = match[1];
      const stopStr = match[2];
      const rawChannelId = match[3].toLowerCase();
      const title = match[4].trim();
      const desc = (match[5] || '').trim();

      const startDate = this.parseXmlDate(startStr);
      const stopDate = this.parseXmlDate(stopStr);

      const item = { startDate, stopDate, title, desc };

      if (!epg[rawChannelId]) epg[rawChannelId] = [];
      epg[rawChannelId].push(item);

      const norm = this.normalizeKey(rawChannelId);
      if (norm) {
        if (!map[norm]) map[norm] = [];
        map[norm].push(item);
      }
    }

    this.epgData = epg;
    this.epgMap = map;
    console.log('[Timeline] EPG parsed successfully for', Object.keys(epg).length, 'channels');
  }

  parseXmlDate(str) {
    // Format: YYYYMMDDHHMMSS
    const year = parseInt(str.substring(0, 4), 10);
    const month = parseInt(str.substring(4, 6), 10) - 1;
    const day = parseInt(str.substring(6, 8), 10);
    const hour = parseInt(str.substring(8, 10), 10);
    const min = parseInt(str.substring(10, 12), 10);
    const sec = parseInt(str.substring(12, 14), 10);
    return new Date(year, month, day, hour, min, sec);
  }
}

window.TimelineManager = TimelineManager;
