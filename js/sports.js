/**
 * TV Play Strand Edition — Live Sports & Fixtures Engine
 */

class SportsManager {
  constructor(player) {
    this.player = player;
    this.sportsData = null;
    this.liveEvents = [];
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
      const primarySource = sources[0] || {};
      const streamUrl = primarySource.url || '';
      const blvName = primarySource.name || 'Bình luận Tiếng Việt';

      html += `
        <div onclick="window.sportsManager.playMatch(${idx})" 
             class="glass-card rounded-2xl p-4 space-y-3 hover:border-white/25 transition-all duration-200 cursor-pointer relative overflow-hidden group">
          <div class="flex items-center justify-between text-xs text-[var(--label-2)]">
            <span class="font-bold text-[var(--blue)] truncate max-w-[200px]">${league}</span>
            <span class="px-2 py-0.5 rounded-full ${isLive ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/70'} font-bold text-[10px] flex items-center gap-1 shrink-0">
              ${isLive ? '<span class="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span> LIVE' : `${time} ${date}`}
            </span>
          </div>

          <div class="flex items-center justify-between py-1">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold text-xs text-white shrink-0">
                ${homeInitial}
              </div>
              <span class="text-sm font-bold text-white truncate max-w-[130px]">${home}</span>
            </div>

            <span class="text-xs font-mono text-[var(--label-3)] px-2 font-bold shrink-0">VS</span>

            <div class="flex items-center gap-2.5 flex-row-reverse min-w-0">
              <div class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold text-xs text-white shrink-0">
                ${awayInitial}
              </div>
              <span class="text-sm font-bold text-white truncate max-w-[130px] text-right">${away}</span>
            </div>
          </div>

          <div class="flex items-center justify-between text-[11px] text-[var(--label-3)] pt-2 border-t border-[var(--separator)]">
            <span class="flex items-center gap-1 truncate max-w-[180px]">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
              ${sources.length > 0 ? `${sources.length} luồng phát` : 'Sẵn sàng'}
            </span>
            <span class="text-white/80 font-medium truncate max-w-[170px] text-right">
              ${blvName}
            </span>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    const countBadge = document.getElementById('sportsCountBadge');
    if (countBadge) countBadge.textContent = `${this.liveEvents.length} trận đấu`;
  }

  playMatch(index) {
    const evt = this.liveEvents[index];
    if (!evt) return;

    const sources = evt.sources || [];
    if (sources.length === 0) {
      alert('Trận đấu này chưa có luồng phát trực tiếp.');
      return;
    }

    // Play primary source
    const stream = sources[0];
    if (this.player && stream.url) {
      this.player.playStream(stream.url, {
        name: evt.leagueName || 'Thể Thao Trực Tiếp',
        title: `${evt.homeTeam} vs ${evt.awayTeam}`,
        subtitle: `${stream.name || 'Bình luận tiếng Việt'} • Chất lượng Full HD`,
        group: 'Thể Thao'
      });

      // Scroll smoothly to player
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
          <div class="w-full h-3 rounded skeleton"></div>
        </div>
      `;
    }
    container.innerHTML = html;
  }
}

window.SportsManager = SportsManager;
