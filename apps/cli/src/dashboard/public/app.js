/* JoWork Dashboard — Vue 3 CDN App */
/* global Vue */

const { createApp, ref, reactive, computed, onMounted, onUnmounted, nextTick } = Vue;

const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]')?.content ?? '';

// Binary extensions skipped during browser-side file reading
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'webp',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'flac',
  'zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'sqlite', 'db', 'o', 'a', 'pyc', 'class', 'wasm',
]);

const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__', '.next', '.nuxt',
  '.turbo', 'dist', 'build', '.cache', '.vscode', '.idea', 'coverage', 'vendor', '.svn', '.hg']);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_DEPTH = 10;
const UPLOAD_BATCH_SIZE = 50;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (opts.method === 'POST' || opts.method === 'DELETE') {
    headers['X-CSRF-Token'] = CSRF_TOKEN;
  }
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'never';
  const diff = Date.now() - timestamp;
  return formatDuration(diff) + ' ago';
}

/** Recursively read a dropped directory via webkitGetAsEntry API */
async function readDroppedDirectory(entry) {
  const files = [];

  async function readAllEntries(reader) {
    const entries = [];
    let batch;
    do {
      batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      entries.push(...batch);
    } while (batch.length > 0);
    return entries;
  }

  async function traverse(dirEntry, path = '', depth = 0) {
    if (depth > MAX_DEPTH) return;
    const reader = dirEntry.createReader();
    const entries = await readAllEntries(reader);
    for (const e of entries) {
      if (e.isFile) {
        const ext = e.name.split('.').pop()?.toLowerCase() ?? '';
        if (BINARY_EXTENSIONS.has(ext)) continue;

        const file = await new Promise((resolve, reject) => e.file(resolve, reject));
        if (file.size > MAX_FILE_SIZE || file.size === 0) continue;

        try {
          const content = await file.text();
          files.push({ path: path + '/' + e.name, content, size: file.size });
        } catch { /* skip unreadable files */ }
      } else if (e.isDirectory) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        await traverse(e, path + '/' + e.name, depth + 1);
      }
    }
  }

  await traverse(entry);
  return files;
}

