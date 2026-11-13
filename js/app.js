/**
 * TV Play Strand Edition — Main Application Coordinator
 * Liquid Glass Dock & Multi-playlist management.
 */

// Dynamic header height measurement for iOS notch & sticky player positioning
function updateAppHeaderHeight() {
  const header = document.getElementById('mainHeader');
  if (header) {
    const h = header.offsetHeight;
    if (window.innerWidth < 1024) {
      document.documentElement.style.setProperty('--app-header-height', `${h}px`);
    } else {
      document.documentElement.style.setProperty('--app-header-height', '0px');
    }
  }
}
window.addEventListener('resize', updateAppHeaderHeight);
window.addEventListener('orientationchange', updateAppHeaderHeight);

document.addEventListener('DOMContentLoaded', () => {
  updateAppHeaderHeight();

  // 1. Initialize Video Player Engine
  const player = new StrandPlayer();
  window.player = player;

  // 2. Initialize Channels, Timeline & Sports Managers
  const channelManager = new ChannelManager(player);
  window.channelManager = channelManager;

  const timelineManager = new TimelineManager(channelManager, player);
  window.timelineManager = timelineManager;

  const sportsManager = new SportsManager(player);
  window.sportsManager = sportsManager;

  // 3. Chain channel load -> timeline render
  const originalOnChannelsReady = channelManager.onChannelsReady.bind(channelManager);
  channelManager.onChannelsReady = function() {
    originalOnChannelsReady();
    timelineManager.onChannelsLoaded();
  };

  // 4. Load initial data
  channelManager.loadChannels();
  sportsManager.loadSports();
  timelineManager.init();

  // On desktop (width >= 1024), default to sports tab so matches list is visible in right column
  if (window.innerWidth >= 1024) {
    switchTab('sports');
  }

  // 5. Auto refresh sports every 3 minutes with fresh cache buster
  setInterval(() => {
    sportsManager.loadSports(true);
    if (channelManager && channelManager.reloadSportsChannels) {
      channelManager.reloadSportsChannels();
    }
  }, 3 * 60 * 1000);

  // 6. Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
      .catch(err => console.warn('[PWA] Service Worker registration failed:', err));
  }

  // 7. Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        player.togglePlay();
        break;
      case 'ArrowUp':
        e.preventDefault();
        channelManager.playPrevChannel();
        break;
      case 'ArrowDown':
        e.preventDefault();
        channelManager.playNextChannel();
        break;
      case 'ArrowLeft':
        timelineManager.prevCategory();
        break;
      case 'ArrowRight':
        timelineManager.nextCategory();
        break;
      case 'KeyM':
        player.toggleMute();
        break;
      case 'KeyF':
        player.toggleFullscreen();
        break;
      case 'KeyP':
        player.requestPiP();
        break;
    }
  });

  // 8. Search Input listener
  const searchInput = document.getElementById('channelSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      channelManager.setSearchQuery(e.target.value);
    });
  }
});

// Tab navigation handler (Strand Bottom Liquid Dock & Desktop Sidebar)
function switchTab(tabId) {
  const tabs = ['live', 'sports', 'channels'];

  tabs.forEach(t => {
    // 1. Desktop Top Nav Pills
    const btn = document.getElementById(`tab-${t}`);
    if (btn) {
      if (t === tabId) {
        btn.className = 'px-4 py-1.5 rounded-full bg-white/20 text-white font-semibold transition';
      } else {
        btn.className = 'px-4 py-1.5 rounded-full text-[var(--label-2)] hover:text-white transition';
      }
    }

    // 2. Desktop & Mobile Content Sub-Tabs
    const sideBtn = document.getElementById(`side-tab-${t}`);
    if (sideBtn) {
      if (t === tabId) {
        sideBtn.className = 'flex-1 py-1.5 rounded-lg bg-white/20 text-white font-semibold transition text-center flex items-center justify-center gap-1.5';
      } else {
        sideBtn.className = 'flex-1 py-1.5 rounded-lg text-[var(--label-2)] hover:text-white transition text-center flex items-center justify-center gap-1.5';
      }
    }

    // 3. Section Visibility
    const sec = document.getElementById(`section-${t}`);
    if (sec) {
      if (t === tabId) sec.classList.remove('hidden');
      else sec.classList.add('hidden');
    }
  });

  // Update Sidebar Header Title & Refresh Button
  const sidebarTitle = document.getElementById('sidebarSectionTitle');
  const countBadge = document.getElementById('sportsCountBadge');
  const btnRefresh = document.getElementById('btnRefreshSports');
  if (sidebarTitle) {
    if (tabId === 'sports') {
      sidebarTitle.textContent = 'Trực Tiếp Thể Thao';
      if (countBadge && window.sportsManager) {
        countBadge.textContent = `${window.sportsManager.liveEvents ? window.sportsManager.liveEvents.length : 0} trận đấu`;
      }
    } else if (tabId === 'live') {
      sidebarTitle.textContent = 'Lịch Kênh (Timeline)';
      if (countBadge) {
        countBadge.textContent = '24/7 EPG';
      }
    } else if (tabId === 'channels') {
      sidebarTitle.textContent = 'Danh Sách Kênh TV & Trận Đấu';
      if (countBadge && window.channelManager) {
        countBadge.textContent = `${window.channelManager.channels.length} kênh & trận`;
      }
    }
  }
  if (btnRefresh) {
    btnRefresh.style.display = tabId === 'sports' ? 'inline-flex' : 'none';
  }

  // Re-render timeline if switching to live
  if (tabId === 'live' && window.timelineManager) {
    setTimeout(() => {
      window.timelineManager.scrollToNow();
    }, 100);
  }

  // Only scroll top on mobile (< 1024px)
  if (window.innerWidth < 1024) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Settings modal & Playlists Manager
function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.classList.remove('hidden');
    if (window.channelManager) {
      window.channelManager.renderPlaylistsUI();
    }
    const nameInput = document.getElementById('newPlaylistName');
    if (nameInput) {
      setTimeout(() => nameInput.focus(), 150);
    }
  }
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.add('hidden');
}

function submitNewPlaylist() {
  const nameInput = document.getElementById('newPlaylistName');
  const urlInput = document.getElementById('newPlaylistUrl');

  if (!nameInput || !urlInput) return;

  const success = window.channelManager.addPlaylist(nameInput.value, urlInput.value);
  if (success) {
    nameInput.value = '';
    urlInput.value = '';
    alert('Đã thêm nguồn phát mới thành công và nạp danh sách kênh!');
  }
}

// Expose globally
window.switchTab = switchTab;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.submitNewPlaylist = submitNewPlaylist;
