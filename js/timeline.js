/**
 * TV Play Strand Edition — Timeline EPG Engine
 * Replicates the Strand Apple TV / iOS EPG Guide layout (Now & Next Matrix).
 */

class TimelineManager {
  constructor(channelManager, player) {
    this.channelManager = channelManager;
    this.player = player;
    this.epgData = {}; // channelId -> array of { start, stop, title, desc }
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
  }

  initTimelineTimeRange() {
    const now = new Date();
    // Start timeline 1 hour before current time, rounded down to nearest 30 mins
    const start = new Date(now.getTime() - 60 * 60 * 1000);
    const minutes = start.getMinutes();
    start.setMinutes(minutes < 30 ? 0 : 30, 0, 0);
    this.startTime = start;
  }

  onChannelsLoaded() {
    // Extract unique categories from TV channels (ưu tiên các kênh truyền hình có lịch phát sóng EPG)
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

  nextCategory() {
    if (this.categories.length === 0) return;
    this.currentCatIndex = (this.currentCatIndex + 1) % this.categories.length;
    this.render();
  }

  prevCategory() {
    if (this.categories.length === 0) return;
    this.currentCatIndex = (this.currentCatIndex - 1 + this.categories.length) % this.categories.length;
    this.render();
  }

  render() {
    const container = document.getElementById('timelineContainer');
    if (!container) return;

    const currentCat = this.getCurrentCategory();
    const channelSource = (this.channelManager.tvChannels && this.channelManager.tvChannels.length > 0) 
      ? this.channelManager.tvChannels 
      : this.channelManager.channels;
    const channelsInCat = channelSource.filter(ch => ch.group === currentCat);

    // 1. Category Switcher Bar (< VTV >)
    let html = `
      <div class="strand-timeline-wrapper">
        
        <!-- Header Category Switcher -->
        <div class="timeline-cat-bar">
          <div class="flex items-center gap-2">
            <button onclick="window.timelineManager.prevCategory()" class="w-7 h-7 rounded-full glass-pill flex items-center justify-center text-white/80 hover:text-white active:scale-90 transition">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <span class="text-sm font-bold text-white px-2 tracking-wide flex items-center gap-2">
              <span>${currentCat}</span>
              <span class="text-[10px] font-mono font-normal px-2 py-0.5 rounded-full bg-white/10 text-white/70">${channelsInCat.length} kênh</span>
            </span>
            <button onclick="window.timelineManager.nextCategory()" class="w-7 h-7 rounded-full glass-pill flex items-center justify-center text-white/80 hover:text-white active:scale-90 transition">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-[11px] text-[var(--label-2)] hidden sm:inline">Vuốt ngang xem lịch</span>
            <button onclick="window.timelineManager.scrollToNow()" title="Nhảy tới hiện tại" class="px-2.5 py-1 rounded-full glass-pill text-[11px] font-bold text-[var(--orange)] hover:text-white transition flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--red)] animate-ping"></span>
              HIỆN TẠI
            </button>
          </div>
        </div>

        <!-- Scrollable Timeline Matrix -->
        <div id="timelineScrollArea" class="timeline-scroll-area no-scrollbar">
          
          <!-- Sticky Left Channel Logos Column -->
          <div class="timeline-channel-col">
            <div class="timeline-corner-cell">Hôm nay</div>
            ${channelsInCat.map(ch => this.renderChannelLogoCell(ch)).join('')}
          </div>

          <!-- Schedule Matrix with Top Time Ruler -->
          <div class="timeline-schedule-grid" style="width: ${this.totalSlots * 160}px;">
            
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

    return `
      <div class="timeline-row">
        ${programmes.map(p => this.renderProgramBlock(ch, p)).join('')}
      </div>
    `;
  }

  renderProgramBlock(ch, p) {
    const isNow = p.isCurrent;
    const widthPx = Math.max(70, Math.round(p.durationMinutes * this.pxPerMinute));
    const startTimeStr = this.formatTime(p.startDate);

    return `
      <div onclick="window.timelineManager.onProgramClick(${ch.id}, '${encodeURIComponent(p.title)}', '${encodeURIComponent(ch.name)}')" 
           class="program-block ${isNow ? 'active' : ''}" 
           style="width: ${widthPx}px;"
           title="${ch.name} - ${p.title} (${startTimeStr})">
        <div class="p-top">
          <span class="truncate">${ch.name}</span>
          <span class="px-1 py-0.2 rounded bg-white/10 text-[9px] font-bold">HD</span>
          <span class="font-mono text-[var(--orange)]">${startTimeStr}</span>
        </div>
        <div class="p-title">${p.title}</div>
      </div>
    `;
  }

  onProgramClick(channelId, encodedTitle, encodedChannelName) {
    const title = decodeURIComponent(encodedTitle);
    const channelName = decodeURIComponent(encodedChannelName);

    this.channelManager.selectChannel(channelId, true);

    // Update Player HUD subtitle to reflect clicked program
    const sub = document.getElementById('playerProgramSubtitle');
    if (sub) {
      sub.textContent = `${title} • Lịch phát sóng trực tuyến`;
    }
  }

  getProgrammesForChannel(ch) {
    const channelEpg = this.epgData[ch.epgId];
    const now = new Date();

    // 1. If real EPG data is available from lichphatsong.io.vn
    if (channelEpg && channelEpg.length > 0) {
      const windowStart = this.startTime.getTime();
      const windowEnd = windowStart + this.totalSlots * this.slotMinutes * 60 * 1000;

      const filtered = channelEpg.filter(p => {
        const pStart = p.startDate.getTime();
        const pEnd = p.stopDate.getTime();
        return pEnd > windowStart && pStart < windowEnd;
      });

      if (filtered.length > 0) {
        return filtered.map(p => {
          const durMinutes = (p.stopDate.getTime() - p.startDate.getTime()) / (60 * 1000);
          return {
            title: p.title,
            desc: p.desc || '',
            startDate: p.startDate,
            stopDate: p.stopDate,
            durationMinutes: Math.max(15, durMinutes),
            isCurrent: now >= p.startDate && now < p.stopDate
          };
        });
      }
    }

    // 2. Realistic Dynamic Schedule fallback so timeline is always populated
    return this.generateMockSchedule(ch);
  }

  generateMockSchedule(ch) {
    const programmes = [];
    const now = new Date();
    const cursor = new Date(this.startTime.getTime());
    const windowEnd = new Date(this.startTime.getTime() + this.totalSlots * this.slotMinutes * 60 * 1000);

    const isSport = (ch.group || '').toLowerCase().includes('thể thao');
    const isVtv1 = ch.name.toLowerCase().includes('vtv1');

    const sampleTitles = isSport 
      ? ['Trực tiếp Ngoại Hạng Anh', 'Bản tin Thể thao 24/7', 'Tổng hợp Champions League', 'Tạp chí Tennis', 'Bóng đá Thế giới']
      : isVtv1
      ? ['Thời sự 19h00 (Trực tiếp)', 'Dự báo Thời tiết', 'Báo chí toàn cảnh', 'Phim tài liệu', 'Việt Nam Hôm Nay']
      : ['Ai Là Triệu Phú', 'Phim truyện Giờ Vàng', 'Gặp nhau cuối tuần', 'Ca nhạc quốc tế', 'Chuyển động 24h'];

    let titleIdx = Math.abs(ch.id) % sampleTitles.length;

    while (cursor < windowEnd) {
      const duration = (titleIdx % 2 === 0) ? 45 : 30; // 45 or 30 minutes
      const pStart = new Date(cursor.getTime());
      const pEnd = new Date(cursor.getTime() + duration * 60 * 1000);

      programmes.push({
        title: sampleTitles[titleIdx % sampleTitles.length],
        desc: `${ch.name} phát sóng chất lượng Full HD`,
        startDate: pStart,
        stopDate: pEnd,
        durationMinutes: duration,
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
      // Check cached EPG in sessionStorage
      const cached = sessionStorage.getItem('tvplay_epg_cache');
      if (cached) {
        this.parseEpgXml(cached);
        this.render();
        return;
      }

      // Fetch live EPG XML
      const res = await fetch(this.epgUrl);
      if (!res.ok) return;
      const xmlText = await res.text();
      
      // Cache for session
      try {
        sessionStorage.setItem('tvplay_epg_cache', xmlText.substring(0, 1000000)); // cache first 1MB
      } catch (e) {}

      this.parseEpgXml(xmlText);
      this.render();
    } catch (err) {
      console.warn('[Timeline] EPG fetch background warning:', err);
    }
  }

  parseEpgXml(xmlText) {
    // Fast regex extraction for programme tags to keep main thread butter-smooth
    const progRegex = /<programme start="(\d{14}) \+0700" stop="(\d{14}) \+0700" channel="([^"]+)">\s*<title[^>]*>([^<]+)<\/title>(?:\s*<desc[^>]*>([^<]*)<\/desc>)?/g;
    let match;
    const epg = {};

    while ((match = progRegex.exec(xmlText)) !== null) {
      const startStr = match[1];
      const stopStr = match[2];
      const channelId = match[3];
      const title = match[4].trim();
      const desc = (match[5] || '').trim();

      const startDate = this.parseXmlDate(startStr);
      const stopDate = this.parseXmlDate(stopStr);

      if (!epg[channelId]) epg[channelId] = [];
      epg[channelId].push({ startDate, stopDate, title, desc });
    }

    this.epgData = epg;
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