const App = {
  setup() {
    const activeTab = ref('sessions');
    const theme = ref(localStorage.getItem('jowork-theme') || 'dark');
    const wsStatus = ref('closed');

    // Data
    const status = reactive({ counts: {}, lastSync: null });
    const sessions = ref([]);
    const sources = reactive({ connectors: [], cursors: [], objectCounts: [], credSources: [] });
    const goals = ref([]);
    const context = ref([]);

    // Drop zone
    const dropActive = ref(false);

    // Progress bar
    const uploadProgress = ref(0);     // 0-100
    const uploadActive = ref(false);

    // Toast system
    const toasts = ref([]);
    let toastIdCounter = 0;

    function showToast(message, variant = 'success') {
      const id = ++toastIdCounter;
      toasts.value.push({ id, message, variant });
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
      }, 4000);
    }

    // WebSocket
    let ws = null;
    let reconnectTimer = null;

    function connectWs() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${location.host}/api/ws`);
      ws.onopen = () => { wsStatus.value = 'open'; };
      ws.onclose = () => {
        wsStatus.value = 'closed';
        reconnectTimer = setTimeout(connectWs, 3000);
      };
      ws.onerror = () => { ws.close(); };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state_change') {
            fetchAll();
          } else if (msg.type === 'index_progress') {
            const { indexed, total, done } = msg.data;
            if (total > 0) {
              uploadProgress.value = Math.round((indexed / total) * 100);
            }
            if (done) {
              // Keep at 100% briefly, then hide
              uploadProgress.value = 100;
              setTimeout(() => {
                uploadActive.value = false;
                uploadProgress.value = 0;
              }, 500);
            }
          }
        } catch { /* ignore parse errors */ }
      };
    }

    // Fetch data
    async function fetchStatus() {
      try {
        const data = await api('/api/status');
        Object.assign(status, data);
      } catch { /* ignore */ }
    }

    async function fetchSessions() {
      try {
        sessions.value = await api('/api/sessions');
      } catch { /* ignore */ }
    }

    async function fetchSources() {
      try {
        const data = await api('/api/sources');
        Object.assign(sources, data);
      } catch { /* ignore */ }
    }

    async function fetchGoals() {
      try {
        goals.value = await api('/api/goals');
      } catch { /* ignore */ }
    }

    async function fetchContext() {
      try {
        context.value = await api('/api/context');
      } catch { /* ignore */ }
    }

    async function fetchAll() {
      await Promise.all([fetchStatus(), fetchSessions(), fetchSources(), fetchGoals(), fetchContext()]);
    }

    // Actions
    async function addContext(type, value, label) {
      try {
        await api('/api/context', {
          method: 'POST',
          body: JSON.stringify({ type, value, label }),
        });
        await fetchContext();
      } catch (err) {
        console.error('Failed to add context:', err);
      }
    }

    async function removeContext(id) {
      try {
        await api(`/api/context/${id}`, { method: 'DELETE' });
        await fetchContext();
      } catch (err) {
        console.error('Failed to remove context:', err);
      }
    }

    async function triggerSync(source) {
      try {
        await api(`/api/sync/${source}`, { method: 'POST' });
        await fetchAll();
      } catch (err) {
        console.error('Failed to sync:', err);
      }
    }

    async function focusSession(session) {
      try {
        const result = await api(`/api/sessions/${session.id}/focus`, { method: 'POST' });
        if (result.focused) {
          showToast('Focused terminal window', 'success');
        } else {
          // Fallback: copy cd command
          const text = result.fallback || `cd ${session.working_dir}`;
          await navigator.clipboard.writeText(text).catch(() => {});
          showToast('Command copied to clipboard', 'success');
        }
      } catch (err) {
        // On error, fall back to copy
        const text = `cd ${session.working_dir}`;
        await navigator.clipboard.writeText(text).catch(() => {});
        showToast('Command copied to clipboard', 'success');
      }
    }

    function toggleTheme() {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme.value);
      localStorage.setItem('jowork-theme', theme.value);
    }

    // Drop handlers
    function onDragOver(e) {
      e.preventDefault();
      e.stopPropagation();
      dropActive.value = true;
    }

    function onDragLeave(e) {
      e.preventDefault();
      e.stopPropagation();
      dropActive.value = false;
    }

    async function onDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      dropActive.value = false;

      const items = e.dataTransfer?.items;
      if (!items) return;

      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (!entry) continue;

        if (entry.isDirectory) {
          const label = entry.name;
          uploadActive.value = true;
          uploadProgress.value = 0;

          try {
            const files = await readDroppedDirectory(entry);
            if (files.length === 0) {
              uploadActive.value = false;
              showToast('No indexable files found in directory', 'error');
              return;
            }

            // Send in batches of UPLOAD_BATCH_SIZE
            let totalIndexed = 0;
            for (let i = 0; i < files.length; i += UPLOAD_BATCH_SIZE) {
              const batch = files.slice(i, i + UPLOAD_BATCH_SIZE);
              const result = await api('/api/context/upload', {
                method: 'POST',
                body: JSON.stringify({ label, files: batch }),
              });
              totalIndexed += result.indexed;
              uploadProgress.value = Math.round(((i + batch.length) / files.length) * 100);
            }

            uploadProgress.value = 100;
            setTimeout(() => {
              uploadActive.value = false;
              uploadProgress.value = 0;
            }, 500);

            showToast(`Indexed ${totalIndexed} files from ${label}`, 'success');
            await fetchAll();
          } catch (err) {
            uploadActive.value = false;
            uploadProgress.value = 0;
            showToast(`Failed to index: ${err.message}`, 'error');
          }
        } else if (entry.isFile) {
          // Single file — use existing addContext approach
          const file = item.getAsFile?.();
          if (file) {
            const path = file.webkitRelativePath || file.name;
            await addContext('file', path, file.name || path);
          }
        }
      }
    }

    // Keyboard shortcuts
    function onKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '1') { activeTab.value = 'sessions'; e.preventDefault(); }
      if (e.key === '2') { activeTab.value = 'context'; e.preventDefault(); }
      if (e.key === '3') { activeTab.value = 'goals'; e.preventDefault(); }
    }

    // Computed
    const sourceList = computed(() => {
      const countMap = {};
      for (const oc of sources.objectCounts) {
        countMap[oc.source] = oc.count;
      }
      const cursorMap = {};
      for (const cur of sources.cursors) {
        const src = cur.connector_id.split(':')[0];
        if (!cursorMap[src] || cur.last_synced_at > cursorMap[src]) {
          cursorMap[src] = cur.last_synced_at;
        }
      }
      const allSources = new Set([
        ...sources.credSources,
        ...sources.connectors.map(c => c.type),
      ]);
      return Array.from(allSources).map(name => ({
        name,
        count: countMap[name] || 0,
        lastSync: cursorMap[name] || null,
        connected: sources.credSources.includes(name),
      }));
    });

    function goalProgress(goal) {
      if (!goal.signals || goal.signals.length === 0) return 0;
      let met = 0;
      let total = 0;
      for (const sig of goal.signals) {
        if (!sig.measures) continue;
        for (const m of sig.measures) {
          total++;
          if (m.met) met++;
        }
      }
      return total > 0 ? Math.round((met / total) * 100) : 0;
    }

    function goalMeasureCounts(goal) {
      let met = 0, total = 0;
      if (!goal.signals) return { met, total };
      for (const sig of goal.signals) {
        if (!sig.measures) continue;
        for (const m of sig.measures) {
          total++;
          if (m.met) met++;
        }
      }
      return { met, total };
    }

    // Lifecycle
    onMounted(() => {
      document.documentElement.setAttribute('data-theme', theme.value);
      fetchAll();
      connectWs();
      document.addEventListener('keydown', onKeyDown);
    });

    onUnmounted(() => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener('keydown', onKeyDown);
    });

    return {
      activeTab, theme, wsStatus,
      status, sessions, sources, goals, context,
      sourceList, dropActive,
      uploadProgress, uploadActive, toasts,
      addContext, removeContext, triggerSync, focusSession, toggleTheme,
      onDragOver, onDragLeave, onDrop,
      goalProgress, goalMeasureCounts,
      formatTimeAgo, formatDuration,
    };
  },

  template: `
    <div class="app-layout">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-header">
          <h1>JoWork</h1>
          <div class="subtitle">Companion Panel</div>
        </div>

        <div class="sidebar-section">
          <div class="section-label">Data Sources</div>
          <div v-if="sourceList.length === 0" style="font-size: 13px; color: var(--text-tertiary); padding: 8px;">
            No sources connected
          </div>
          <div v-for="item in sourceList" :key="item.name" class="source-item-group">
            <div class="source-item">
              <span class="status-dot" :class="item.connected ? 'connected' : 'disconnected'"></span>
              <span class="source-name">{{ item.name }}</span>
              <span class="source-count">{{ item.count }}</span>
            </div>
            <div v-if="item.lastSync" class="source-time">
              {{ formatTimeAgo(item.lastSync) }}
            </div>
          </div>

          <button v-if="sourceList.some(s => s.connected)" class="sidebar-btn primary" @click="triggerSync(sourceList.find(s => s.connected)?.name)">
            Sync Now
          </button>
        </div>

        <div class="sidebar-section">
          <div class="section-label">Overview</div>
          <div style="font-size: 13px; color: var(--text-secondary);">
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span>Objects</span>
              <span style="font-family: 'Geist Mono', monospace; color: var(--text-tertiary);">{{ status.counts?.objects || 0 }}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span>Memories</span>
              <span style="font-family: 'Geist Mono', monospace; color: var(--text-tertiary);">{{ status.counts?.memories || 0 }}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 4px 0;">
              <span>Links</span>
              <span style="font-family: 'Geist Mono', monospace; color: var(--text-tertiary);">{{ status.counts?.object_links || 0 }}</span>
            </div>
          </div>
        </div>

        <div class="sidebar-footer">
          <div class="ws-status" style="margin-bottom: 8px;">
            <span class="ws-dot" :class="wsStatus"></span>
            <span>{{ wsStatus === 'open' ? 'Connected' : 'Reconnecting...' }}</span>
          </div>
          <button class="theme-toggle" @click="toggleTheme">
            {{ theme === 'dark' ? 'Light mode' : 'Dark mode' }}
          </button>
        </div>
      </aside>

      <!-- Main -->
      <main class="main-area">
        <!-- Upload progress bar -->
        <div v-if="uploadActive" class="upload-progress-bar">
          <div class="upload-progress-fill" :style="{ width: uploadProgress + '%' }"></div>
        </div>

        <div class="tab-bar">
          <button class="tab-btn" :class="{ active: activeTab === 'sessions' }" @click="activeTab = 'sessions'">
            Sessions <span class="tab-hint">1</span>
          </button>
          <button class="tab-btn" :class="{ active: activeTab === 'context' }" @click="activeTab = 'context'">
            Context <span class="tab-hint">2</span>
          </button>
          <button class="tab-btn" :class="{ active: activeTab === 'goals' }" @click="activeTab = 'goals'">
            Goals <span class="tab-hint">3</span>
          </button>
        </div>

        <div class="tab-content">
          <!-- Sessions Tab -->
          <div v-if="activeTab === 'sessions'">
            <div v-if="sessions.length === 0" class="empty-state">
              <div class="empty-title">No active sessions</div>
              <div class="empty-desc">
                Start an AI agent session with JoWork connected. Sessions appear here automatically when an agent connects via MCP.
              </div>
            </div>
            <div v-for="session in sessions" :key="session.id" class="card">
              <div class="session-card">
                <div class="session-info">
                  <div class="card-title">{{ session.working_dir?.split('/').pop() || 'Unknown' }}</div>
                  <div class="session-path">{{ session.working_dir }}</div>
                  <div class="card-tags">
                    <span class="tag accent">{{ session.engine || 'unknown' }}</span>
                    <span class="tag">PID {{ session.pid }}</span>
                    <span class="tag">{{ formatDuration(Date.now() - session.connected_at) }}</span>
                  </div>
                </div>
                <button class="focus-btn" @click="focusSession(session)" title="Focus terminal or copy cd command">
                  Focus
                </button>
              </div>
            </div>
          </div>

          <!-- Context Tab -->
          <div v-if="activeTab === 'context'">
            <div v-if="context.length === 0 && !dropActive" class="empty-state">
              <div class="empty-title">No active context</div>
              <div class="empty-desc">
                Drag a directory here to index it, or add context entries that your AI agents can access during conversations.
              </div>
            </div>

            <div v-for="item in context" :key="item.id" class="card">
              <div class="context-item">
                <div class="context-info">
                  <div class="context-value">{{ item.value }}</div>
                  <div class="context-label">{{ item.type }}{{ item.label ? ' \u2014 ' + item.label : '' }}</div>
                </div>
                <button class="remove-btn" @click="removeContext(item.id)" title="Remove">&times;</button>
              </div>
            </div>

            <div
              class="drop-zone"
              :class="{ active: dropActive }"
              @dragover="onDragOver"
              @dragleave="onDragLeave"
              @drop="onDrop"
            >
              <div class="drop-zone-text">
                {{ dropActive ? 'Release to index' : 'Drag a folder here to index' }}
              </div>
              <div class="drop-zone-hint">
                Files will be indexed into the JoWork database, making them searchable by AI agents
              </div>
            </div>
          </div>

          <!-- Goals Tab -->
          <div v-if="activeTab === 'goals'">
            <div v-if="goals.length === 0" class="empty-state">
              <div class="empty-title">No active goals</div>
              <div class="empty-desc">
                Set up goals with signals and measures to track what matters. Use the CLI: jowork goal create "My Goal"
              </div>
            </div>
            <div v-for="goal in goals" :key="goal.id" class="card goal-card">
              <div class="card-header">
                <div class="goal-title">{{ goal.title }}</div>
                <div class="card-meta">
                  {{ goalMeasureCounts(goal).met }}/{{ goalMeasureCounts(goal).total }} met
                </div>
              </div>
              <div v-if="goal.description" class="goal-desc">{{ goal.description }}</div>
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: goalProgress(goal) + '%' }"></div>
              </div>
              <div v-if="goal.signals && goal.signals.length > 0" class="signal-list">
                <div v-for="signal in goal.signals" :key="signal.id" class="signal-item">
                  <span class="signal-name">{{ signal.title }}</span>
                  <span>
                    <span class="signal-value" :class="signal.currentValue !== null ? 'met' : 'unmet'">
                      {{ signal.currentValue !== null ? signal.currentValue : '--' }}
                    </span>
                    <span v-if="signal.measures && signal.measures.length > 0" class="measure-status">
                      {{ signal.measures[0].met ? 'Met' : 'Unmet' }}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <!-- Toast container -->
      <div class="toast-container">
        <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.variant">
          {{ toast.message }}
        </div>
      </div>
    </div>
  `,
};

createApp(App).mount('#app');
