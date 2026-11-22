/**
 * TV Play — Live Sports & Fixtures Engine
 * Features:
 * - Real club and national team logos displayed at both ends of each match card
 * - Automatic fallback to 3-letter initials badge if logo is unavailable
 * - Instant logo resolution via Standings, Country Flags, Pre-mapped Clubs, and ESPN database
 * - Matches are compact by default; tapping a match expands its stream channels list.
 */

const VN_TO_ENG_TEAMS = {
  "phap": "France", "tho nhi ky": "Turkey", "sip": "Cyprus", "tay ban nha": "Spain",
  "y": "Italy", "duc": "Germany", "anh": "England", "bo dao nha": "Portugal",
  "ha lan": "Netherlands", "bi": "Belgium", "thuy si": "Switzerland", "dan mach": "Denmark",
  "na uy": "Norway", "thuy dien": "Sweden", "ba lan": "Poland", "sec": "Czech Republic",
  "cong hoa sec": "Czech Republic", "ao": "Austria", "hy lap": "Greece", "my": "USA",
  "uc": "Australia", "nhat ban": "Japan", "nhat": "Japan", "han quoc": "South Korea",
  "han": "South Korea", "trung quoc": "China", "trung": "China", "trieu tien": "North Korea",
  "thai lan": "Thailand", "viet nam": "Vietnam", "vietnam": "Vietnam", "lao": "Laos",
  "campuchia": "Cambodia", "bo bien nga": "Ivory Coast", "nam phi": "South Africa",
  "a rap xe ut": "Saudi Arabia", "a rap saudi": "Saudi Arabia", "xu wales": "Wales",
  "wales": "Wales", "bac ireland": "Northern Ireland", "cong hoa ireland": "Ireland",
  "ireland": "Ireland", "nga": "Russia", "phan lan": "Finland", "dai loan": "Chinese Taipei",
  "dai bac": "Chinese Taipei", "an do": "India", "maroc": "Morocco", "ai cap": "Egypt",
  "mon-te-ne-gro": "Montenegro", "montenegro": "Montenegro", "armenia": "Armenia",
  "latvia": "Latvia", "finland": "Finland", "belarus": "Belarus", "albania": "Albania",
  "san marino": "San Marino", "kazakhstan": "Kazakhstan", "slovakia": "Slovakia",
  "hungary": "Hungary", "serbia": "Serbia", "georgia": "Georgia", "croatia": "Croatia",
  "scotland": "Scotland", "romania": "Romania", "slovenia": "Slovenia", "iceland": "Iceland",
  "luxembourg": "Luxembourg", "estonia": "Estonia", "bulgaria": "Bulgaria",
  "lithuania": "Lithuania", "liechtenstein": "Liechtenstein", "gibraltar": "Gibraltar",
  "malta": "Malta", "faroe islands": "Faroe Islands", "faroe": "Faroe Islands",
  "moldova": "Moldova", "north macedonia": "North Macedonia", "macedonia": "North Macedonia",
  "venezuela": "Venezuela", "turkiye": "Turkey"
};

