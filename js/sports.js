/**
 * TV Play Strand Edition — Live Sports & Fixtures Engine
 * Enhanced with interactive stream selector buttons for all match sources.
 */

class SportsManager {
  constructor(player) {
    this.player = player;
    this.sportsData = null;
    this.liveEvents = [];
    this.activeEventIdx = -1;
    this.activeSourceIdx = -1;
    this.defaultSportsUrl = 'https://fastly.jsdelivr.net/gh/ndkhoams/iptv@main/thethao-data.json';
    this.armbianHubUrl = localStorage.getItem('tvplay_hub_url') || 'http://10.0.0.222:8080';
    this.useArmbian = localStorage.getItem('tvplay_use_armbian') === 'true';
  }

  async loadSports() {
    const container = document.getElementById('sportsContainer');
    if (!container) return;

    this.renderSkeleton(container);

    try {
      let data = null;

      if (this.useArmbian) {
        try {
          const res = await fetch(`${this.armbianHubUrl}/api/sports/categories`, { signal: AbortSignal.timeout(3000) });
          if (res.ok) data = await res.json();
        } catch (hubErr) {
          console.warn('[Sports] Armbian Hub offline or blocked, falling back to CDN:', hubErr);
        }
      }

      if (!data) {
        const res = await fetch(this.defaultSportsUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      }

      this.sportsData = data;
      this.liveEvents = data.live_events || [];
      this.renderSports(container);

    } catch (err) {
      console.error('[Sports] Error loading sports data:', err);
      container.innerHTML = `
        <div class="p-6 text-center text-xs text-[var(--label-2)] col-span-2">
          Chưa có lịch phát trực tiếp hoặc không tải được dữ liệu thể thao.
        </div>
      `;
    }
  }

  renderSports(container) {
    if (!this.liveEvents || this.liveEvents.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-sm text-[var(--label-2)] col-span-2 glass-card rounded-2xl">
          Hiện tại không có trận đấu trực tiếp nào.
        </div>
      `;
      return;
    }

    let html = '';
    this.liveEvents.forEach((evt, idx) => {
      const isLive = evt.isOngoing !== false;
      const league = evt.leagueName || evt.league || 'BÓNG ĐÁ TRỰC TIẾP';
      const home = evt.homeTeam || 'Đội nhà';
      const away = evt.awayTeam || 'Đội khách';
      const time = evt.time || 'Trực tiếp';
      const date = evt.date || '';

      const homeInitial = home.substring(0, 3).toUpperCase();
      const awayInitial = away.substring(0, 3).toUpperCase();

      const sources = evt.sources || [];
      const isEventActive = this.activeEventIdx === idx;

      html += `
        <div class="glass-card rounded-2xl p-4 space-y-3.5 border ${isEventActive ? 'border-[var(--accent)]' : 'border-white/10'} hover:border-white/25 transition-all duration-200 relative overflow-hidden group">
          
          <!-- Top Row: League & Status Badge -->
          <div class="flex items-center justify-between text-xs text-[var(--label-2)]">
            <span class="font-bold text-[var(--blue)] truncate max-w-[200px] flex items-center gap-1.5">
              <span class="text-sm">⚽</span>
              <span>${league}</span>
            </span>
            <span class="px-2 py-0.5 rounded-full ${isLive ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/10 text-white/70'} font-bold text-[10px] flex items-center gap-1 shrink-0">
              ${isLive ? '<span class="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span> LIVE' : `${time} ${date}`}
            </span>
          </div>

          <!-- Middle Row: Teams VS -->
          <div class="flex items-center justify-between py-1">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center font-bold text-xs text-white shrink-0 shadow-inner">
                ${homeInitial}
              </div>
              <span class="text-sm font-bold text-white truncate max-w-[130px]">${home}</span>
            </div>

            <span class="text-xs font-mono text-[var(--label-3)] px-2 font-bold shrink-0">VS</span>

            <div class="flex items-center gap-2.5 flex-row-reverse min-w-0">
              <div class="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center font-bold text-xs text-white shrink-0 shadow-inner">
                ${awayInitial}
              </div>
              <span class="text-sm font-bold text-white truncate max-w-[130px] text-right">${away}</span>
            </div>
          </div>

          <!-- Bottom Row: Interactive Stream Selector Buttons -->
          <div class="pt-2 border-t border-[var(--separator)] space-y-2">
            <div class="flex items-center justify-between text-[11px] text-[var(--label-3)]">
              <span class="font-medium text-white/70">Chọn luồng xem trực tiếp:</span>
              <span>${sources.length} nguồn phát</span>
            </div>

            <!-- Buttons Grid for each stream -->
            <div class="flex items-center gap-2 flex-wrap">
              ${sources.map((src, sIdx) => {
                const isSelected = isEventActive && this.activeSourceIdx === sIdx;
                const label = this.formatStreamButtonLabel(src.name, sIdx);

                return `
                  <button onclick="window.sportsManager.playSpecificStream(${idx}, ${sIdx}, event)" 
                          class="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 active:scale-95 ${
                            isSelected 
                              ? 'bg-gradient-to-r from-[#ff6500] to-[#ff9f0a] text-white shadow-lg shadow-orange-500/30 border border-white/30' 
                              : 'glass-pill text-white/90 hover:bg-white/20 hover:text-white border border-white/10'
                          }">
                    <span class="w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white animate-ping' : 'bg-emerald-400'}"></span>
                    <span>${label}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

        </div>
      `;
    });

    container.innerHTML = html;

    const countBadge = document.getElementById('sportsCountBadge');
    if (countBadge) countBadge.textContent = `${this.liveEvents.length} trận đấu`;
  }

  formatStreamButtonLabel(rawName, index) {
    if (!rawName) return `Luồng ${index + 1}`;

    // Extract commentator name e.g. (BLV Anh Quân) or (LÝ LÊN LỬA) or (HD2)
    const parenMatches = rawName.match(/\(([^)]+)\)/g);
    if (parenMatches && parenMatches.length > 0) {
      // Get the last or second parenthesized segment
      const cleanCommentator = parenMatches[parenMatches.length - 1].replace(/[()]/g, '').trim();
      return `Luồng ${index + 1}: ${cleanCommentator}`;
    }

    return `Luồng ${index + 1}`;
  }

  playSpecificStream(eventIdx, sourceIdx, event) {
    if (event) event.stopPropagation();

    const evt = this.liveEvents[eventIdx];
    if (!evt) return;

    const sources = evt.sources || [];
    const stream = sources[sourceIdx];
    if (!stream || !stream.url) {
      alert('Luồng phát này tạm thời không khả dụng.');
      return;
    }

    this.activeEventIdx = eventIdx;
    this.activeSourceIdx = sourceIdx;

    const streamLabel = this.formatStreamButtonLabel(stream.name, sourceIdx);

    // Play in player
    if (this.player) {
      this.player.playStream(stream.url, {
        name: evt.leagueName || 'Thể Thao Trực Tiếp',
        title: `${evt.homeTeam} vs ${evt.awayTeam}`,
        subtitle: `${streamLabel} • ${stream.name || 'Bình luận tiếng Việt'}`,
        group: 'Thể Thao'
      });

      // Update button visual states
      const container = document.getElementById('sportsContainer');
      if (container) this.renderSports(container);

      // Scroll smoothly to top player
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  renderSkeleton(container) {
    let html = '';
    for (let i = 0; i < 2; i++) {
      html += `
        <div class="glass-card rounded-2xl p-4 space-y-3">
          <div class="w-24 h-4 rounded skeleton"></div>
          <div class="flex justify-between items-center py-2">
            <div class="w-28 h-5 rounded skeleton"></div>
            <div class="w-8 h-4 rounded skeleton"></div>
            <div class="w-28 h-5 rounded skeleton"></div>
          </div>
          <div class="w-full h-8 rounded-xl skeleton"></div>
        </div>
      `;
    }
    container.innerHTML = html;
  }
}

window.SportsManager = SportsManager;
