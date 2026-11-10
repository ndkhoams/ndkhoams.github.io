/**
 * TV Play Strand Edition — Main Application Coordinator
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Video Player
  const player = new StrandPlayer();
  window.player = player;

  // 2. Initialize Channels & Sports Managers
  const channelManager = new ChannelManager(player);
  window.channelManager = channelManager;

  const sportsManager = new SportsManager(player);
  window.sportsManager = sportsManager;

  // 3. Load initial data
  channelManager.loadChannels();
  sportsManager.loadSports();

  // 4. Auto refresh sports every 5 minutes
  setInterval(() => {
    sportsManager.loadSports();
  }, 5 * 60 * 1000);

  // 5. Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
      .catch(err => console.warn('[PWA] Service Worker registration failed:', err));
  }

  // 6. Keyboard Shortcuts
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

  // 7. Search Input listener
  const searchInput = document.getElementById('channelSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      channelManager.setSearchQuery(e.target.value);
    });
  }

  // 8. Load settings values
  loadSettingsUI();
});

// Tab navigation handler
function switchTab(tabId) {
  const tabs = ['live', 'sports', 'remote', 'settings'];
  
  tabs.forEach(t => {
    // Desktop Nav Pills
    const btn = document.getElementById(`tab-${t}`);
    if (btn) {
      if (t === tabId) {
        btn.className = 'px-4 py-1.5 rounded-full bg-white/20 text-white font-semibold transition';
      } else {
        btn.className = 'px-4 py-1.5 rounded-full text-[var(--label-2)] hover:text-white transition';
      }
    }

    // Mobile Bottom Island Nav
    const mBtn = document.getElementById(`m-tab-${t}`);
    if (mBtn) {
      const text = mBtn.querySelector('span');
      const icon = mBtn.querySelector('svg');
      if (t === tabId) {
        if (text) text.className = 'text-[9px] font-semibold mt-0.5 text-white';
        if (icon) icon.classList.add('text-[var(--accent)]');
      } else {
        if (text) text.className = 'text-[9px] font-medium mt-0.5 text-[var(--label-2)]';
        if (icon) icon.classList.remove('text-[var(--accent)]');
      }
    }

    // Section Visibility
    const sec = document.getElementById(`section-${t}`);
    if (sec) {
      if (t === tabId) sec.classList.remove('hidden');
      else sec.classList.add('hidden');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Settings modal
function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.remove('hidden');
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.add('hidden');
}

function loadSettingsUI() {
  const customM3uInput = document.getElementById('settingCustomM3u');
  const hubUrlInput = document.getElementById('settingHubUrl');
  const useArmbianCheckbox = document.getElementById('settingUseArmbian');

  if (customM3uInput) customM3uInput.value = localStorage.getItem('tvplay_custom_m3u') || '';
  if (hubUrlInput) hubUrlInput.value = localStorage.getItem('tvplay_hub_url') || 'http://10.0.0.222:8080';
  if (useArmbianCheckbox) useArmbianCheckbox.checked = localStorage.getItem('tvplay_use_armbian') === 'true';
}

function saveSettings() {
  const customM3uInput = document.getElementById('settingCustomM3u');
  const hubUrlInput = document.getElementById('settingHubUrl');
  const useArmbianCheckbox = document.getElementById('settingUseArmbian');

  if (customM3uInput) localStorage.setItem('tvplay_custom_m3u', customM3uInput.value.trim());
  if (hubUrlInput) localStorage.setItem('tvplay_hub_url', hubUrlInput.value.trim());
  if (useArmbianCheckbox) localStorage.setItem('tvplay_use_armbian', useArmbianCheckbox.checked ? 'true' : 'false');

  closeSettingsModal();
  alert('Đã lưu cấu hình. Đang tải lại danh sách kênh...');
  if (window.channelManager) window.channelManager.loadChannels();
  if (window.sportsManager) window.sportsManager.loadSports();
}

// Remote TV command dispatcher (via Armbian Hub)
async function sendRemoteKey(key) {
  const hubUrl = localStorage.getItem('tvplay_hub_url') || 'http://10.0.0.222:8080';
  try {
    const res = await fetch(`${hubUrl}/api/key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key })
    });
    if (res.ok) {
      console.log(`[Remote] Key '${key}' sent successfully`);
    }
  } catch (err) {
    console.warn(`[Remote] Failed to send key '${key}':`, err);
  }
}