// Safe fetch helper with timeout fallback across all browser engines
function fetchWithSafeTimeout(url, options = {}, timeoutMs = 4500) {
  let controller = null;
  let timer = null;
  if (typeof AbortController !== 'undefined' && timeoutMs > 0) {
    controller = new AbortController();
    timer = setTimeout(() => {
      try { controller.abort(); } catch (e) {}
    }, timeoutMs);
  }
  const fetchOpts = { ...options };
  if (controller) fetchOpts.signal = controller.signal;
  return fetch(url, fetchOpts).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

class SportsManager {
  constructor(player) {
    this.player = player;
    this.sportsData = null;
    this.liveEvents = [];
    this.expandedEventIdx = -1;
    this.activeEventIdx = -1;
    this.activeSourceIdx = -1;
    this.rawGithubUrl = 'https://raw.githubusercontent.com/ndkhoams/iptv/main/thethao-data.json';
    this.defaultSportsUrl = 'https://fastly.jsdelivr.net/gh/ndkhoams/iptv@main/thethao-data.json';
    this.armbianHubUrl = localStorage.getItem('tvplay_hub_url') || 'http://10.0.0.222:8080';
    this.useArmbian = localStorage.getItem('tvplay_use_armbian') === 'true';

    // Logo Resolution Caches & Registries
    this.teamLogosCache = {};
    this.standingsLogoMap = {};
    this.fetchingLogos = new Set();

    this.initCountryFlags();
    this.initPremappedClubs();
  }

  normalizeName(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  toEnglishTeam(name) {
    if (!name) return '';
    const clean = name.replace(/^(?:đội tuyển quốc gia|đội tuyển|đtqg|đt|tuyển|clb|fc)\s+/i, '').trim();
    const unacc = clean
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (VN_TO_ENG_TEAMS[unacc]) return VN_TO_ENG_TEAMS[unacc];
    for (const k in VN_TO_ENG_TEAMS) {
      if (unacc === k || (' ' + unacc + ' ').includes(' ' + k + ' ')) {
        return VN_TO_ENG_TEAMS[k];
      }
    }
    return unacc.split(' ').map(w => {
      if (/^\d+[a-zA-Z]+$/.test(w)) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }


  initCountryFlags() {
    const FLAGS = {
      vn: ['vietnam', 'viet nam'],
      tw: ['chinese taipei', 'dai loan', 'taiwan'],
      be: ['belgium', 'bi', 'belgium indoor soccer'],
      si: ['slovenia', 'slovenia indoor soccer'],
      in: ['india', 'an do'],
      mv: ['maldives'],
      bd: ['bangladesh'],
      lk: ['sri lanka'],
      gh: ['ghana'],
      so: ['somalia'],
      uz: ['uzbekistan'],
      ru: ['russia', 'nga'],
      al: ['albania'],
      fi: ['finland', 'phan lan'],
      kw: ['kuwait'],
      sy: ['syria'],
      th: ['thailand', 'thai lan'],
      id: ['indonesia'],
      my: ['malaysia'],
      sg: ['singapore'],
      ph: ['philippines'],
      la: ['laos', 'lao'],
      kh: ['cambodia', 'campuchia'],
      mm: ['myanmar'],
      cn: ['china', 'trung quoc'],
      jp: ['japan', 'nhat ban'],
      kr: ['korea', 'south korea', 'han quoc'],
      kp: ['north korea', 'trieu tien'],
      gb: ['england', 'anh'],
      fr: ['france', 'phap'],
      de: ['germany', 'duc'],
      es: ['spain', 'tay ban nha'],
      it: ['italy', 'y'],
      pt: ['portugal', 'bo dao nha'],
      nl: ['netherlands', 'ha lan'],
      ar: ['argentina'],
      br: ['brazil'],
      co: ['colombia'],
      uy: ['uruguay'],
      sx: ['sint maarten'],
      ai: ['anguilla'],
      au: ['australia', 'uc'],
      hr: ['croatia'],
      ch: ['switzerland', 'thuy si'],
      se: ['sweden', 'thuy dien'],
      dk: ['denmark', 'dan mach'],
      no: ['norway', 'na uy'],
      pl: ['poland', 'ba lan'],
      tr: ['turkey', 'tho nhi ky'],
      ro: ['romania'],
      gr: ['greece', 'hy lap'],
      at: ['austria', 'ao'],
      cz: ['czech republic', 'sec'],
      sk: ['slovakia'],
      hu: ['hungary'],
      bg: ['bulgaria'],
      rs: ['serbia'],
      ua: ['ukraine'],
      ma: ['morocco', 'maroc'],
      sn: ['senegal'],
      ng: ['nigeria'],
      eg: ['egypt', 'ai cap'],
      cm: ['cameroon'],
      za: ['south africa', 'nam phi'],
      sa: ['saudi arabia', 'a rap xe ut'],
      qa: ['qatar'],
      ae: ['uae', 'cac tieu vuong quoc'],
      iq: ['iraq'],
      ir: ['iran'],
      us: ['usa', 'united states', 'my']
    };

    this.countryFlagsMap = {};
    for (const [code, aliases] of Object.entries(FLAGS)) {
      const url = `https://flagcdn.com/w80/${code}.png`;
      aliases.forEach(a => {
        this.countryFlagsMap[this.normalizeName(a)] = url;
      });
    }
  }

  initPremappedClubs() {
    this.premappedClubs = {
      // English Football
      leicester: 'https://a.espncdn.com/i/teamlogos/soccer/500/375.png',
      leicestercity: 'https://a.espncdn.com/i/teamlogos/soccer/500/375.png',
      walsall: 'https://a.espncdn.com/i/teamlogos/soccer/500/401.png',
      crewe: 'https://a.espncdn.com/i/teamlogos/soccer/500/396.png',
      crewealexandra: 'https://a.espncdn.com/i/teamlogos/soccer/500/396.png',
      wigan: 'https://a.espncdn.com/i/teamlogos/soccer/500/350.png',
      wiganathletic: 'https://a.espncdn.com/i/teamlogos/soccer/500/350.png',
      mansfield: 'https://a.espncdn.com/i/teamlogos/soccer/500/354.png',
      mansfieldtown: 'https://a.espncdn.com/i/teamlogos/soccer/500/354.png',
      chesterfield: 'https://a.espncdn.com/i/teamlogos/soccer/500/358.png',
      burtonalbion: 'https://a.espncdn.com/i/teamlogos/soccer/500/446.png',
      nottscounty: 'https://a.espncdn.com/i/teamlogos/soccer/500/349.png',
      bristolrovers: 'https://a.espncdn.com/i/teamlogos/soccer/500/342.png',
      reading: 'https://a.espncdn.com/i/teamlogos/soccer/500/338.png',
      northampton: 'https://a.espncdn.com/i/teamlogos/soccer/500/355.png',
      northamptontown: 'https://a.espncdn.com/i/teamlogos/soccer/500/355.png',
      gillingham: 'https://a.espncdn.com/i/teamlogos/soccer/500/397.png',
      leedsunited: 'https://a.espncdn.com/i/teamlogos/soccer/500/357.png',
      southampton: 'https://a.espncdn.com/i/teamlogos/soccer/500/376.png',
      sunderland: 'https://a.espncdn.com/i/teamlogos/soccer/500/366.png',
      norwich: 'https://a.espncdn.com/i/teamlogos/soccer/500/381.png',
      westbrom: 'https://a.espncdn.com/i/teamlogos/soccer/500/383.png',
      middlesbrough: 'https://a.espncdn.com/i/teamlogos/soccer/500/368.png',
      sheffieldunited: 'https://a.espncdn.com/i/teamlogos/soccer/500/398.png',
      sheffieldwednesday: 'https://a.espncdn.com/i/teamlogos/soccer/500/380.png',
      watford: 'https://a.espncdn.com/i/teamlogos/soccer/500/395.png',
      burnley: 'https://a.espncdn.com/i/teamlogos/soccer/500/379.png',
      stoke: 'https://a.espncdn.com/i/teamlogos/soccer/500/336.png',
      swansea: 'https://a.espncdn.com/i/teamlogos/soccer/500/318.png',
      cardiff: 'https://a.espncdn.com/i/teamlogos/soccer/500/347.png',
      blackburn: 'https://a.espncdn.com/i/teamlogos/soccer/500/365.png',
      qpr: 'https://a.espncdn.com/i/teamlogos/soccer/500/334.png',
      derby: 'https://a.espncdn.com/i/teamlogos/soccer/500/364.png',
      preston: 'https://a.espncdn.com/i/teamlogos/soccer/500/390.png',
      millwall: 'https://a.espncdn.com/i/teamlogos/soccer/500/385.png',
      coventry: 'https://a.espncdn.com/i/teamlogos/soccer/500/377.png',
      hull: 'https://a.espncdn.com/i/teamlogos/soccer/500/306.png',
      luton: 'https://a.espncdn.com/i/teamlogos/soccer/500/356.png',
      plymouth: 'https://a.espncdn.com/i/teamlogos/soccer/500/345.png',
      portsmouth: 'https://a.espncdn.com/i/teamlogos/soccer/500/384.png',
      oxford: 'https://a.espncdn.com/i/teamlogos/soccer/500/328.png',

      // Spanish Football
      valencia: 'https://a.espncdn.com/i/teamlogos/soccer/500/94.png',
      alaves: 'https://a.espncdn.com/i/teamlogos/soccer/500/96.png',
      deportivoalaves: 'https://a.espncdn.com/i/teamlogos/soccer/500/96.png',
      anaitasuna: 'https://imgts.sportpulseapiz.com/football/team/vjxm8ghj4e3r6od/image/small',
      uetavernes: 'https://cdn.imgts.com/uploads/images/1784649818862-gr6fqgbhsx8.png',

      // Romanian Football
      metalulbuzau: 'https://img.cltvap.cc/football/team/f5564d465c79e1d82f69a3cd887c50b8.png!w80',
      steauabucuresti: 'https://a.espncdn.com/i/teamlogos/soccer/500/484.png',
      fcsb: 'https://a.espncdn.com/i/teamlogos/soccer/500/484.png',

      // Japanese J-League
      visselkobe: 'https://a.espncdn.com/i/teamlogos/soccer/500/7477.png',
      machidazelvia: 'https://a.espncdn.com/i/teamlogos/soccer/500/18165.png',
      kawasakifrontale: 'https://a.espncdn.com/i/teamlogos/soccer/500/7464.png',
      kashiwareysol: 'https://a.espncdn.com/i/teamlogos/soccer/500/7463.png',
      yokohamafmarinos: 'https://a.espncdn.com/i/teamlogos/soccer/500/7480.png',
      yokohamamarinos: 'https://a.espncdn.com/i/teamlogos/soccer/500/7480.png',
      kashimaantlers: 'https://a.espncdn.com/i/teamlogos/soccer/500/7462.png',
      urawa: 'https://a.espncdn.com/i/teamlogos/soccer/500/7476.png',
      urawareds: 'https://a.espncdn.com/i/teamlogos/soccer/500/7476.png',
      cerezoosaka: 'https://a.espncdn.com/i/teamlogos/soccer/500/7458.png',

      // South American Football
      americadecali: 'https://a.espncdn.com/i/teamlogos/soccer/500/5283.png',
      atleticonacional: 'https://a.espncdn.com/i/teamlogos/soccer/500/5280.png',
      oncecaldas: 'https://a.espncdn.com/i/teamlogos/soccer/500/5296.png',
      interbogota: 'https://media.chuoichientv.net/media/20260611_225909_8715fbcf.jpg',

      // American College Football / NCAA
      akron: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2006.png',
      westernmichigan: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2711.png',
      bowlinggreen: 'https://a.espncdn.com/i/teamlogos/ncaa/500/189.png',
      kentstate: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2309.png',

      // NBA
      philadelphia76ers: 'https://a.espncdn.com/i/teamlogos/nba/500/phi.png',
      bostonceltics: 'https://a.espncdn.com/i/teamlogos/nba/500/bos.png',
      losangeleslakers: 'https://a.espncdn.com/i/teamlogos/nba/500/lal.png',
      goldenstatewarriors: 'https://a.espncdn.com/i/teamlogos/nba/500/gs.png'
    };
  }

  buildStandingsMap() {
    if (!this.sportsData || !this.sportsData.standings) return;
    const standings = this.sportsData.standings;

    for (const [leagueKey, teams] of Object.entries(standings)) {
      if (!Array.isArray(teams)) continue;
      teams.forEach(t => {
        const logo = t.logoUrl;
        if (!logo) return;

        const nameNorm = this.normalizeName(t.teamName);
        const shortNorm = this.normalizeName(t.shortName);

        if (nameNorm) this.standingsLogoMap[nameNorm] = logo;
        if (shortNorm) this.standingsLogoMap[shortNorm] = logo;

        // Strip common prefixes/suffixes for looser matching
        const simplified = nameNorm
          .replace(/(fc|cf|club|the|city|town|united|athletic|hotspur)$/g, '')
          .replace(/^(fc|cf|club|the)/g, '')
          .trim();
        if (simplified && simplified.length >= 4) {
          this.standingsLogoMap[simplified] = logo;
        }
      });
    }
  }

  getTeamLogo(teamName, evt, side, idx) {
    if (!teamName) return '';
    const norm = this.normalizeName(teamName);
    const cNorm = this.normalizeName(side === 'home' ? evt.c_home : evt.c_away);

    // 1. Check direct event logo properties
    if (side === 'home' && evt.homeLogo) return evt.homeLogo;
    if (side === 'away' && evt.awayLogo) return evt.awayLogo;

    // 2. Check source item logos if source contains team logo
    if (side === 'home' && evt.sources && evt.sources.length > 0) {
      const srcLogo = evt.sources[0]?.logo;
      if (srcLogo && (srcLogo.includes('/team/') || srcLogo.includes('/teams/') || srcLogo.includes('badges/') || srcLogo.includes('teamlogos'))) {
        return srcLogo;
      }
    }

    // 3. Check memory cache
    if (this.teamLogosCache[norm]) return this.teamLogosCache[norm];
    if (cNorm && this.teamLogosCache[cNorm]) return this.teamLogosCache[cNorm];

    // 4. Check Standings Map (EPL, LaLiga, Serie A, Bundesliga, Ligue 1, UCL, NBA, V-League)
    if (this.standingsLogoMap[norm]) return this.standingsLogoMap[norm];
    if (cNorm && this.standingsLogoMap[cNorm]) return this.standingsLogoMap[cNorm];

    // 5. Check Country Flags
    if (this.countryFlagsMap[norm]) return this.countryFlagsMap[norm];
    if (cNorm && this.countryFlagsMap[cNorm]) return this.countryFlagsMap[cNorm];

    // 6. Check Pre-mapped Clubs
    if (this.premappedClubs[norm]) return this.premappedClubs[norm];
    if (cNorm && this.premappedClubs[cNorm]) return this.premappedClubs[cNorm];

    // 7. Check LocalStorage Cache
    try {
      const localLogo = localStorage.getItem('tvplay_logo_' + norm);
      if (localLogo) {
        this.teamLogosCache[norm] = localLogo;
        return localLogo;
      }
    } catch (e) {}

    // 8. Trigger background asynchronous search from ESPN Global Database
    if (idx !== undefined && side) {
      this.asyncFetchTeamLogo(teamName, norm, idx, side);
    }

    return '';
  }

  async asyncFetchTeamLogo(rawName, normKey, idx, side) {
    if (this.fetchingLogos.has(normKey)) return;
    this.fetchingLogos.add(normKey);

    const cleanQuery = rawName
      .replace(/indoor soccer/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    try {
      const url = `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(cleanQuery)}&type=team`;
      const res = await fetchWithSafeTimeout(url, {}, 3500);
      if (!res || !res.ok) return;
      const data = await res.json();
      const results = data.results || [];
      if (results.length > 0 && results[0].contents && results[0].contents.length > 0) {
        const item = results[0].contents[0];
        const logoUrl = item.image?.default || item.image?.defaultDark || '';
        if (logoUrl) {
          this.teamLogosCache[normKey] = logoUrl;
          try {
            localStorage.setItem('tvplay_logo_' + normKey, logoUrl);
          } catch (e) {}

          // Dynamically replace fallback initials with the newly discovered logo
          const imgEl = document.getElementById(`team-logo-${idx}-${side}`);
          const fbEl = document.getElementById(`team-fb-${idx}-${side}`);
          if (imgEl) {
            imgEl.src = logoUrl;
            imgEl.classList.remove('hidden');
            if (fbEl) fbEl.classList.add('hidden');
          }
        }
      }
    } catch (e) {
      // Graceful timeout
    } finally {
      this.fetchingLogos.delete(normKey);
    }
  }

  async refreshSports() {
    const btn = document.getElementById('btnRefreshSports');
    const icon = document.getElementById('refreshIcon');
    const text = document.getElementById('refreshBtnText');

    if (icon) icon.classList.add('animate-spin');
    if (text) text.textContent = 'Đang tải...';
    if (btn) btn.disabled = true;

    try {
      // Xóa cache cũ để buộc tải mới hoàn toàn từ server
      try { localStorage.removeItem('tvplay_sports_cache'); } catch (e) {}
      this.sportsData = null;
      await this.loadSports(true);
      if (text) text.textContent = 'Đã cập nhật';
      setTimeout(() => {
        if (text) text.textContent = 'Tải lại';
      }, 1500);
    } catch (e) {
      if (text) text.textContent = 'Lỗi';
      setTimeout(() => {
        if (text) text.textContent = 'Tải lại';
      }, 2000);
    } finally {
      if (icon) icon.classList.remove('animate-spin');
      if (btn) btn.disabled = false;
    }
  }

  async loadSports(forceFresh = false) {
    const container = document.getElementById('sportsContainer');
    if (!container) return;

    // 0. Nạp tức thì từ cache LocalStorage nếu có (Instant UI, không bao giờ để trắng màn hình)
    if (!forceFresh && !this.sportsData) {
      try {
        const cached = localStorage.getItem('tvplay_sports_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && (parsed.live_events || Array.isArray(parsed))) {
            this.sportsData = parsed;
            const deduplicated = this.deduplicateEvents(parsed.live_events || []);
            this.liveEvents = this.sortLiveEvents(deduplicated);
            this.buildStandingsMap();
            this.renderSports(container);
            const countBadge = document.getElementById('sportsCountBadge');
            if (countBadge) {
              countBadge.textContent = `${this.liveEvents.length} trận đấu`;
            }
          }
        }
      } catch (cErr) {
        console.warn('[Sports] Cache error:', cErr);
      }
    }

    if (forceFresh || (!this.sportsData && (!this.liveEvents || this.liveEvents.length === 0))) {
      this.renderSkeleton(container);
    }

    const cacheBuster = `?t=${Date.now()}`;

    try {
      let data = null;
      let lastErr = null;

      // Danh sách các máy chủ mirror CDN dự phòng (chống nhà mạng VN chặn GitHub / CDN)
      const mirrorUrls = [
        // 1. Same-origin local path (trực tiếp trên ndkhoams.github.io, không CORS, không chặn ISP)
        `./thethao-data.json${cacheBuster}`,
        // 2. jsDelivr Cloudflare CDN (Global Edge, cực nhanh tại VN)
        `https://cdn.jsdelivr.net/gh/ndkhoams/iptv@main/thethao-data.json${cacheBuster}`,
        // 3. jsDelivr GCore CDN
        `https://gcore.jsdelivr.net/gh/ndkhoams/iptv@main/thethao-data.json${cacheBuster}`,
        // 4. Raw GitHub repo iptv
        `https://raw.githubusercontent.com/ndkhoams/iptv/main/thethao-data.json${cacheBuster}`,
        // 5. jsDelivr TestingCF CDN
        `https://testingcf.jsdelivr.net/gh/ndkhoams/iptv@main/thethao-data.json${cacheBuster}`,
        // 6. Armbian LAN Hub (nếu bật tùy chọn và đang trong mạng nội bộ)
        ...(this.useArmbian ? [`${this.armbianHubUrl}/data/thethao-data.json${cacheBuster}`] : [])
      ];

      for (const url of mirrorUrls) {
        try {
          const res = await fetchWithSafeTimeout(url, { cache: 'no-store' }, 4500);
          if (res && res.ok) {
            const text = await res.text();
            if (text && text.trim().startsWith('{')) {
              const parsed = JSON.parse(text);
              if (parsed && (parsed.live_events || parsed.fixtures)) {
                data = parsed;
                break;
              }
            }
          }
        } catch (mErr) {
          lastErr = mErr;
        }
      }

      if (data) {
        this.sportsData = data;
        try {
          localStorage.setItem('tvplay_sports_cache', JSON.stringify(data));
        } catch (e) {}

        const deduplicated = this.deduplicateEvents(data.live_events || []);
        this.liveEvents = this.sortLiveEvents(deduplicated);
        this.buildStandingsMap();
        this.renderSports(container);

        // Cập nhật số lượng trận đấu lên badge
        const countBadge = document.getElementById('sportsCountBadge');
        if (countBadge) {
          countBadge.textContent = `${this.liveEvents.length} trận đấu`;
        }
      } else {
        // Nếu không tải được qua mạng nhưng đã hiển thị từ cache, giữ nguyên giao diện
        if (this.liveEvents && this.liveEvents.length > 0) {
          console.warn('[Sports] Network fetch failed on all mirrors, keeping cached events:', lastErr);
        } else {
          throw (lastErr || new Error('Không thể kết nối đến máy chủ thể thao'));
        }
      }

    } catch (err) {
      console.error('[Sports] Error loading sports data:', err);
      // Chỉ hiện thông báo lỗi nếu không có dữ liệu nào (kể cả cache)
      if (!this.liveEvents || this.liveEvents.length === 0) {
        container.innerHTML = `
          <div class="p-6 text-center text-xs text-[var(--label-2)] col-span-full space-y-3">
            <div>Không tải được dữ liệu thể thao từ các máy chủ dự phòng.</div>
            <div>
              <button onclick="window.sportsManager.refreshSports()" class="px-4 py-1.5 text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg hover:bg-amber-500/30 transition-all cursor-pointer">
                Tải lại
              </button>
            </div>
          </div>
        `;
      }
    }
  }

  deduplicateEvents(events) {
    if (!Array.isArray(events) || events.length === 0) return [];

    // Lọc bỏ các card không phải trận đấu (ví dụ TV360+ 1 vs TV360 hoặc kênh truyền hình)
    events = events.filter(ev => {
      const h = (ev.homeTeam || '').toLowerCase().trim();
      const a = (ev.awayTeam || '').toLowerCase().trim();
      if (!h || !a) return false;
      const hClean = h.replace(/[^a-z0-9]/g, '');
      const aClean = a.replace(/[^a-z0-9]/g, '');
      if (hClean === aClean) return false;
      if (hClean.includes('tv360') && aClean.includes('tv360')) return false;
      if (['tv360', 'film4k', 'antsports', 'gavang', 'xoiche'].includes(aClean)) return false;
      return true;
    });

    const ALIAS_MAP = {
      'vietnam': 'vietnam', 'viet nam': 'vietnam', 'vn': 'vietnam',
      'chinese taipei': 'taiwan', 'dai loan': 'taiwan', 'taiwan': 'taiwan', 'dai bac trung hoa': 'taiwan', 'dai bac': 'taiwan',
      'india': 'india', 'an do': 'india', 'ando': 'india',
      'maldives': 'maldives',
      'thailand': 'thailand', 'thai lan': 'thailand',
      'indonesia': 'indonesia', 'indo': 'indonesia',
      'malaysia': 'malaysia', 'malay': 'malaysia',
      'singapore': 'singapore', 'sing': 'singapore',
      'philippines': 'philippines', 'philip': 'philippines',
      'myanmar': 'myanmar', 'mien dien': 'myanmar',
      'cambodia': 'cambodia', 'campuchia': 'cambodia',
      'laos': 'laos', 'lao': 'laos',
      'japan': 'japan', 'nhat ban': 'japan', 'nhat': 'japan',
      'korea': 'korea', 'south korea': 'korea', 'han quoc': 'korea', 'han': 'korea',
      'north korea': 'northkorea', 'trieu tien': 'northkorea', 'bac trieu tien': 'northkorea',
      'china': 'china', 'trung quoc': 'china', 'trung': 'china',
      'australia': 'australia', 'uc': 'australia',
      'saudi arabia': 'saudiarabia', 'saudi': 'saudiarabia', 'a rap xe ut': 'saudiarabia', 'a rap saudi': 'saudiarabia',
      'qatar': 'qatar',
      'uae': 'uae', 'cac tieu vuong quoc a rap thong nhat': 'uae',
      'iran': 'iran', 'iraq': 'iraq', 'uzbekistan': 'uzbekistan',
      'russia': 'russia', 'nga': 'russia',
      'belgium': 'belgium', 'bi': 'belgium', 'belgium indoor soccer': 'belgium',
      'slovenia': 'slovenia', 'slovenia indoor soccer': 'slovenia',
      'england': 'england', 'anh': 'england',
      'france': 'france', 'phap': 'france',
      'germany': 'germany', 'duc': 'germany',
      'spain': 'spain', 'tay ban nha': 'spain',
      'italy': 'italy', 'italia': 'italy', 'y': 'italy',
      'portugal': 'portugal', 'bo dao nha': 'portugal',
      'netherlands': 'netherlands', 'ha lan': 'netherlands',
      'usa': 'usa', 'united states': 'usa', 'my': 'usa', 'hoa ky': 'usa'
    };

    const getCanonical = (name) => {
      if (!name) return '';
      let norm = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .replace(/\b(doi tuyen quoc gia|doi tuyen|dtqg|dt|tuyen qg|tuyen|national team|clb|fc|cf|sc|ac|as|rc|ca|indoor soccer|indoor football)\b/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (ALIAS_MAP[norm]) return ALIAS_MAP[norm];
      for (const [alias, canon] of Object.entries(ALIAS_MAP)) {
        if (norm === alias || (alias.length >= 4 && norm.includes(alias))) {
          return canon;
        }
      }
      return norm.replace(/\s+/g, '');
    };

    const hasVietnamese = (str) => /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/.test(str || '');
    const cleanDisplay = (str) => (str || '').replace(/^(?:đội tuyển quốc gia|đội tuyển|đtqg|đt|tuyển)\s+/i, '').trim();

    const merged = [];
    for (const evt of events) {
      const cHome = getCanonical(evt.homeTeam || evt.c_home);
      const cAway = getCanonical(evt.awayTeam || evt.c_away);
      const evtDate = evt.date || '';
      const evtTime = evt.time || '';
      const evtTs = evt.timestamp || 0;

      let found = null;
      for (const m of merged) {
        const mHome = getCanonical(m.homeTeam || m.c_home);
        const mAway = getCanonical(m.awayTeam || m.c_away);

        const teamsMatch = (cHome && mHome && cHome === mHome && cAway === mAway) ||
                           (cHome && mHome && cHome === mAway && cAway === mHome);

        if (teamsMatch) {
          const sameDate = !evtDate || !m.date || evtDate === m.date;
          const sameTime = evtTime === m.time || evtTime === 'LIVE' || m.time === 'LIVE';
          const timeClose = evtTs > 0 && m.timestamp > 0 && Math.abs(evtTs - m.timestamp) <= 90 * 60 * 1000;

          if (sameDate && (sameTime || timeClose)) {
            found = m;
            break;
          }
        }
      }

      if (found) {
        const existingUrls = new Set((found.sources || []).map(s => s.url));
        if (evt.sources && Array.isArray(evt.sources)) {
          for (const s of evt.sources) {
            if (!s.url || !existingUrls.has(s.url)) {
              found.sources.push(s);
              if (s.url) existingUrls.add(s.url);
            }
          }
        }
        const hEng = this.toEnglishTeam(evt.homeTeam);
        const aEng = this.toEnglishTeam(evt.awayTeam);
        if (hEng) found.homeTeam = hEng;
        if (aEng) found.awayTeam = aEng;
        if (evt.isOngoing) found.isOngoing = true;
      } else {
        merged.push({
          ...evt,
          homeTeam: this.toEnglishTeam(evt.homeTeam) || 'Home Team',
          awayTeam: this.toEnglishTeam(evt.awayTeam) || 'Away Team',
          sources: [...(evt.sources || [])]
        });
      }
    }
    return merged;
  }

  sortLiveEvents(events) {
    if (!events || !Array.isArray(events)) return [];

    const ALL_TOP_LEAGUES = [
      'UCL', 'EPL', 'VLEAGUE', 'LALIGA', 'SERIE_A', 'BUNDESLIGA', 'LIGUE1',
      'WORLD_CUP', 'EURO', 'COPA_AMERICA', 'ASIAN_CUP', 'WC_QUAL', 'NATIONS_LEAGUE', 'UEL', 'UECL', 'AFC_CL',
      'F1', 'NBA', 'TENNIS', 'RUGBY', 'NFL', 'NCAAF', 'MMA',
      'FA_CUP', 'EFL_CUP', 'COPA_DEL_REY'
    ];

    const getPrioIdx = (evt) => {
      const lg = (evt.league || '').toUpperCase();
      const idx = ALL_TOP_LEAGUES.indexOf(lg);
      return idx >= 0 ? idx : 999;
    };

    const getTimestamp = (evt) => {
      if (typeof evt.timestamp === 'number' && evt.timestamp > 0) return evt.timestamp;
      return 0;
    };

    return [...events].sort((a, b) => {
      const aLive = a.isOngoing === true;
      const bLive = b.isOngoing === true;

      // 1. ƯU TIÊN HÀNG ĐẦU: Các trận đang LIVE luôn luôn đứng trước
      if (aLive && !bLive) return -1;
      if (!aLive && bLive) return 1;

      // 2. Trong danh sách các trận LIVE: Ưu tiên các giải đấu hàng đầu lên trước
      if (aLive && bLive) {
        const prioA = getPrioIdx(a);
        const prioB = getPrioIdx(b);
        if (prioA !== prioB) return prioA - prioB;
        return getTimestamp(a) - getTimestamp(b);
      }

      // 3. Trong danh sách các trận CHƯA ĐÁ (Sắp đấu):
      // Ưu tiên trận diễn ra sớm nhất theo ngày/giờ (hôm nay trước ngày mai)
      const tsA = getTimestamp(a);
      const tsB = getTimestamp(b);
      if (tsA !== tsB && tsA > 0 && tsB > 0) return tsA - tsB;

      // Cùng khung thời gian: Ưu tiên giải đấu hàng đầu
      const prioA = getPrioIdx(a);
      const prioB = getPrioIdx(b);
      return prioA - prioB;
    });
  }

  getSportInfo(evt) {
    const rawLeague = (evt.league || '').toUpperCase();
    const leagueStr = (evt.leagueName || '').toLowerCase();
    const homeStr = (evt.homeTeam || '').toLowerCase();
    const awayStr = (evt.awayTeam || '').toLowerCase();
    const sourcesStr = (evt.sources || []).map(s => s.name || '').join(' ').toLowerCase();
    const combined = `${rawLeague} ${leagueStr} ${homeStr} ${awayStr} ${sourcesStr}`.toLowerCase();

    // 1. Khắc phục nhầm lẫn: AFC Wimbledon & các CLB bóng đá bị gán nhầm thành giải Tennis
    const isWimbledonFootball = combined.includes('afc wimbledon') || combined.includes('wimbledon fc') ||
      (combined.includes('wimbledon') && (combined.includes('blackpool') || combined.includes('efl') || combined.includes('fa cup') || combined.includes('league two') || combined.includes('league 2')));

    if (isWimbledonFootball) {
      return {
        name: 'Bóng đá',
        icon: '⚽',
        badgeColor: 'bg-sky-500/15 border-sky-500/35 text-sky-300',
        cleanLeague: 'League Two'
      };
    }

    // 2. Rugby / Bóng bầu dục (Autumn Nations, Nations Championship, Six Nations, NRL...)
    if (rawLeague === 'RUGBY' || combined.includes('rugby') || combined.includes('bóng bầu dục') || combined.includes('nations championship') || 
        combined.includes('autumn nations') || combined.includes('six nations') || combined.includes('all blacks') ||
        (combined.includes('italy') && combined.includes('argentina') && (combined.includes('nations') || combined.includes('rugby'))) ||
        (combined.includes('wales') && combined.includes('new zealand') && (combined.includes('nations') || combined.includes('rugby')))) {
      return {
        name: 'Bóng bầu dục',
        icon: '🏉',
        badgeColor: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300',
        cleanLeague: evt.leagueName || 'Bóng bầu dục Quốc tế'
      };
    }

    // 3. F1 / Đua xe công thức 1
    const isF1 = rawLeague === 'F1' || /\b(formula\s*1|formula\s*one|grand\s*prix|công\s*thức\s*1|motogp|đua\s*xe)\b/i.test(combined) || /\bf1\b/i.test(combined);
    if (isF1) {
      return {
        name: 'Đua xe F1',
        icon: '🏎️',
        badgeColor: 'bg-rose-500/15 border-rose-500/35 text-rose-300',
        cleanLeague: evt.leagueName || 'Formula 1'
      };
    }

    // 4. Tennis / Quần vợt
    if (rawLeague === 'TENNIS' || combined.includes('tennis') || combined.includes('quần vợt') || combined.includes('atp') || combined.includes('wta') || combined.includes('grand slam') || (combined.includes('wimbledon') && !combined.includes('afc'))) {
      return {
        name: 'Quần vợt',
        icon: '🎾',
        badgeColor: 'bg-yellow-500/15 border-yellow-500/35 text-yellow-300',
        cleanLeague: 'Tennis ATP / Grand Slam'
      };
    }

    // 5. Basketball / Bóng rổ
    if (rawLeague === 'NBA' || combined.includes('nba') || combined.includes('bóng rổ') || combined.includes('basketball')) {
      return {
        name: 'Bóng rổ',
        icon: '🏀',
        badgeColor: 'bg-amber-500/15 border-amber-500/35 text-amber-300',
        cleanLeague: 'Bóng rổ NBA'
      };
    }

    // 6. American Football / NFL / NCAAF / Bóng bầu dục Mỹ
    if (rawLeague === 'NFL' || rawLeague === 'NCAAF' ||
        combined.includes('nfl') || combined.includes('ncaaf') || combined.includes('american football') ||
        combined.includes('bóng bầu dục mỹ') || combined.includes('cfl') || combined.includes('🏈') ||
        (combined.includes('ncaa') && !combined.includes('soccer') && !combined.includes('bóng đá') && !combined.includes('basketball'))) {
      return {
        name: 'Bóng bầu dục Mỹ',
        icon: '🏈',
        badgeColor: 'bg-orange-500/15 border-orange-500/35 text-orange-300',
        cleanLeague: (evt.leagueName && evt.leagueName !== 'OTHER' && evt.leagueName !== 'Bóng đá Quốc tế') ? evt.leagueName : (rawLeague === 'NFL' ? 'NFL' : 'NCAA Football')
      };
    }

    // 7. Ice Hockey / Khúc côn cầu
    if (rawLeague === 'NHL' || combined.includes('nhl') || combined.includes('khúc côn cầu') || combined.includes('hockey')) {
      return {
        name: 'Khúc côn cầu',
        icon: '🏒',
        badgeColor: 'bg-cyan-500/15 border-cyan-500/35 text-cyan-300',
        cleanLeague: evt.leagueName || 'Khúc côn cầu'
      };
    }

    // 8. Võ thuật / UFC / Boxing / MMA
    if (combined.includes('ufc') || combined.includes('boxing') || combined.includes('mma') || combined.includes('one championship') || combined.includes('võ thuật')) {
      return {
        name: 'Võ thuật',
        icon: '🥊',
        badgeColor: 'bg-red-500/15 border-red-500/35 text-red-300',
        cleanLeague: evt.leagueName || 'Võ thuật'
      };
    }

    // 9. Volleyball / Bóng chuyền
    if (combined.includes('volleyball') || combined.includes('bóng chuyền')) {
      return {
        name: 'Bóng chuyền',
        icon: '🏐',
        badgeColor: 'bg-blue-500/15 border-blue-500/35 text-blue-300',
        cleanLeague: evt.leagueName || 'Bóng chuyền'
      };
    }

    // 10. Mặc định là Bóng đá (Football)
    let cleanLeague = (evt.leagueName || evt.league || '').replace(/🌐\s*/g, '').replace(/Trực tiếp/g, '').trim();
    if (!cleanLeague || cleanLeague.toUpperCase() === 'OTHER' || cleanLeague.includes('Tennis')) {
      cleanLeague = this.detectSoccerLeague(combined, homeStr, awayStr);
    }

    return {
      name: 'Bóng đá',
      icon: '⚽',
      badgeColor: 'bg-sky-500/15 border-sky-500/35 text-sky-300',
      cleanLeague: cleanLeague || 'Bóng đá Quốc tế'
    };
  }

  detectSoccerLeague(combined, homeStr, awayStr) {
    if (combined.includes('uefa champions') || combined.includes('champions league') || combined.includes('cúp c1')) return 'Champions League';
    if (combined.includes('europa league') || combined.includes('cúp c2') || combined.includes('uel')) return 'Europa League';
    if (combined.includes('conference league') || combined.includes('cúp c3') || combined.includes('uecl')) return 'Conference League';
    if (combined.includes('premier league') || combined.includes('ngoại hạng anh') || /\bepl\b/.test(combined)) return 'EPL';
    if (combined.includes('nations league') || combined.includes('uefa nations') || combined.includes('uefa nl')) return 'UEFA Nations League';
    if (combined.includes('world cup') || combined.includes('wcq') || combined.includes('vòng loại world cup') || combined.includes('vòng loại wc')) return 'World Cup Qualifiers';
    if (combined.includes('giao hữu') || combined.includes('friendly') || combined.includes('interf')) return 'Giao hữu quốc tế';
    if (combined.includes('fa cup') || combined.includes('cúp fa')) return 'FA Cup';
    if (combined.includes('carabao') || combined.includes('efl cup') || combined.includes('cúp liên đoàn')) return 'Carabao Cup';
    if (combined.includes('championship') || combined.includes('hạng nhất anh')) return 'EFL Championship';
    if (combined.includes('league two') || combined.includes('league 2') || combined.includes('hạng 4 anh')) return 'League Two';
    if (combined.includes('league one') || combined.includes('league 1') || combined.includes('hạng 3 anh')) return 'League One';
    if (combined.includes('national league')) return 'National League';
    if (combined.includes('la liga 2') || combined.includes('laliga 2') || combined.includes('segunda') || combined.includes('hypermotion')) return 'La Liga 2';
    if (combined.includes('la liga') || combined.includes('laliga')) return 'La Liga';
    if (combined.includes('serie b')) return 'Serie B';
    if (combined.includes('serie a')) return 'Serie A';
    if (combined.includes('bundesliga 2') || combined.includes('2. bundesliga')) return '2. Bundesliga';
    if (combined.includes('bundesliga')) return 'Bundesliga';
    if (combined.includes('ligue 2')) return 'Ligue 2';
    if (combined.includes('ligue 1')) return 'Ligue 1';
    if (combined.includes('v.league 2') || combined.includes('v-league 2')) return 'V-League 2';
    if (combined.includes('v.league') || combined.includes('v-league') || combined.includes('vleague')) return 'V-League 1';
    if (combined.includes('copa del rey') || combined.includes('cúp nhà vua')) return 'Copa del Rey';
    if (combined.includes('coppa italia')) return 'Coppa Italia';
    if (combined.includes('dfb-pokal') || combined.includes('dfb pokal')) return 'DFB-Pokal';
    if (combined.includes('afc champions') || combined.includes('cúp c1 châu á')) return 'AFC Champions League';
    if (combined.includes('asian cup') || combined.includes('cúp châu á')) return 'AFC Asian Cup';
    if (combined.includes('saudi') || combined.includes('roshn')) return 'Saudi Pro League';
    if (combined.includes('mls')) return 'MLS';
    if (combined.includes('eredivisie')) return 'Eredivisie';
    if (combined.includes('eerste divisie')) return 'Eerste Divisie';

    // English lower tier clubs
    const lowerClubs = ['bristol', 'chesterfield', 'colchester', 'gillingham', 'crewe', 'newport', 'port vale', 'accrington', 'rochdale', 'york', 'salford', 'northampton', 'wimbledon', 'blackpool', 'bolton', 'reading', 'wrexham', 'stockport', 'mansfield', 'notts county', 'doncaster', 'bradford'];
    if (lowerClubs.some(c => homeStr.includes(c)) || lowerClubs.some(c => awayStr.includes(c))) {
      return 'League Two';
    }

    // National teams check
    const euroNations = ['norway', 'na uy', 'wales', 'xứ wales', 'georgia', 'hungary', 'england', 'anh', 'france', 'pháp', 'germany', 'đức', 'italy', 'ý', 'spain', 'tây ban nha', 'portugal', 'bồ đào nha', 'netherlands', 'hà lan', 'belgium', 'bỉ', 'croatia', 'switzerland', 'thụy sĩ', 'denmark', 'đan mạch', 'sweden', 'thụy điển', 'poland', 'ba lan', 'czech', 'séc', 'austria', 'áo', 'serbia', 'scotland', 'turkey', 'thổ nhĩ kỳ', 'ukraine', 'romania', 'slovakia', 'slovenia', 'albania', 'ireland', 'greece', 'hy lạp'];
    if (euroNations.some(c => homeStr.includes(c)) && euroNations.some(c => awayStr.includes(c))) {
      return 'UEFA Nations League';
    }

    const otherNations = ['palestine', 'iran', 'iraq', 'vietnam', 'việt nam', 'thái lan', 'thailand', 'indonesia', 'malaysia', 'china', 'trung quốc', 'japan', 'nhật bản', 'korea', 'hàn quốc', 'qatar', 'saudi', 'uae', 'uzbekistan', 'jordan', 'uganda', 'botswana', 'brazil', 'argentina', 'uruguay', 'colombia', 'chile', 'mỹ', 'usa', 'mexico', 'senegal', 'morocco', 'nigeria', 'cameroon'];
    if (otherNations.some(c => homeStr.includes(c)) || otherNations.some(c => awayStr.includes(c))) {
      return 'World Cup Qualifiers';
    }

    return 'Bóng đá Quốc tế';
  }

  renderSports(container) {
    if (!container) container = document.getElementById('sportsContainer');
    if (!container) return;

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
      const sport = this.getSportInfo(evt);
      const league = sport.cleanLeague;
      const home = this.toEnglishTeam(evt.homeTeam) || 'Home Team';
      const away = this.toEnglishTeam(evt.awayTeam) || 'Away Team';

      // 1. Trích xuất giờ thi đấu và ngày thi đấu (Kick-off Time & Date)
      let time = evt.time || '';
      let date = evt.date || '';

      if (!time && evt.displayTitle) {
        const m = evt.displayTitle.match(/\[(\d{1,2}:\d{2})(?:\s+([^\]]+))?\]/);
        if (m) {
          time = m[1];
          if (!date && m[2]) date = m[2];
        }
      }
      if (time === 'Trực tiếp') time = '';

      const homeInitial = home.substring(0, 3).toUpperCase();
      const awayInitial = away.substring(0, 3).toUpperCase();

      const homeLogo = this.getTeamLogo(home, evt, 'home', idx);
      const awayLogo = this.getTeamLogo(away, evt, 'away', idx);

      const sources = evt.sources || [];
      const isExpanded = this.expandedEventIdx === idx;
      const isEventActive = this.activeEventIdx === idx;

      html += `
        <div onclick="window.sportsManager.toggleMatchExpand(${idx})" 
             class="glass-card rounded-2xl p-4 space-y-3 border ${
               isEventActive ? 'border-[var(--accent)] bg-orange-500/[0.04]' : isExpanded ? 'border-white/25 bg-white/[0.04]' : 'border-white/10 hover:border-white/20'
             } transition-all duration-200 cursor-pointer relative overflow-hidden select-none">
          
          <!-- Top Row: Sport Name & League, Kick-off Time & Status Badge -->
          <div class="flex items-center justify-between gap-2 text-xs text-[var(--label-2)]">
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              <!-- Sport Name Badge (Hiện tên môn thể thao thay vì logo quả bóng ở đầu tiên) -->
              <span class="px-2 py-0.5 rounded-md font-bold text-[11px] flex items-center gap-1 border ${sport.badgeColor} shrink-0 shadow-sm">
                <span>${sport.icon}</span>
                <span>${sport.name}</span>
              </span>
              <!-- League Name -->
              <span class="font-bold text-[var(--blue)] truncate">
                ${league}
              </span>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              ${time ? `
                <span class="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-amber-300 font-mono font-bold text-[11px] flex items-center gap-1 shadow-sm">
                  <svg class="w-3 h-3 text-amber-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M12 6v6l4 2"/>
                  </svg>
                  <span>${time}${date ? ` (${date})` : ''}</span>
                </span>
              ` : ''}
              <span class="px-2 py-0.5 rounded-full ${isLive ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/10 text-white/70'} font-bold text-[10px] flex items-center gap-1 shrink-0">
                ${isLive ? '<span class="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span> LIVE' : 'Sắp đấu'}
              </span>
            </div>
          </div>

          <!-- Middle Row: Teams VS with Official Club Logos & Kick-off Time -->
          <div class="flex items-center justify-between py-1 gap-2">
            <!-- Home Team with Logo (Hiển thị tối đa 2 dòng nếu thiếu chiều ngang) -->
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <div class="w-10 h-10 rounded-xl bg-white/[0.08] border border-white/15 flex items-center justify-center p-1.5 shrink-0 shadow-inner overflow-hidden relative backdrop-blur-sm">
                <img id="team-logo-${idx}-home" 
                     src="${homeLogo || ''}" 
                     alt="${home}" 
                     class="w-full h-full object-contain filter drop-shadow transition-opacity duration-200 ${homeLogo ? '' : 'hidden'}" 
                     loading="lazy"
                     onerror="this.classList.add('hidden'); const fb=document.getElementById('team-fb-${idx}-home'); if(fb) fb.classList.remove('hidden');" 
                     onload="this.classList.remove('hidden');" />
                <span id="team-fb-${idx}-home" class="${homeLogo ? 'hidden' : 'flex'} items-center justify-center font-bold text-xs text-white/90 tracking-wider">
                  ${homeInitial}
                </span>
              </div>
              <span class="text-xs sm:text-sm font-bold text-white club-name-2line">${home}</span>
            </div>

            <!-- VS & Kick-off Time Center Pillar -->
            <div class="flex flex-col items-center justify-center px-1.5 shrink-0">
              <span class="text-xs font-mono text-[var(--label-3)] font-bold">VS</span>
              ${time ? `<span class="text-[10px] font-mono text-amber-400 font-bold tracking-wider mt-0.5">${time}</span>` : ''}
            </div>

            <!-- Away Team with Logo (Hiển thị tối đa 2 dòng nếu thiếu chiều ngang) -->
            <div class="flex items-center gap-2.5 flex-row-reverse min-w-0 flex-1 text-right">
              <div class="w-10 h-10 rounded-xl bg-white/[0.08] border border-white/15 flex items-center justify-center p-1.5 shrink-0 shadow-inner overflow-hidden relative backdrop-blur-sm">
                <img id="team-logo-${idx}-away" 
                     src="${awayLogo || ''}" 
                     alt="${away}" 
                     class="w-full h-full object-contain filter drop-shadow transition-opacity duration-200 ${awayLogo ? '' : 'hidden'}" 
                     loading="lazy"
                     onerror="this.classList.add('hidden'); const fb=document.getElementById('team-fb-${idx}-away'); if(fb) fb.classList.remove('hidden');" 
                     onload="this.classList.remove('hidden');" />
                <span id="team-fb-${idx}-away" class="${awayLogo ? 'hidden' : 'flex'} items-center justify-center font-bold text-xs text-white/90 tracking-wider">
                  ${awayInitial}
                </span>
              </div>
              <span class="text-xs sm:text-sm font-bold text-white club-name-2line text-right">${away}</span>
            </div>
          </div>

          <!-- Compact Expand Header Toggle Bar -->
          <div class="pt-2 border-t border-[var(--separator)] flex items-center justify-between text-[11px]">
            <div class="flex items-center gap-1.5 text-[var(--label-2)]">
              <span class="w-2 h-2 rounded-full ${isLive ? 'bg-emerald-400 animate-pulse' : 'bg-white/40'}"></span>
              <span class="font-medium text-white/80">${sources.length} luồng phát</span>
              <span class="text-[var(--label-3)] hidden sm:inline">• Nhấn để chọn kênh</span>
            </div>

            <!-- Animated Chevron Indicator -->
            <div class="flex items-center gap-1 text-[var(--orange)] font-semibold text-[11px]">
              <span>${isExpanded ? 'Thu gọn' : 'Xem luồng'}</span>
              <svg class="w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
              </svg>
            </div>
          </div>

          <!-- EXPANDABLE STREAM CHANNELS LIST (Chỉ xổ ra khi nhấn vào trận đấu) -->
          ${isExpanded ? `
            <div onclick="event.stopPropagation()" class="pt-3 border-t border-dashed border-white/15 space-y-2.5 animate-fadeIn">
              <div class="flex items-center justify-between text-[11px] text-[var(--label-3)]">
                <span class="font-medium text-white/90">Danh sách kênh phát trực tiếp:</span>
                <span class="text-[var(--orange)] font-mono">Chạm luồng để phát</span>
              </div>

              <!-- Stream Buttons Flex Grid -->
              <div class="flex items-center gap-2 flex-wrap">
                ${sources.map((src, sIdx) => {
                  const isSelected = isEventActive && this.activeSourceIdx === sIdx;
                  const label = this.formatStreamButtonLabel(src.name, sIdx);

                  return `
                    <button type="button" 
                            onclick="window.sportsManager.playSpecificStream(${idx}, ${sIdx}, event)" 
                            class="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all duration-150 active:scale-95 cursor-pointer ${
                              isSelected 
                                ? 'bg-gradient-to-r from-[#ff6500] to-[#ff9f0a] text-white shadow-lg shadow-orange-500/30 border border-white/30' 
                                : 'glass-pill text-white/90 hover:bg-white/20 hover:text-white border border-white/10'
                            }">
                      <span class="w-2 h-2 rounded-full ${isSelected ? 'bg-white animate-ping' : 'bg-emerald-400'}"></span>
                      <span>${label}</span>
                      <svg class="w-3 h-3 text-white/60 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}

        </div>
      `;
    });

    container.innerHTML = html;

    const countBadge = document.getElementById('sportsCountBadge');
    if (countBadge) countBadge.textContent = `${this.liveEvents.length} trận đấu`;
  }

  toggleMatchExpand(index) {
    if (this.expandedEventIdx === index) {
      this.expandedEventIdx = -1; // collapse if already open
    } else {
      this.expandedEventIdx = index; // expand clicked match
    }
    this.renderSports();
  }

  formatStreamButtonLabel(rawName, index) {
    if (!rawName) return `Luồng ${index + 1}`;

    const parenMatches = rawName.match(/\(([^)]+)\)/g);
    if (parenMatches && parenMatches.length > 0) {
      const cleanCommentator = parenMatches[parenMatches.length - 1].replace(/[()]/g, '').trim();
      return `Luồng ${index + 1}: ${cleanCommentator}`;
    }

    return `Luồng ${index + 1} (HD)`;
  }

  playSpecificStream(eventIdx, sourceIdx, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

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

    // Trích xuất nhà đài / nguồn phát (ví dụ: Gà Vàng, Xôi Chè sau dấu '-')
    let provider = '';
    if (stream.name && stream.name.includes(' - ')) {
      provider = stream.name.split(' - ').pop().trim();
    }
    const leagueStr = evt.leagueName || evt.league || '';
    const subtitleParts = [streamLabel];
    if (leagueStr) subtitleParts.push(leagueStr);
    if (provider && provider.toLowerCase() !== leagueStr.toLowerCase()) subtitleParts.push(provider);

    // Play in player
    if (this.player) {
      this.player.playStream(stream.url, {
        name: evt.leagueName || 'Thể Thao Trực Tiếp',
        title: `${this.toEnglishTeam(evt.homeTeam)} vs ${this.toEnglishTeam(evt.awayTeam)}`,
        subtitle: subtitleParts.join(' • '),
        group: 'Thể Thao',
        dash: stream.dash,
        clearKey: stream.clearKey
      });

      // Update button visual states
      this.renderSports();
    }
  }

  renderSkeleton(container) {
    let html = '';
    for (let i = 0; i < 4; i++) {
      html += `
        <div class="glass-card rounded-2xl p-4 space-y-3">
          <div class="w-24 h-4 rounded skeleton"></div>
          <div class="flex justify-between items-center py-2">
            <div class="w-28 h-5 rounded skeleton"></div>
            <div class="w-8 h-4 rounded skeleton"></div>
            <div class="w-28 h-5 rounded skeleton"></div>
          </div>
          <div class="w-full h-4 rounded skeleton"></div>
        </div>
      `;
    }
    container.innerHTML = html;
  }
}

window.SportsManager = SportsManager;
