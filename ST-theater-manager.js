// @ts-nocheck
// 小剧场提示词管理器 v5.0
// 更新：文件夹功能+拖拽功能+修改收藏默认置顶为可选+修复多选勾选框可见度

(function() {
  'use strict';

  function getParentWindow() {
    return window.parent && window.parent !== window ? window.parent : window;
  }

  function getJQuery() {
    const pw = getParentWindow();
    return pw.$ || pw.jQuery || window.$ || window.jQuery;
  }

  let theaterData = {
    prompts: [],
    history: [],
    categories: [],
    folders: [],
    version: 5,
    theme: 'dark',
    generationHistory: [],
    settings: { favoriteOnTop: true }
  };
  let currentEditId = null;
  let currentTab = 'all';
  let currentCharacter = '';
  let currentUser = '';
  let batchSelectMode = false;
  let selectedIds = new Set();
  let currentFavorite = false;
  let deletedItem = null;
  let undoTimeout = null;
  let longPressTimer = null;
  let isGenerating = false;
  let currentGenerationPromptId = null;
  let draggedItem = null;
  let draggedType = null;
  let expandedFolders = new Set();

  const themes = {
    dark: { name: '🌙 暗夜', bg: 'linear-gradient(135deg,#1a1a2e,#16213e,#0f0f23)', header: 'linear-gradient(90deg,#667eea,#764ba2)', card: 'rgba(255,255,255,0.03)', cardHover: 'rgba(255,255,255,0.06)', text: '#e8e8e8', textMuted: '#888', accent: '#667eea', categoryBg: 'rgba(118,75,162,0.3)', categoryText: '#d4a8ff' },
    light: { name: '☀️ 日间', bg: 'linear-gradient(135deg,#f5f7fa,#e4e8ec,#f0f2f5)', header: 'linear-gradient(90deg,#667eea,#764ba2)', card: 'rgba(0,0,0,0.04)', cardHover: 'rgba(0,0,0,0.08)', text: '#1a1a2e', textMuted: '#555555', accent: '#5a67d8', categoryBg: 'rgba(90,103,216,0.15)', categoryText: '#4c51bf' },
    sakura: { name: '🌸 樱花粉', bg: 'linear-gradient(135deg,#2d1f2f,#3d2a3f,#2a1a2a)', header: 'linear-gradient(90deg,#ff6b9d,#c44569)', card: 'rgba(255,182,193,0.08)', cardHover: 'rgba(255,182,193,0.15)', text: '#f8e8ee', textMuted: '#c8a8b8', accent: '#ff6b9d', categoryBg: 'rgba(255,107,157,0.25)', categoryText: '#ffb6c1' },
    galaxy: { name: '🌌 星空紫', bg: 'linear-gradient(135deg,#1a1a3e,#2d1b4e,#0f0f2a)', header: 'linear-gradient(90deg,#a855f7,#6366f1)', card: 'rgba(168,85,247,0.08)', cardHover: 'rgba(168,85,247,0.15)', text: '#e8e0f8', textMuted: '#a8a0c8', accent: '#a855f7', categoryBg: 'rgba(168,85,247,0.3)', categoryText: '#d8b4fe' }
  };

  function normalizeCategories(categories) {
    if (!categories) return [];
    if (Array.isArray(categories)) return categories.filter(c => c && c.trim());
    if (typeof categories === 'string') return categories.split(/[,，]/).map(c => c.trim()).filter(c => c);
    return [];
  }

  function categoriesToString(categories) { return normalizeCategories(categories).join(', '); }
  function parseCategories(input) { if (!input) return []; return input.split(/[,，]/).map(c => c.trim()).filter(c => c); }
  function matchesCategory(promptCategories, filterCategory) { if (!filterCategory) return true; return normalizeCategories(promptCategories).includes(filterCategory); }
  function getAllCategories() { const allCats = new Set(); theaterData.prompts.forEach(p => { normalizeCategories(p.category).forEach(c => allCats.add(c)); }); return [...allCats].sort(); }

  async function triggerSlash(command) { try { const context = getParentWindow().SillyTavern?.getContext?.(); if (context && context.executeSlashCommands) return await context.executeSlashCommands(command); } catch (e) {} return null; }
  async function triggerSlashWithResult(command) { try { const context = getParentWindow().SillyTavern?.getContext?.(); if (context && context.executeSlashCommandsWithOptions) { const result = await context.executeSlashCommandsWithOptions(command, { handleParserErrors: true, parserFlags: {} }); return result?.pipe; } } catch (e) {} return undefined; }

  async function loadData() {
    try {
      const context = getParentWindow().SillyTavern?.getContext?.();
      if (context) {
        const saved = context.extensionSettings?.theaterManagerData;
        if (saved) {
          const parsed = JSON.parse(saved);
          theaterData = { ...theaterData, ...parsed };
          theaterData.prompts = theaterData.prompts.map(p => ({ ...p, category: normalizeCategories(p.category) }));
          if (!theaterData.folders) theaterData.folders = [];
          if (!theaterData.settings) theaterData.settings = { favoriteOnTop: true };
        }
      }
    } catch (e) {}
  }

  async function saveData() { try { const context = getParentWindow().SillyTavern?.getContext?.(); if (context) { if (!context.extensionSettings) context.extensionSettings = {}; context.extensionSettings.theaterManagerData = JSON.stringify(theaterData); context.saveSettingsDebounced?.(); } } catch (e) {} }
  async function updateCurrentInfo() { try { const context = getParentWindow().SillyTavern?.getContext?.(); if (context) { currentCharacter = context.name2 || ''; currentUser = context.name1 || ''; } } catch (e) {} }
  function replaceMacros(text, charValue, userValue) { charValue = charValue !== undefined ? charValue : currentCharacter; userValue = userValue !== undefined ? userValue : currentUser; return text.replace(/\{\{char\}\}/gi, charValue || '角色').replace(/\{\{user\}\}/gi, userValue || '用户'); }
  function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2); }
  function escapeHtml(text) { if (!text) return ''; const div = getParentWindow().document.createElement('div'); div.textContent = text; return div.innerHTML; }
  function formatDate(timestamp) { const date = new Date(timestamp); const now = new Date(); const diff = now - date; if (diff < 60000) return '刚刚'; if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'; if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'; if (diff < 604800000) return Math.floor(diff / 86400000) + '天前'; return `${date.getMonth() + 1}/${date.getDate()}`; }
  function formatDateForFile(timestamp) { const d = new Date(timestamp); return `${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}`; }

  function parseTheaterEntry(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const categoryMatch = trimmed.match(/【([^】]+)】/);
    const categoryStr = categoryMatch ? categoryMatch[1].trim() : null;
    const categories = categoryStr ? parseCategories(categoryStr) : [];
    const content = trimmed.replace(/【[^】]+】/g, '').trim();
    if (!content) return null;
    const lines = content.split('\n');
    const firstLine = lines[0].trim();
    let title, promptContent;
    if (firstLine.length > 15) { promptContent = content; title = content.substring(0, 15) + '...'; }
    else { title = firstLine; promptContent = lines.length > 1 ? lines.slice(1).join('\n').trim() || firstLine : firstLine; }
    return { title, content: promptContent, category: categories };
  }

  function getFilteredPrompts(forGenerate = false) {
    const $ = getJQuery();
    let prompts = theaterData.prompts.filter(p => !p.folderId);
    const searchInputId = forGenerate ? '#tm-genSearchInput' : '#tm-searchInput';
    const categoryFilterId = forGenerate ? '#tm-genCategoryFilter' : '#tm-categoryFilter';
    const searchText = $(searchInputId).val()?.toLowerCase() || '';
    const categoryFilter = $(categoryFilterId).val();
    prompts = prompts.filter(p => {
      if (searchText) {
        const matchTitle = p.title?.toLowerCase().includes(searchText);
        const matchContent = p.content?.toLowerCase().includes(searchText);
        const cats = normalizeCategories(p.category);
        const matchCategory = cats.some(c => c.toLowerCase().includes(searchText));
        if (!matchTitle && !matchContent && !matchCategory) return false;
      }
      if (categoryFilter && !matchesCategory(p.category, categoryFilter)) return false;
      if (!forGenerate && currentTab === 'favorites' && !p.favorite) return false;
      return true;
    });
    prompts.sort((a, b) => {
      if (theaterData.settings.favoriteOnTop) { if (a.favorite && !b.favorite) return -1; if (!a.favorite && b.favorite) return 1; }
      if (a.sortOrder !== undefined && b.sortOrder !== undefined) return a.sortOrder - b.sortOrder;
      return (b.useCount || 0) - (a.useCount || 0);
    });
    return prompts;
  }

  function getFolderPrompts(folderId) { return theaterData.prompts.filter(p => p.folderId === folderId).sort((a, b) => { if (a.sortOrder !== undefined && b.sortOrder !== undefined) return a.sortOrder - b.sortOrder; return (b.useCount || 0) - (a.useCount || 0); }); }

  function applyTheme(themeKey) {
    const $ = getJQuery();
    const theme = themes[themeKey] || themes.dark;
    theaterData.theme = themeKey;
    const modal = $('#theater-manager-modal');
    modal.css('--tm-bg', theme.bg);
    modal.css('--tm-header', theme.header);
    modal.css('--tm-card', theme.card);
    modal.css('--tm-card-hover', theme.cardHover);
    modal.css('--tm-text', theme.text);
    modal.css('--tm-text-muted', theme.textMuted);
    modal.css('--tm-accent', theme.accent);
    modal.css('--tm-category-bg', theme.categoryBg);
    modal.css('--tm-category-text', theme.categoryText);
    saveData();
  }

  function showUndoBar(item) { const $ = getJQuery(); hideUndoBar(); const undoBar = $('#tm-undo-bar'); undoBar.html(`<span class="tm-undo-text">已删除「${escapeHtml(item.title || item.name)}」</span><button class="tm-undo-action-btn">撤销</button><div class="tm-undo-timer">10</div>`).addClass('show'); let countdown = 10; const timerEl = undoBar.find('.tm-undo-timer'); undoTimeout = setInterval(() => { countdown--; timerEl.text(countdown); if (countdown <= 0) { hideUndoBar(); deletedItem = null; } }, 1000); }
  function hideUndoBar() { const $ = getJQuery(); if (undoTimeout) { clearInterval(undoTimeout); undoTimeout = null; } $('#tm-undo-bar').removeClass('show').html(''); }
  async function undoDelete() { if (!deletedItem) return; if (deletedItem.type === 'folder') { theaterData.folders.push(deletedItem.data); } else { theaterData.prompts.push(deletedItem.data); } await saveData(); hideUndoBar(); deletedItem = null; TheaterManager.updateCategoryFilter(); TheaterManager.renderPromptList(); }
  function findDuplicates(entries) { const duplicates = []; const newEntries = []; entries.forEach(entry => { const existing = theaterData.prompts.find(p => p.content.trim() === entry.content.trim()); if (existing) duplicates.push({ entry, existing }); else newEntries.push(entry); }); return { duplicates, newEntries }; }
  async function copyToClipboard(text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { const textarea = document.createElement('textarea'); textarea.value = text; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); document.body.removeChild(textarea); return true; } }
  function renderCategoryTags(categories) { const cats = normalizeCategories(categories); if (cats.length === 0) return ''; return cats.map(c => `<span class="card-category">${escapeHtml(c)}</span>`).join(''); }

  function initDragAndDrop() {
    const $ = getJQuery();
    const doc = $(getParentWindow().document);
    doc.off('.tmDrag');
    doc.on('touchstart.tmDrag mousedown.tmDrag', '.tm-drag-handle', function(e) { e.preventDefault(); const card = $(this).closest('.prompt-card, .folder-card'); draggedItem = card.data('id'); draggedType = card.hasClass('folder-card') ? 'folder' : 'prompt'; card.addClass('dragging'); });
    doc.on('touchmove.tmDrag mousemove.tmDrag', function(e) { if (!draggedItem) return; const touch = e.type === 'touchmove' ? e.originalEvent.touches[0] : e; const target = getParentWindow().document.elementFromPoint(touch.clientX, touch.clientY); const targetCard = $(target).closest('.prompt-card, .folder-card, .folder-drop-zone'); $('.drop-target').removeClass('drop-target'); if (targetCard.length && targetCard.data('id') !== draggedItem) { targetCard.addClass('drop-target'); } });
    doc.on('touchend.tmDrag mouseup.tmDrag', async function(e) { if (!draggedItem) return; const touch = e.type === 'touchend' ? e.originalEvent.changedTouches[0] : e; const target = getParentWindow().document.elementFromPoint(touch.clientX, touch.clientY); const targetCard = $(target).closest('.prompt-card, .folder-card, .folder-drop-zone'); if (targetCard.length && targetCard.data('id') !== draggedItem) { const targetId = targetCard.data('id'); if (draggedType === 'prompt') { if (targetCard.hasClass('folder-card') || targetCard.hasClass('folder-drop-zone')) { const prompt = theaterData.prompts.find(p => p.id === draggedItem); if (prompt) { prompt.folderId = targetId; await saveData(); } } else { await reorderPrompts(draggedItem, targetId); } } else if (draggedType === 'folder') { await reorderFolders(draggedItem, targetId); } } $('.dragging').removeClass('dragging'); $('.drop-target').removeClass('drop-target'); draggedItem = null; draggedType = null; TheaterManager.renderPromptList(); });
  }

  async function reorderPrompts(draggedId, targetId) { const draggedPrompt = theaterData.prompts.find(p => p.id === draggedId); const targetPrompt = theaterData.prompts.find(p => p.id === targetId); if (!draggedPrompt || !targetPrompt) return; const prompts = theaterData.prompts.filter(p => p.folderId === draggedPrompt.folderId); prompts.forEach((p, i) => p.sortOrder = i); const draggedIndex = prompts.findIndex(p => p.id === draggedId); const targetIndex = prompts.findIndex(p => p.id === targetId); prompts.splice(draggedIndex, 1); prompts.splice(targetIndex, 0, draggedPrompt); prompts.forEach((p, i) => p.sortOrder = i); await saveData(); }
  async function reorderFolders(draggedId, targetId) { const draggedIndex = theaterData.folders.findIndex(f => f.id === draggedId); const targetIndex = theaterData.folders.findIndex(f => f.id === targetId); if (draggedIndex === -1 || targetIndex === -1) return; const [folder] = theaterData.folders.splice(draggedIndex, 1); theaterData.folders.splice(targetIndex, 0, folder); theaterData.folders.forEach((f, i) => f.sortOrder = i); await saveData(); }

  const TheaterManager = {
    closeModal() { const $ = getJQuery(); $('#theater-manager-modal, #tm-addModal, #tm-previewModal, #tm-macroModal, #tm-batchEditModal, #tm-categoryPromptModal, #tm-duplicateModal, #tm-singleCategoryModal, #tm-genMacroModal, #tm-titlePromptModal, #tm-singleTitleModal, #tm-folderModal, #tm-moveToFolderModal').remove(); hideUndoBar(); deletedItem = null; batchSelectMode = false; selectedIds.clear(); isGenerating = false; },

    switchTab(tab) { const $ = getJQuery(); currentTab = tab; batchSelectMode = false; selectedIds.clear(); $('#theater-manager-modal .tm-tab').removeClass('active'); $(`#theater-manager-modal .tm-tab[data-tab="${tab}"]`).addClass('active'); this.renderPromptList(); },

    // ★★★ 修复：只在"全部"页面显示文件夹 ★★★
    renderPromptList() {
      const $ = getJQuery();
      if (currentTab === 'stats') { this.renderStats(); return; }
      if (currentTab === 'history') { this.renderHistory(); return; }
      if (currentTab === 'settings') { this.renderSettings(); return; }
      if (currentTab === 'generate') { this.renderGeneratePage(); return; }

      const container = $('#tm-promptList');
      const prompts = getFilteredPrompts();
      const folders = theaterData.folders || [];

      if (batchSelectMode) { $('#tm-batchActions').show(); $('#tm-batchCount').text(selectedIds.size); }
      else { $('#tm-batchActions').hide(); }

      let html = '';

      // ★ 修复：只在"全部"标签页渲染文件夹
      if (currentTab === 'all') {
        folders.forEach(folder => {
          const folderPrompts = getFolderPrompts(folder.id);
          const isExpanded = expandedFolders.has(folder.id);
          html += `
            <div class="folder-card ${isExpanded ? 'expanded' : ''}" data-id="${folder.id}">
              <div class="folder-header" data-folder-id="${folder.id}">
                <span class="tm-drag-handle">☰</span>
                <span class="folder-icon">${isExpanded ? '📂' : '📁'}</span>
                <span class="folder-name">${escapeHtml(folder.name)}</span>
                <span class="folder-count">${folderPrompts.length}</span>
                <div class="folder-actions">
                  <button class="card-btn" data-action="editFolder" data-id="${folder.id}">✏️</button>
                  <button class="card-btn card-btn-danger" data-action="deleteFolder" data-id="${folder.id}">🗑️</button>
                </div>
              </div>
              ${isExpanded ? `<div class="folder-content">${folderPrompts.map(p => this.renderPromptCard(p)).join('')}</div>` : ''}
            </div>
          `;
        });
      }

      if (prompts.length === 0 && (currentTab !== 'all' || folders.length === 0)) {
        html = `<div class="tm-empty">🔍<p>${currentTab === 'favorites' ? '还没有收藏' : '没有找到'}</p></div>`;
      } else {
        html += prompts.map(p => this.renderPromptCard(p)).join('');
      }

      container.html(html);
      initDragAndDrop();
    },

    renderPromptCard(p) {
      return `
        <div class="prompt-card ${p.favorite ? 'favorite' : ''} ${selectedIds.has(p.id) ? 'selected' : ''}" data-id="${p.id}">
          <span class="tm-drag-handle">☰</span>
          ${batchSelectMode ? `<input type="checkbox" class="tm-batch-check" data-id="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''}>` : ''}
          <div class="card-body">
            <div class="card-row-title">
              <span class="card-title">${p.favorite ? '⭐ ' : ''}${escapeHtml(p.title)}</span>
              <div class="card-categories">${renderCategoryTags(p.category)}</div>
            </div>
            <div class="card-row-preview">${escapeHtml(p.content?.substring(0, 100) || '')}${(p.content?.length || 0) > 100 ? '...' : ''}</div>
            <div class="card-row-footer">
              <span class="card-stats">使用${p.useCount || 0}次 ${p.lastUsed ? `· ${formatDate(p.lastUsed)}` : ''}</span>
              <div class="card-btns">
                <button class="card-btn" data-action="toggleFavorite" data-id="${p.id}">${p.favorite ? '⭐' : '☆'}</button>
                <button class="card-btn" data-action="moveToFolder" data-id="${p.id}">📁</button>
                <button class="card-btn" data-action="showPreview" data-id="${p.id}">👁️</button>
                <button class="card-btn" data-action="insertToInput" data-id="${p.id}">📋</button>
                <button class="card-btn" data-action="openEditModal" data-id="${p.id}">✏️</button>
                <button class="card-btn card-btn-danger" data-action="deletePrompt" data-id="${p.id}">🗑️</button>
              </div>
            </div>
          </div>
        </div>
      `;
    },

    openFolderModal(editId = null) { const $ = getJQuery(); $('#tm-folderModal').remove(); const folder = editId ? theaterData.folders.find(f => f.id === editId) : null; $('body').append(`<div id="tm-folderModal" class="tm-modal-overlay"><div class="tm-modal" style="max-width:400px;"><div class="tm-modal-header"><h2>${folder ? '✏️ 编辑文件夹' : '📁 新建文件夹'}</h2><button class="tm-modal-close tm-folder-action" data-action="closeFolderModal">×</button></div><div class="tm-modal-body"><div class="form-group"><label>文件夹名称</label><input type="text" id="tm-folderName" class="form-input" value="${folder ? escapeHtml(folder.name) : ''}" placeholder="输入文件夹名称..."></div></div><div class="tm-modal-footer"><button class="tm-btn tm-btn-secondary tm-folder-action" data-action="closeFolderModal">取消</button><button class="tm-btn tm-btn-primary tm-folder-action" data-action="saveFolder" data-id="${editId || ''}">保存</button></div></div></div>`); $('#tm-folderName').focus(); },
    closeFolderModal() { getJQuery()('#tm-folderModal').remove(); },
    async saveFolder(editId) { const $ = getJQuery(); const name = $('#tm-folderName').val().trim(); if (!name) { alert('请输入文件夹名称'); return; } if (editId) { const folder = theaterData.folders.find(f => f.id === editId); if (folder) folder.name = name; } else { theaterData.folders.push({ id: generateId(), name: name, sortOrder: theaterData.folders.length, createdAt: Date.now() }); } await saveData(); this.closeFolderModal(); this.renderPromptList(); },
    editFolder(id) { this.openFolderModal(id); },
    async deleteFolder(id) { const folder = theaterData.folders.find(f => f.id === id); if (!folder) return; const folderPrompts = theaterData.prompts.filter(p => p.folderId === id); if (folderPrompts.length > 0) { if (!confirm(`文件夹内有 ${folderPrompts.length} 个小剧场，删除后将移出文件夹。确定删除？`)) return; folderPrompts.forEach(p => delete p.folderId); } deletedItem = { type: 'folder', data: { ...folder } }; theaterData.folders = theaterData.folders.filter(f => f.id !== id); await saveData(); this.renderPromptList(); showUndoBar({ name: folder.name }); },
    toggleFolder(id) { if (expandedFolders.has(id)) { expandedFolders.delete(id); } else { expandedFolders.add(id); } this.renderPromptList(); },
    moveToFolder(promptId) { const $ = getJQuery(); const prompt = theaterData.prompts.find(p => p.id === promptId); if (!prompt) return; $('#tm-moveToFolderModal').remove(); const folders = theaterData.folders || []; $('body').append(`<div id="tm-moveToFolderModal" class="tm-modal-overlay"><div class="tm-modal" style="max-width:400px;"><div class="tm-modal-header"><h2>📁 移动到文件夹</h2><button class="tm-modal-close tm-move-action" data-action="closeMoveModal">×</button></div><div class="tm-modal-body"><p style="margin-bottom:12px;color:var(--tm-text-muted);">「${escapeHtml(prompt.title)}」</p><div class="folder-select-list"><div class="folder-select-item ${!prompt.folderId ? 'active' : ''}" data-folder-id=""><span>📋 不在文件夹中</span></div>${folders.map(f => `<div class="folder-select-item ${prompt.folderId === f.id ? 'active' : ''}" data-folder-id="${f.id}"><span>📁 ${escapeHtml(f.name)}</span><span class="folder-select-count">${getFolderPrompts(f.id).length}</span></div>`).join('')}</div></div><div class="tm-modal-footer"><button class="tm-btn tm-btn-secondary tm-move-action" data-action="closeMoveModal">取消</button></div></div></div>`); $('#tm-moveToFolderModal').on('click', '.folder-select-item', async function() { const folderId = $(this).data('folder-id'); if (folderId) { prompt.folderId = folderId; } else { delete prompt.folderId; } await saveData(); TheaterManager.closeMoveModal(); TheaterManager.renderPromptList(); }); },
    closeMoveModal() { getJQuery()('#tm-moveToFolderModal').remove(); },

    renderGeneratePage() { const $ = getJQuery(); const container = $('#tm-promptList'); const categories = getAllCategories(); container.html(`<div class="gen-page"><div class="gen-toolbar"><input type="text" id="tm-genSearchInput" placeholder="🔍 搜索小剧场..."><select id="tm-genCategoryFilter"><option value="">全部分类</option>${categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select></div><div id="tm-genPromptList" class="gen-prompt-list"></div><div id="tm-genResultArea" class="gen-result-area" style="display:none;"><div class="gen-result-header"><h3>🎬 演绎结果</h3><div class="gen-result-btns"><button class="tm-btn tm-btn-small tm-btn-secondary tm-gen-action" data-action="backToList">← 返回</button></div></div><div id="tm-genResultContent" class="gen-result-content"></div><div id="tm-genResultActions" class="gen-result-actions" style="display:none;"><button class="tm-btn tm-btn-secondary tm-gen-action" data-action="copyResult">📋 复制</button><button class="tm-btn tm-btn-secondary tm-gen-action" data-action="insertResultToInput">📝 插入输入框</button><button class="tm-btn tm-btn-primary tm-gen-action" data-action="regenerate">🔄 重新演绎</button></div></div></div>`); this.renderGenPromptList(); },
    renderGenPromptList() { const $ = getJQuery(); const container = $('#tm-genPromptList'); const prompts = getFilteredPrompts(true); if (prompts.length === 0) { container.html(`<div class="tm-empty-small">没有找到小剧场</div>`); return; } container.html(prompts.map(p => `<div class="gen-prompt-card ${p.favorite ? 'favorite' : ''}" data-id="${p.id}"><div class="gen-card-info"><div class="gen-card-title">${p.favorite ? '⭐ ' : ''}${escapeHtml(p.title)}</div><div class="gen-card-categories">${renderCategoryTags(p.category)}</div><div class="gen-card-preview">${escapeHtml(p.content?.substring(0, 60) || '')}${(p.content?.length || 0) > 60 ? '...' : ''}</div></div><div class="gen-card-btns"><button class="tm-btn tm-btn-small tm-btn-secondary tm-gen-action" data-action="previewBeforeGen" data-id="${p.id}">👁️</button><button class="tm-btn tm-btn-small tm-btn-primary tm-gen-action" data-action="startGenerate" data-id="${p.id}">🎬 演绎</button></div></div>`).join('')); },
    filterGenPrompts() { this.renderGenPromptList(); },
    previewBeforeGen(id) { this.showPreview(id); },
    showGenMacroModal(id) { const $ = getJQuery(); const prompt = theaterData.prompts.find(p => p.id === id); if (!prompt) return; $('#tm-genMacroModal').remove(); $('body').append(`<div id="tm-genMacroModal" class="tm-modal-overlay"><div class="tm-modal" style="max-width:500px;"><div class="tm-modal-header"><h2>🎬 后台演绎</h2><button class="tm-modal-close tm-gen-macro-action" data-action="closeGenMacroModal">×</button></div><div class="tm-modal-body"><p style="margin-bottom:12px;font-weight:600;color:var(--tm-text);">${escapeHtml(prompt.title)}</p><div class="form-group"><label>角色名 →</label><input type="text" id="tm-genMacroChar" class="form-input" value="${escapeHtml(currentCharacter || '角色')}"></div><div class="form-group"><label>用户名 →</label><input type="text" id="tm-genMacroUser" class="form-input" value="${escapeHtml(currentUser || '用户')}"></div><div class="form-group"><label>预览</label><div id="tm-genMacroPreview" class="preview-box preview-small">${escapeHtml(replaceMacros(prompt.content))}</div></div></div><div class="tm-modal-footer"><button class="tm-btn tm-btn-secondary tm-gen-macro-action" data-action="closeGenMacroModal">取消</button><button class="tm-btn tm-btn-primary tm-gen-macro-action" data-action="confirmGenerate" data-id="${id}">🎬 开始演绎</button></div></div></div>`); const updatePreview = () => { $('#tm-genMacroPreview').text(replaceMacros(prompt.content, $('#tm-genMacroChar').val(), $('#tm-genMacroUser').val())); }; $('#tm-genMacroChar, #tm-genMacroUser').on('input', updatePreview); },
    closeGenMacroModal() { getJQuery()('#tm-genMacroModal').remove(); },
    startGenerate(id) { this.showGenMacroModal(id); },
    async confirmGenerate(id) { const $ = getJQuery(); const prompt = theaterData.prompts.find(p => p.id === id); if (!prompt) return; const charVal = $('#tm-genMacroChar').val(); const userVal = $('#tm-genMacroUser').val(); const processedContent = replaceMacros(prompt.content, charVal, userVal); this.closeGenMacroModal(); currentGenerationPromptId = id; $('#tm-genPromptList').hide(); $('.gen-toolbar').hide(); $('#tm-genResultArea').show(); $('#tm-genResultActions').hide(); $('#tm-genResultContent').html(`<div class="gen-loading"><div class="gen-loading-spinner"></div><p>正在演绎中...</p><p class="gen-loading-tip">「${escapeHtml(prompt.title)}」</p></div>`); isGenerating = true; try { const result = await triggerSlashWithResult(`/gen lock=on ${processedContent}`); isGenerating = false; if (result) { theaterData.generationHistory = theaterData.generationHistory || []; theaterData.generationHistory.unshift({ promptId: id, promptTitle: prompt.title, input: processedContent, output: result, time: Date.now() }); theaterData.generationHistory = theaterData.generationHistory.slice(0, 50); await saveData(); this.recordUsage(id); $('#tm-genResultContent').html(`<div class="gen-success"><div class="gen-success-header"><span class="gen-success-icon">✨</span><span>演绎完成</span></div><div class="gen-output-box">${escapeHtml(result)}</div></div>`); $('#tm-genResultActions').show(); getParentWindow()._tmLastGenResult = result; } else { $('#tm-genResultContent').html(`<div class="gen-error"><span class="gen-error-icon">⚠️</span><p>演绎失败或返回为空</p></div>`); } } catch (e) { isGenerating = false; $('#tm-genResultContent').html(`<div class="gen-error"><span class="gen-error-icon">❌</span><p>演绎出错</p></div>`); } },
    backToList() { const $ = getJQuery(); $('#tm-genResultArea').hide(); $('#tm-genPromptList').show(); $('.gen-toolbar').show(); currentGenerationPromptId = null; },
    async copyResult() { const result = getParentWindow()._tmLastGenResult; if (result) { await copyToClipboard(result); alert('✅ 已复制'); } },
    async insertResultToInput() { const result = getParentWindow()._tmLastGenResult; if (result) { await triggerSlash(`/setinput ${result}`); this.closeModal(); } },
    regenerate() { if (currentGenerationPromptId) this.startGenerate(currentGenerationPromptId); },

    renderHistory() { const $ = getJQuery(); const container = $('#tm-promptList'); const history = theaterData.history || []; if (history.length === 0) { container.html(`<div class="tm-empty">🕐<p>还没有使用历史</p></div>`); return; } const grouped = {}; history.slice(0, 30).forEach(h => { const prompt = theaterData.prompts.find(p => p.id === h.promptId); if (!prompt) return; const date = new Date(h.time); const key = `${date.getMonth() + 1}月${date.getDate()}日`; if (!grouped[key]) grouped[key] = []; grouped[key].push({ ...h, prompt }); }); let html = ''; for (const [date, items] of Object.entries(grouped)) { html += `<div class="history-group"><div class="history-date">${date}</div>`; items.forEach(item => { html += `<div class="history-item"><div class="history-info"><div class="history-title">${escapeHtml(item.prompt.title)}</div><div class="history-time">${new Date(item.time).toLocaleTimeString('zh-CN', {hour: '2-digit', minute:'2-digit'})}</div></div><div class="history-btns"><button class="card-btn" data-action="showPreview" data-id="${item.prompt.id}">👁️</button><button class="card-btn" data-action="insertToInput" data-id="${item.prompt.id}">📋</button></div></div>`; }); html += `</div>`; } container.html(html); },

    renderStats() { const $ = getJQuery(); const container = $('#tm-promptList'); const prompts = theaterData.prompts; const totalPrompts = prompts.length; const totalUses = prompts.reduce((sum, p) => sum + (p.useCount || 0), 0); const favorites = prompts.filter(p => p.favorite).length; const folders = theaterData.folders?.length || 0; const categoryStats = {}; prompts.forEach(p => { const cats = normalizeCategories(p.category); if (cats.length === 0) { if (!categoryStats['未分类']) categoryStats['未分类'] = { count: 0, uses: 0 }; categoryStats['未分类'].count++; categoryStats['未分类'].uses += p.useCount || 0; } else { cats.forEach(cat => { if (!categoryStats[cat]) categoryStats[cat] = { count: 0, uses: 0 }; categoryStats[cat].count++; categoryStats[cat].uses += p.useCount || 0; }); } }); const sortedCategories = Object.entries(categoryStats).sort((a, b) => b[1].uses - a[1].uses).slice(0, 8); const maxUses = Math.max(...sortedCategories.map(c => c[1].uses), 1); const topUsed = [...prompts].sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).slice(0, 5); container.html(`<div class="stats-grid"><div class="stat-card"><div class="stat-value">${totalPrompts}</div><div class="stat-label">总数量</div></div><div class="stat-card"><div class="stat-value">${totalUses}</div><div class="stat-label">总使用</div></div><div class="stat-card"><div class="stat-value">${favorites}</div><div class="stat-label">收藏</div></div><div class="stat-card"><div class="stat-value">${folders}</div><div class="stat-label">文件夹</div></div></div><div class="stats-section"><h3>📊 分类分布</h3><div class="category-bars">${sortedCategories.map(([cat, data]) => `<div class="category-bar-item"><div class="category-bar-label">${escapeHtml(cat)}</div><div class="category-bar-track"><div class="category-bar-fill" style="width:${(data.uses/maxUses*100)}%"></div></div><div class="category-bar-value">${data.uses}次</div></div>`).join('')}</div></div><div class="stats-section"><h3>🏆 最常使用</h3>${topUsed.length > 0 ? topUsed.map((p, i) => `<div class="top-item"><div class="top-rank">${['🥇','🥈','🥉','4','5'][i]}</div><div class="top-info"><div class="top-title">${escapeHtml(p.title)}</div><div class="top-stats">${p.useCount || 0}次</div></div><button class="card-btn" data-action="showPreview" data-id="${p.id}">👁️</button></div>`).join('') : '<div class="tm-empty-small">还没有使用记录</div>'}</div>`); },

    renderSettings() { const $ = getJQuery(); const container = $('#tm-promptList'); const currentTheme = theaterData.theme || 'dark'; const favoriteOnTop = theaterData.settings?.favoriteOnTop !== false; container.html(`<div class="settings-page"><div class="settings-section"><h3>⚙️ 排序设置</h3><div class="settings-toggle"><label class="toggle-label"><input type="checkbox" id="tm-favoriteOnTop" ${favoriteOnTop ? 'checked' : ''}><span class="toggle-text">收藏自动置顶</span></label><p class="toggle-desc">关闭后收藏不再置顶，按使用频率排序</p></div></div><div class="settings-section"><h3>🎨 主题切换</h3><div class="theme-grid">${Object.entries(themes).map(([key, theme]) => `<div class="theme-card ${currentTheme === key ? 'active' : ''}" data-theme="${key}"><div class="theme-preview" style="background:${theme.bg}"><div class="theme-preview-header" style="background:${theme.header}"></div></div><div class="theme-name">${theme.name}</div></div>`).join('')}</div></div><div class="settings-section"><h3>💾 数据管理</h3><div class="settings-btns"><button class="tm-btn tm-btn-primary tm-setting-action" data-action="exportToJSON">📤 导出</button><button class="tm-btn tm-btn-secondary tm-setting-action" data-action="importFromJSON">📥 恢复</button></div></div><div class="settings-section"><h3>ℹ️ 关于</h3><div class="about-info"><p>🎭 小剧场管理器 v14.0</p><p class="about-muted">文件夹 | 拖动排序 | 多分类</p></div></div></div>`); $('#tm-favoriteOnTop').on('change', async function() { theaterData.settings.favoriteOnTop = $(this).is(':checked'); await saveData(); }); },

    updateCategoryFilter() { const $ = getJQuery(); const categories = getAllCategories(); $('#tm-categoryFilter').html('<option value="">全部分类</option>' + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')); },
    filterPrompts() { this.renderPromptList(); },
    randomPick() { const prompts = getFilteredPrompts(); if (prompts.length === 0) { alert('没有可选的小剧场~'); return; } this.showPreview(prompts[Math.floor(Math.random() * prompts.length)].id); },
    toggleBatchMode() { const $ = getJQuery(); batchSelectMode = !batchSelectMode; selectedIds.clear(); $('#tm-batchModeBtn').toggleClass('active', batchSelectMode); this.renderPromptList(); },
    toggleSelect(id) { if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id); this.renderPromptList(); },
    toggleSelectAll() { const prompts = getFilteredPrompts(); if (selectedIds.size === prompts.length) selectedIds.clear(); else prompts.forEach(p => selectedIds.add(p.id)); this.renderPromptList(); },

    openBatchEditModal() { if (selectedIds.size === 0) { alert('请先选择'); return; } const $ = getJQuery(); $('#tm-batchEditModal').remove(); const categories = getAllCategories(); $('body').append(`<div id="tm-batchEditModal" class="tm-modal-overlay"><div class="tm-modal" style="max-width:400px;"><div class="tm-modal-header"><h2>📁 批量修改</h2><button class="tm-modal-close tm-batch-action" data-action="closeBatchEdit">×</button></div><div class="tm-modal-body"><p style="margin-bottom:16px;">已选择 <strong style="color:var(--tm-accent);">${selectedIds.size}</strong> 个</p><div class="form-group"><label>分类</label><select id="tm-batchCategorySelect" class="form-input" style="margin-bottom:8px;"><option value="">-- 选择 --</option>${categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select><input type="text" id="tm-batchCategoryInput" class="form-input" placeholder="或输入新分类..."></div><div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="tm-batchAddMode"> 追加模式</label></div></div><div class="tm-modal-footer"><button class="tm-btn tm-btn-secondary tm-batch-action" data-action="closeBatchEdit">取消</button><button class="tm-btn tm-btn-primary tm-batch-action" data-action="applyBatchCategory">应用</button></div></div></div>`); $('#tm-batchCategorySelect').on('change', function() { const current = $('#tm-batchCategoryInput').val(); const selected = $(this).val(); if (selected) { if (current && !current.includes(selected)) $('#tm-batchCategoryInput').val(current + ', ' + selected); else if (!current) $('#tm-batchCategoryInput').val(selected); } }); },
    closeBatchEdit() { getJQuery()('#tm-batchEditModal').remove(); },
    async applyBatchCategory() { const $ = getJQuery(); const categoryInput = $('#tm-batchCategoryInput').val().trim(); const addMode = $('#tm-batchAddMode').is(':checked'); if (!categoryInput) { alert('请输入分类'); return; } const newCats = parseCategories(categoryInput); const count = selectedIds.size; selectedIds.forEach(id => { const prompt = theaterData.prompts.find(p => p.id === id); if (prompt) { if (addMode) { const existing = normalizeCategories(prompt.category); prompt.category = [...new Set([...existing, ...newCats])]; } else { prompt.category = newCats; } } }); await saveData(); this.closeBatchEdit(); batchSelectMode = false; selectedIds.clear(); this.updateCategoryFilter(); this.renderPromptList(); alert(`✅ 已修改 ${count} 个`); },
    async batchDelete() { if (selectedIds.size === 0) return; if (!confirm(`确定删除 ${selectedIds.size} 个？`)) return; theaterData.prompts = theaterData.prompts.filter(p => !selectedIds.has(p.id)); await saveData(); batchSelectMode = false; selectedIds.clear(); this.updateCategoryFilter(); this.renderPromptList(); },

    showMacroEditor(id, action) { const $ = getJQuery(); const prompt = theaterData.prompts.find(p => p.id === id); if (!prompt) return; $('#tm-macroModal').remove(); $('body').append(`<div id="tm-macroModal" class="tm-modal-overlay"><div class="tm-modal" style="max-width:500px;"><div class="tm-modal-header"><h2>✏️ 宏替换</h2><button class="tm-modal-close tm-macro-action" data-action="closeMacroEditor">×</button></div><div class="tm-modal-body"><div class="form-group"><label>角色名 →</label><input type="text" id="tm-macroChar" class="form-input" value="${escapeHtml(currentCharacter || '角色')}"></div><div class="form-group"><label>用户名 →</label><input type="text" id="tm-macroUser" class="form-input" value="${escapeHtml(currentUser || '用户')}"></div><div class="form-group"><label>预览</label><div id="tm-macroPreview" class="preview-box preview-small">${escapeHtml(replaceMacros(prompt.content))}</div></div></div><div class="tm-modal-footer"><button class="tm-btn tm-btn-secondary tm-macro-action" data-action="closeMacroEditor">取消</button><button class="tm-btn tm-btn-primary tm-macro-action" data-action="${action === 'insert' ? 'confirmMacroInsert' : 'confirmMacroSend'}" data-id="${id}">${action === 'insert' ? '📋 插入' : '📤 发送'}</button></div></div></div>`); const updatePreview = () => { $('#tm-macroPreview').text(replaceMacros(prompt.content, $('#tm-macroChar').val(), $('#tm-macroUser').val())); }; $('#tm-macroChar, #tm-macroUser').on('input', updatePreview); },
    closeMacroEditor() { getJQuery()('#tm-macroModal').remove(); },
    async confirmMacroInsert(id) { const $ = getJQuery(); const prompt = theaterData.prompts.find(p => p.id === id); if (!prompt) return; const content = replaceMacros(prompt.content, $('#tm-macroChar').val(), $('#tm-macroUser').val()); await triggerSlash(`/setinput ${content}`); this.recordUsage(id); this.closeMacroEditor(); this.closeModal(); },
    async confirmMacroSend(id) { const $ = getJQuery(); const prompt = theaterData.prompts.find(p => p.id === id); if (!prompt) return; const content = replaceMacros(prompt.content, $('#tm-macroChar').val(), $('#tm-macroUser').val()); await triggerSlash(`/send ${content}`); await triggerSlash('/trigger'); this.recordUsage(id); this.closeMacroEditor(); this.closeModal(); },

    showPreview(id) { const $ = getJQuery(); const prompt = theaterData.prompts.find(p => p.id === id); if (!prompt) return; const cats = normalizeCategories(prompt.category); $('#tm-previewModal').remove(); $('body').append(`<div id="tm-previewModal" class="tm-modal-overlay"><div class="tm-modal" style="max-width:600px;"><div class="tm-modal-header"><h2>👁️ ${escapeHtml(prompt.title)}</h2><button class="tm-modal-close tm-preview-action" data-action="closePreview">×</button></div><div class="tm-modal-body">${cats.length > 0 ? `<div style="margin-bottom:12px;" class="preview-categories">${cats.map(c => `<span class="card-category">${escapeHtml(c)}</span>`).join('')}</div>` : ''}<div class="form-group"><label>内容</label><textarea id="tm-previewContent" class="form-input form-textarea">${escapeHtml(prompt.content)}</textarea></div></div><div class="tm-modal-footer"><button class="tm-btn tm-btn-secondary tm-preview-action" data-action="closePreview">关闭</button><button class="tm-btn tm-btn-success tm-preview-action" data-action="insertFromPreviewWithMacro" data-id="${id}">📋 插入</button><button class="tm-btn tm-btn-primary tm-preview-action" data-action="sendFromPreviewWithMacro" data-id="${id}">📤 发送</button></div></div></div>`); },
    closePreview() { getJQuery()('#tm-previewModal').remove(); },
    insertFromPreviewWithMacro(id) { const $ = getJQuery(); const content = $('#tm-previewContent').val(); const prompt = theaterData.prompts.find(p => p.id === id); if (prompt) { const orig = prompt.content; prompt.content = content; this.closePreview(); this.showMacroEditor(id, 'insert'); prompt.content = orig; } },
    sendFromPreviewWithMacro(id) { const $ = getJQuery(); const content = $('#tm-previewContent').val(); const prompt = theaterData.prompts.find(p => p.id === id); if (prompt) { const orig = prompt.content; prompt.content = content; this.closePreview(); this.showMacroEditor(id, 'send'); prompt.content = orig; } },

    openAddModal() { const $ = getJQuery(); currentEditId = null; currentFavorite = false; $('#tm-modalTitle').text('➕ 添加'); $('#tm-promptTitle').val(''); $('#tm-promptCategory').val(''); $('#tm-promptContent').val(''); this.updateFavoriteBtn(); $('#tm-addModal').removeClass('hidden'); },
    openEditModal(id) { const $ = getJQuery(); const prompt = theaterData.prompts.find(p => p.id === id); if (!prompt) return; currentEditId = id; currentFavorite = prompt.favorite || false; $('#tm-modalTitle').text('✏️ 编辑'); $('#tm-promptTitle').val(prompt.title); $('#tm-promptCategory').val(categoriesToString(prompt.category)); $('#tm-promptContent').val(prompt.content); this.updateFavoriteBtn(); $('#tm-addModal').removeClass('hidden'); },
    toggleAddFavorite() { currentFavorite = !currentFavorite; this.updateFavoriteBtn(); },
    updateFavoriteBtn() { const $ = getJQuery(); $('#tm-favoriteBtn').toggleClass('active', currentFavorite).text(currentFavorite ? '⭐' : '☆'); },
    closeAddModal() { getJQuery()('#tm-addModal').addClass('hidden'); currentEditId = null; currentFavorite = false; },
    async savePrompt() { const $ = getJQuery(); const title = $('#tm-promptTitle').val().trim(); const content = $('#tm-promptContent').val().trim(); if (!title || !content) { alert('请填写标题和内容！'); return; } const categoryInput = $('#tm-promptCategory').val().trim(); const categories = parseCategories(categoryInput); if (currentEditId) { const index = theaterData.prompts.findIndex(p => p.id === currentEditId); if (index !== -1) theaterData.prompts[index] = { ...theaterData.prompts[index], title, content, category: categories, favorite: currentFavorite, updatedAt: Date.now() }; } else { theaterData.prompts.push({ id: generateId(), title, content, category: categories, favorite: currentFavorite, useCount: 0, createdAt: Date.now(), updatedAt: Date.now() }); } await saveData(); this.closeAddModal(); this.updateCategoryFilter(); this.renderPromptList(); },

    async deletePrompt(id) { const prompt = theaterData.prompts.find(p => p.id === id); if (!prompt) return; deletedItem = { type: 'prompt', data: { ...prompt } }; theaterData.prompts = theaterData.prompts.filter(p => p.id !== id); await saveData(); this.updateCategoryFilter(); this.renderPromptList(); showUndoBar(prompt); },

    async toggleFavorite(id) { const prompt = theaterData.prompts.find(p => p.id === id); if (prompt) { prompt.favorite = !prompt.favorite; await saveData(); this.renderPromptList(); } },
    insertToInput(id) { this.showMacroEditor(id, 'insert'); },
    async recordUsage(id) { const prompt = theaterData.prompts.find(p => p.id === id); if (prompt) { prompt.useCount = (prompt.useCount || 0) + 1; prompt.lastUsed = Date.now(); } theaterData.history = theaterData.history || []; theaterData.history.unshift({ promptId: id, time: Date.now() }); theaterData.history = theaterData.history.slice(0, 100); await saveData(); },

    exportToJSON() { const dataStr = JSON.stringify(theaterData, null, 2); const blob = new Blob([dataStr], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = getParentWindow().document.createElement('a'); a.href = url; a.download = `小剧场备份_${formatDateForFile(Date.now())}.json`; a.click(); URL.revokeObjectURL(url); },
    importFromJSON() { getJQuery()('#tm-jsonFileInput').trigger('click'); },
    handleJSONImport(event) { const file = event.target.files[0]; if (!file) return; const self = this; const reader = new FileReader(); reader.onload = async (e) => { try { const imported = JSON.parse(e.target.result); if (imported.prompts && Array.isArray(imported.prompts)) { const existingIds = new Set(theaterData.prompts.map(p => p.id)); const newPrompts = imported.prompts.filter(p => !existingIds.has(p.id)).map(p => ({ ...p, category: normalizeCategories(p.category) })); theaterData.prompts = [...theaterData.prompts, ...newPrompts]; if (imported.folders) { const existingFolderIds = new Set(theaterData.folders.map(f => f.id)); const newFolders = imported.folders.filter(f => !existingFolderIds.has(f.id)); theaterData.folders = [...theaterData.folders, ...newFolders]; } await saveData(); self.updateCategoryFilter(); self.renderPromptList(); alert(`✅ 恢复 ${newPrompts.length} 个`); } else { alert('❌ 无效格式'); } } catch (err) { alert('❌ 导入失败: ' + err.message); } }; reader.readAsText(file); event.target.value = ''; },

    importFromTxt() { getJQuery()('#tm-txtFileInput').trigger('click'); },
    handleTxtImport(event) { const file = event.target.files[0]; if (!file) return; const self = this; const reader = new FileReader(); reader.onload = async (e) => { const content = e.target.result; const blocks = content.split('$').filter(b => b.trim()); if (blocks.length === 0) { alert('❌ 未找到有效内容'); return; } const entriesWithCategory = []; const entriesWithoutCategory = []; for (const block of blocks) { const parsed = parseTheaterEntry(block); if (parsed) { if (parsed.category && parsed.category.length > 0) entriesWithCategory.push(parsed); else entriesWithoutCategory.push(parsed); } } if (entriesWithCategory.length === 0 && entriesWithoutCategory.length === 0) { alert('❌ 无法解析内容'); return; } const allEntries = [...entriesWithCategory, ...entriesWithoutCategory]; const { duplicates, newEntries } = findDuplicates(allEntries); getParentWindow()._tmAllNewEntries = newEntries; getParentWindow()._tmEntriesWithCategory = entriesWithCategory.filter(e => !duplicates.find(d => d.entry === e)); getParentWindow()._tmEntriesWithoutCategory = entriesWithoutCategory.filter(e => !duplicates.find(d => d.entry === e)); if (duplicates.length > 0) { self.showDuplicateModal(duplicates, newEntries, entriesWithCategory.filter(e => !duplicates.find(d => d.entry === e)).length); } else { if (entriesWithoutCategory.length > 0) { self.showCategoryPrompt(entriesWithCategory.length, entriesWithoutCategory); } else { self.showTitlePrompt(entriesWithCategory); } } }; reader.readAsText(file); event.target.value = ''; },

    showTitlePrompt(entries) { const $ = getJQuery(); $('#tm-titlePromptModal').remove(); getParentWindow()._tmTitleEntries = entries; $('body').append(`<div id="tm-titlePromptModal" class="tm-modal-overlay"><div class="tm-modal" style="max-width:420px;"><div class="tm-modal-header"><h2>📝 标题设置</h2><button class="tm-modal-close tm-title-action" data-action="closeTitlePrompt">×</button></div><div class="tm-modal-body"><p>共 <strong style="color:var(--tm-accent);">${entries.length}</strong> 个待导入</p></div><div class="tm-modal-footer" style="flex-direction:column;gap:8px;"><button class="tm-btn tm-btn-secondary tm-title-action" data-action="skipAllTitles" style="width:100%;">📋 保持原标题</button><button class="tm-btn tm-btn-primary tm-title-action" data-action="startTitleEdit" style="width:100%;">✏️ 逐个修改</button><button class="tm-btn tm-btn-secondary tm-title-action" data-action="closeTitlePrompt" style="width:100%;margin-top:4px;">❌ 取消</button></div></div></div>`); },
    closeTitlePrompt() { getJQuery()('#tm-titlePromptModal, #tm-singleTitleModal').remove(); getParentWindow()._tmTitleEntries = null; },
    async skipAllTitles() { const entries = getParentWindow()._tmTitleEntries || []; this.closeTitlePrompt(); await this.importEntriesDirectly(entries); },
    startTitleEdit() { getParentWindow()._tmTitleIndex = 0; this.showSingleTitleModal(); },
    showSingleTitleModal() { const $ = getJQuery(); const entries = getParentWindow()._tmTitleEntries || []; const currentIndex = getParentWindow()._tmTitleIndex || 0; if (currentIndex >= entries.length) { this.finishTitleEdit(); return; } const entry = entries[currentIndex]; $('#tm-titlePromptModal').hide(); $('#tm-singleTitleModal').remove(); $('body').append(`<div id="tm-singleTitleModal" class="tm-modal-overlay"><div class="tm-modal" style="max-width:500px;"><div class="tm-modal-header"><h2>✏️ 编辑 (${currentIndex + 1}/${entries.length})</h2><button class="tm-modal-close tm-single-title-action" data-action="skipRestTitles">×</button></div><div class="tm-modal-body"><div class="form-group"><label>标题</label><input type="text" id="tm-editTitle" class="form-input" value="${escapeHtml(entry.title)}"></div><div class="form-group"><label>预览</label><div class="preview-box preview-small">${escapeHtml(entry.content.substring(0, 200))}</div></div></div><div class="tm-modal-footer"><button class="tm-btn tm-btn-secondary tm-single-title-action" data-action="skipRestTitles">跳过剩余</button><button class="tm-btn tm-btn-secondary tm-single-title-action" data-action="skipThisTitle">跳过</button><button class="tm-btn tm-btn-primary tm-single-title-action" data-action="confirmThisTitle">确认 →</button></div></div></div>`); $('#tm-editTitle').focus(); },
    confirmThisTitle() { const $ = getJQuery(); const entries = getParentWindow()._tmTitleEntries || []; const currentIndex = getParentWindow()._tmTitleIndex || 0; const newTitle = $('#tm-editTitle').val().trim(); if (newTitle) entries[currentIndex].title = newTitle; getParentWindow()._tmTitleIndex = currentIndex + 1; this.showSingleTitleModal(); },
    skipThisTitle() { getParentWindow()._tmTitleIndex = (getParentWindow()._tmTitleIndex || 0) + 1; this.showSingleTitleModal(); },
    skipRestTitles() { this.finishTitleEdit(); },
    async finishTitleEdit() { const entries = getParentWindow()._tmTitleEntries || []; getJQuery()('#tm-titlePromptModal, #tm-singleTitleModal').remove(); await this.importEntriesDirectly(entries); },
    async importEntriesDirectly(entries) { for (const entry of entries) { const cats = entry.category && entry.category.length > 0 ? entry.category : ['未分类']; theaterData.prompts.push({ id: generateId(), title: entry.title, content: entry.content, category: cats, favorite: false, useCount: 0, createdAt: Date.now() }); } await saveData(); this.updateCategoryFilter(); this.renderPromptList(); alert(`✅ 成功导入 ${entries.length} 个！`); },

    showDuplicateModal(duplicates, newEntries, alreadyImported) { const $ = getJQuery(); $('#tm-duplicateModal').remove(); getParentWindow()._tmDuplicates = duplicates; getParentWindow()._tmNewEntries = newEntries; $('body').append(`<div id="tm-duplicateModal" class="tm-modal-overlay"><div class="tm-modal" style="max-width:520px;"><div class="tm-modal-header"><h2>🔍 检测到重复</h2><button class="tm-modal-close tm-duplicate-action" data-action="closeDuplicateModal">×</button></div><div class="tm-modal-body"><p>发现 <strong style="color:#ff6b6b;">${duplicates.length}</strong> 个重复，${newEntries.length} 个新内容</p></div><div class="tm-modal-footer" style="flex-direction:column;gap:8px;"><button class="tm-btn tm-btn-secondary tm-duplicate-action" data-action="skipDuplicates" style="width:100%;">⏭️ 跳过重复 (${newEntries.length}个)</button><button class="tm-btn tm-btn-primary tm-duplicate-action" data-action="overwriteDuplicates" style="width:100%;">🔄 覆盖 (${duplicates.length + newEntries.length}个)</button><button class="tm-btn tm-btn-secondary tm-duplicate-action" data-action="closeDuplicateModal" style="width:100%;margin-top:4px;">❌ 取消</button></div></div></div>`); },
    closeDuplicateModal() { getJQuery()('#tm-duplicateModal').remove(); getParentWindow()._tmDuplicates = null; getParentWindow()._tmNewEntries = null; },
    async skipDuplicates() { const newEntries = getParentWindow()._tmNewEntries || []; this.closeDuplicateModal(); if (newEntries.length === 0) { alert(`✅ 没有新内容`); this.renderPromptList(); return; } const needCategory = newEntries.filter(e => !e.category || e.category.length === 0); if (needCategory.length > 0) { this.showCategoryPrompt(newEntries.filter(e => e.category && e.category.length > 0).length, needCategory); } else { this.showTitlePrompt(newEntries); } },
    async overwriteDuplicates() { const duplicates = getParentWindow()._tmDuplicates || []; const newEntries = getParentWindow()._tmNewEntries || []; this.closeDuplicateModal(); duplicates.forEach(d => { const index = theaterData.prompts.findIndex(p => p.id === d.existing.id); if (index !== -1) { theaterData.prompts[index] = { ...theaterData.prompts[index], title: d.entry.title, content: d.entry.content, category: d.entry.category && d.entry.category.length > 0 ? d.entry.category : theaterData.prompts[index].category, updatedAt: Date.now() }; } }); await saveData(); if (newEntries.length > 0) { const needCategory = newEntries.filter(e => !e.category || e.category.length === 0); if (needCategory.length > 0) { this.showCategoryPrompt(duplicates.length + newEntries.filter(e => e.category && e.category.length > 0).length, needCategory); } else { getParentWindow()._tmTitleEntries = newEntries; this.showTitlePrompt(newEntries); } } else { this.updateCategoryFilter(); this.renderPromptList(); alert(`✅ 已覆盖 ${duplicates.length} 个`); } },

    showCategoryPrompt(alreadyImportedCount, entriesWithoutCategory) { const $ = getJQuery(); $('#tm-categoryPromptModal').remove(); getParentWindow()._tmPendingEntries = entriesWithoutCategory; getParentWindow()._tmAlreadyImported = alreadyImportedCount; $('body').append(`<div id="tm-categoryPromptModal" class="tm-modal-overlay"><div class="tm-modal" style="max-width:420px;"><div class="tm-modal-header"><h2>📂 分类设置</h2><button class="tm-modal-close tm-category-action" data-action="closeCategoryPrompt">×</button></div><div class="tm-modal-body">${alreadyImportedCount > 0 ? `<p style="color:#51cf66;">✅ 已处理 ${alreadyImportedCount} 个</p>` : ''}<p>还有 <strong style="color:var(--tm-accent);">${entriesWithoutCategory.length}</strong> 个无分类</p></div><div class="tm-modal-footer" style="flex-direction:column;gap:8px;"><button class="tm-btn tm-btn-secondary tm-category-action" data-action="skipCategoryAll" style="width:100%;">🏷️ 全部「未分类」</button><button class="tm-btn tm-btn-primary tm-category-action" data-action="showUnifiedCategory" style="width:100%;">📁 统一设置</button><button class="tm-btn tm-btn-accent tm-category-action" data-action="startOneByOne" style="width:100%;">✨ 逐个设置</button><button class="tm-btn tm-btn-secondary tm-category-action" data-action="closeCategoryPrompt" style="width:100%;margin-top:4px;">❌ 取消</button></div></div></div>`); },
    closeCategoryPrompt() { getJQuery()('#tm-categoryPromptModal, #tm-singleCategoryModal').remove(); getParentWindow()._tmPendingEntries = null; },
    async skipCategoryAll() { const entries = getParentWindow()._tmPendingEntries || []; const entriesWithCategory = getParentWindow()._tmEntriesWithCategory || []; this.closeCategoryPrompt(); entries.forEach(e => e.category = ['未分类']); this.showTitlePrompt([...entriesWithCategory, ...entries]); },
    showUnifiedCategory() { const $ = getJQuery(); $('#tm-categoryPromptModal .tm-modal-body').html(`<p>统一设置分类：</p><input type="text" id="tm-unifiedCategory" class="form-input" placeholder="分类名称..." autofocus><div class="form-group" style="margin-top:12px;"><label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="tm-editTitlesAfter"> 之后逐个修改标题</label></div>`); $('#tm-categoryPromptModal .tm-modal-footer').html(`<button class="tm-btn tm-btn-secondary tm-category-action" data-action="closeCategoryPrompt">取消</button><button class="tm-btn tm-btn-primary tm-category-action" data-action="applyUnifiedCategory">确认</button>`); $('#tm-unifiedCategory').focus(); },
    async applyUnifiedCategory() { const $ = getJQuery(); const entries = getParentWindow()._tmPendingEntries || []; const entriesWithCategory = getParentWindow()._tmEntriesWithCategory || []; const categoryInput = $('#tm-unifiedCategory').val().trim(); const categories = categoryInput ? parseCategories(categoryInput) : ['未分类']; const editTitles = $('#tm-editTitlesAfter').is(':checked'); entries.forEach(e => e.category = categories); const allEntries = [...entriesWithCategory, ...entries]; this.closeCategoryPrompt(); if (editTitles) { this.showTitlePrompt(allEntries); } else { await this.importEntriesDirectly(allEntries); } },
    startOneByOne() { getParentWindow()._tmCurrentIndex = 0; this.showSingleCategoryModal(); },
    showSingleCategoryModal() { const $ = getJQuery(); const entries = getParentWindow()._tmPendingEntries || []; const currentIndex = getParentWindow()._tmCurrentIndex || 0; if (currentIndex >= entries.length) { this.finishOneByOne(); return; } const entry = entries[currentIndex]; $('#tm-categoryPromptModal').hide(); $('#tm-singleCategoryModal').remove(); $('body').append(`<div id="tm-singleCategoryModal" class="tm-modal-overlay"><div class="tm-modal" style="max-width:500px;"><div class="tm-modal-header"><h2>✏️ 设置 (${currentIndex + 1}/${entries.length})</h2><button class="tm-modal-close tm-single-action" data-action="skipRestAndFinish">×</button></div><div class="tm-modal-body"><div class="form-group"><label>标题</label><input type="text" id="tm-singleTitle" class="form-input" value="${escapeHtml(entry.title)}"></div><div class="form-group"><label>分类</label><input type="text" id="tm-singleCategory" class="form-input" placeholder="留空则「未分类」"></div><div class="form-group"><label>预览</label><div class="preview-box preview-small">${escapeHtml(entry.content.substring(0, 150))}</div></div></div><div class="tm-modal-footer"><button class="tm-btn tm-btn-secondary tm-single-action" data-action="skipRestAndFinish">跳过剩余</button><button class="tm-btn tm-btn-secondary tm-single-action" data-action="skipThisOne">跳过</button><button class="tm-btn tm-btn-primary tm-single-action" data-action="confirmThisOne">确认 →</button></div></div></div>`); $('#tm-singleTitle').focus(); },
    async confirmThisOne() { const $ = getJQuery(); const entries = getParentWindow()._tmPendingEntries || []; const currentIndex = getParentWindow()._tmCurrentIndex || 0; const entry = entries[currentIndex]; const newTitle = $('#tm-singleTitle').val().trim(); const categoryInput = $('#tm-singleCategory').val().trim(); if (newTitle) entry.title = newTitle; entry.category = categoryInput ? parseCategories(categoryInput) : ['未分类']; theaterData.prompts.push({ id: generateId(), title: entry.title, content: entry.content, category: entry.category, favorite: false, useCount: 0, createdAt: Date.now() }); await saveData(); getParentWindow()._tmCurrentIndex = currentIndex + 1; this.showSingleCategoryModal(); },
    async skipThisOne() { const entries = getParentWindow()._tmPendingEntries || []; const currentIndex = getParentWindow()._tmCurrentIndex || 0; const entry = entries[currentIndex]; theaterData.prompts.push({ id: generateId(), title: entry.title, content: entry.content, category: ['未分类'], favorite: false, useCount: 0, createdAt: Date.now() }); await saveData(); getParentWindow()._tmCurrentIndex = currentIndex + 1; this.showSingleCategoryModal(); },
    async skipRestAndFinish() { const entries = getParentWindow()._tmPendingEntries || []; const currentIndex = getParentWindow()._tmCurrentIndex || 0; for (let i = currentIndex; i < entries.length; i++) { theaterData.prompts.push({ id: generateId(), title: entries[i].title, content: entries[i].content, category: ['未分类'], favorite: false, useCount: 0, createdAt: Date.now() }); } await saveData(); this.finishOneByOne(); },
    finishOneByOne() { const alreadyImported = getParentWindow()._tmAlreadyImported || 0; const entries = getParentWindow()._tmPendingEntries || []; const entriesWithCategory = getParentWindow()._tmEntriesWithCategory || []; this.closeCategoryPrompt(); if (entriesWithCategory.length > 0) { this.showTitlePrompt(entriesWithCategory); } else { this.updateCategoryFilter(); this.renderPromptList(); alert(`✅ 成功导入 ${alreadyImported + entries.length} 个！`); } },

    setTheme(themeKey) { applyTheme(themeKey); this.renderSettings(); }
  };

  getParentWindow().TheaterManager = TheaterManager;

  function createTheaterManagerUI() {
    const $ = getJQuery();
    $('#theater-manager-modal, #tm-addModal, #tm-previewModal, #tm-macroModal, #tm-batchEditModal, #tm-categoryPromptModal, #tm-duplicateModal, #tm-singleCategoryModal, #tm-genMacroModal, #tm-titlePromptModal, #tm-singleTitleModal, #tm-folderModal, #tm-moveToFolderModal').remove();
    batchSelectMode = false; selectedIds.clear(); deletedItem = null; hideUndoBar(); isGenerating = false; currentGenerationPromptId = null;

    $('body').append(`
      <div id="theater-manager-modal" class="tm-main-overlay">
        <div class="tm-main-container">
          <div class="tm-header"><h1>🎭 小剧场管理器</h1><div class="tm-header-btns"><button class="tm-hbtn tm-hbtn-primary tm-header-action" data-action="openAddModal">➕</button><button class="tm-hbtn tm-hbtn-folder tm-header-action" data-action="openFolderModal">📁</button><button class="tm-hbtn tm-hbtn-accent tm-header-action" data-action="importFromTxt">📋</button><button class="tm-hbtn tm-header-action" data-action="randomPick">🎲</button><button class="tm-hbtn tm-header-action" id="tm-batchModeBtn" data-action="toggleBatchMode">☑️</button><button class="tm-hbtn tm-header-action" data-action="closeModal">✕</button></div></div>
          <div class="tm-toolbar"><input type="text" id="tm-searchInput" placeholder="🔍 搜索..."><select id="tm-categoryFilter"><option value="">全部分类</option></select></div>
          <div id="tm-batchActions" class="tm-batch-bar" style="display:none;"><span>已选 <strong id="tm-batchCount">0</strong></span><button class="tm-btn tm-btn-small tm-batch-action" data-action="toggleSelectAll">全选</button><button class="tm-btn tm-btn-small tm-btn-primary tm-batch-action" data-action="openBatchEditModal">改分类</button><button class="tm-btn tm-btn-small tm-btn-danger tm-batch-action" data-action="batchDelete">删除</button></div>
          <div class="tm-tabs"><div class="tm-tab active" data-tab="all">📋 全部</div><div class="tm-tab" data-tab="favorites">⭐ 收藏</div><div class="tm-tab" data-tab="generate">🎬 演绎</div><div class="tm-tab" data-tab="history">🕐 历史</div><div class="tm-tab" data-tab="stats">📊 统计</div><div class="tm-tab" data-tab="settings">⚙️ 设置</div></div>
          <div id="tm-promptList" class="tm-content"></div>
          <div id="tm-undo-bar" class="tm-undo-bar"></div>
        </div>
      </div>
      <div id="tm-addModal" class="tm-modal-overlay hidden"><div class="tm-modal"><div class="tm-modal-header"><h2 id="tm-modalTitle">➕ 添加</h2><div class="tm-modal-header-btns"><button id="tm-favoriteBtn" class="tm-favorite-btn">☆</button><button class="tm-modal-close tm-modal-action" data-action="closeAddModal">×</button></div></div><div class="tm-modal-body"><div class="form-group"><label>标题 *</label><input type="text" class="form-input" id="tm-promptTitle" placeholder="名字"></div><div class="form-group"><label>分类</label><input type="text" class="form-input" id="tm-promptCategory" placeholder="日常, 甜蜜..."></div><div class="form-group"><label>内容 *</label><textarea class="form-input form-textarea" id="tm-promptContent" placeholder="内容..."></textarea></div></div><div class="tm-modal-footer"><button class="tm-btn tm-btn-secondary tm-modal-action" data-action="closeAddModal">取消</button><button class="tm-btn tm-btn-primary tm-modal-action" data-action="savePrompt">保存</button></div></div></div>
      <input type="file" id="tm-jsonFileInput" accept=".json" style="display:none">
      <input type="file" id="tm-txtFileInput" accept=".txt" style="display:none">
    `);

    addStyles($);
    bindEvents($);
    initData();
    applyTheme(theaterData.theme || 'dark');
  }

  function addStyles($) {
    if ($('#theater-manager-styles').length) $('#theater-manager-styles').remove();
    $('head').append(`<style id="theater-manager-styles">
      #theater-manager-modal{--tm-bg:linear-gradient(135deg,#1a1a2e,#16213e,#0f0f23);--tm-header:linear-gradient(90deg,#667eea,#764ba2);--tm-card:rgba(255,255,255,0.03);--tm-card-hover:rgba(255,255,255,0.06);--tm-text:#e8e8e8;--tm-text-muted:#888;--tm-accent:#667eea;--tm-category-bg:rgba(118,75,162,0.3);--tm-category-text:#d4a8ff}
      .tm-main-overlay{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100%!important;height:100%!important;background:rgba(0,0,0,0.6)!important;backdrop-filter:blur(6px);z-index:10001!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:16px!important;box-sizing:border-box!important}
      .tm-main-container{width:100%;max-width:700px;max-height:85vh;background:var(--tm-bg);border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,0.4);color:var(--tm-text);display:flex;flex-direction:column;overflow:hidden;margin:auto;position:relative}
      .tm-header{background:var(--tm-header);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-shrink:0}
      .tm-header h1{font-size:1.1em;font-weight:600;color:#fff;margin:0}
      .tm-header-btns{display:flex;gap:4px}
      .tm-hbtn{width:34px;height:34px;border:none;border-radius:6px;cursor:pointer;font-size:0.95em;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.15);color:#fff;transition:all 0.15s}
      .tm-hbtn:hover,.tm-hbtn:active{background:rgba(255,255,255,0.25);transform:scale(1.05)}
      .tm-hbtn-primary{background:rgba(255,255,255,0.25)}
      .tm-hbtn-folder{background:rgba(255,200,100,0.3)}
      .tm-hbtn-accent{background:linear-gradient(135deg,#ffd43b,#fab005);color:#333}
      .tm-toolbar{padding:10px 16px;background:rgba(0,0,0,0.2);display:flex;gap:8px;align-items:center;flex-shrink:0}
      .tm-toolbar input,.tm-toolbar select{padding:8px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:rgba(0,0,0,0.3);color:var(--tm-text);font-size:0.85em}
      .tm-toolbar input{flex:1;min-width:80px}
      .tm-toolbar select{max-width:110px}
      .tm-batch-bar{padding:8px 16px;background:rgba(102,126,234,0.2);display:flex;gap:8px;align-items:center;font-size:0.82em;color:#a8b4ff;flex-shrink:0}
      .tm-tabs{display:flex;background:rgba(0,0,0,0.15);border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;overflow-x:auto}
      .tm-tab{flex:1;padding:11px 6px;text-align:center;cursor:pointer;color:var(--tm-text-muted);font-size:0.8em;font-weight:500;border-bottom:2px solid transparent;transition:all 0.2s;white-space:nowrap}
      .tm-tab:hover,.tm-tab:active{color:var(--tm-text)}
      .tm-tab.active{color:var(--tm-accent);border-bottom-color:var(--tm-accent);background:rgba(102,126,234,0.06)}
      .tm-content{padding:12px 16px;overflow-y:auto;flex:1;min-height:0}
      .tm-empty{text-align:center;padding:40px 20px;color:var(--tm-text-muted);font-size:2em}
      .tm-empty p{font-size:0.4em;margin-top:10px}
      .tm-empty-small{text-align:center;padding:16px;color:var(--tm-text-muted);font-size:0.85em}

      .tm-drag-handle{cursor:grab;color:var(--tm-text-muted);font-size:0.9em;padding:4px 6px;margin-right:4px;opacity:0.5;transition:opacity 0.2s;user-select:none;flex-shrink:0}
      .tm-drag-handle:hover,.tm-drag-handle:active{opacity:1;color:var(--tm-accent)}
      .prompt-card.dragging,.folder-card.dragging{opacity:0.5;transform:scale(0.98)}
      .prompt-card.drop-target,.folder-card.drop-target{border-color:var(--tm-accent)!important;background:rgba(102,126,234,0.15)!important}

      .folder-card{background:var(--tm-card);border:1px solid rgba(255,200,100,0.2);border-radius:10px;margin-bottom:10px;overflow:hidden}
      .folder-header{display:flex;align-items:center;padding:12px;gap:8px;cursor:pointer;transition:background 0.15s}
      .folder-header:hover{background:var(--tm-card-hover)}
      .folder-icon{font-size:1.1em}
      .folder-name{flex:1;font-weight:600;font-size:0.9em;color:var(--tm-text)}
      .folder-count{background:rgba(255,200,100,0.2);color:#ffd43b;padding:2px 8px;border-radius:10px;font-size:0.72em}
      .folder-actions{display:flex;gap:4px}
      .folder-content{padding:8px 12px;background:rgba(0,0,0,0.1);border-top:1px solid rgba(255,255,255,0.05)}
      .folder-content .prompt-card{margin-bottom:8px}
      .folder-content .prompt-card:last-child{margin-bottom:0}

      .folder-select-list{max-height:250px;overflow-y:auto}
      .folder-select-item{display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--tm-card);border-radius:8px;margin-bottom:8px;cursor:pointer;transition:all 0.15s}
      .folder-select-item:hover{background:var(--tm-card-hover)}
      .folder-select-item.active{border:2px solid var(--tm-accent);background:rgba(102,126,234,0.1)}
      .folder-select-count{font-size:0.75em;color:var(--tm-text-muted)}

      .prompt-card{background:var(--tm-card);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;margin-bottom:10px;display:flex;align-items:flex-start;gap:8px;transition:all 0.15s;user-select:none}
      .prompt-card:hover,.prompt-card:active{background:var(--tm-card-hover);border-color:rgba(102,126,234,0.25)}
      .prompt-card.favorite{border-left:3px solid #ffd43b}
      .prompt-card.selected{background:rgba(102,126,234,0.12);border-color:var(--tm-accent)}

      /* ★★★ 修复：自定义多选勾选框样式，增强可见度 ★★★ */
      .prompt-card .tm-batch-check{
        width:22px;
        height:22px;
        margin-top:2px;
        cursor:pointer;
        flex-shrink:0;
        appearance:none;
        -webkit-appearance:none;
        background:rgba(0,0,0,0.4);
        border:2px solid rgba(255,255,255,0.6);
        border-radius:5px;
        position:relative;
        transition:all 0.15s;
      }
      .prompt-card .tm-batch-check:hover{
        border-color:#667eea;
        background:rgba(102,126,234,0.3);
        box-shadow:0 0 6px rgba(102,126,234,0.5);
      }
      .prompt-card .tm-batch-check:checked{
        background:linear-gradient(135deg,#667eea,#764ba2);
        border-color:#667eea;
      }
      .prompt-card .tm-batch-check:checked::after{
        content:'✓';
        position:absolute;
        top:50%;
        left:50%;
        transform:translate(-50%,-50%);
        color:#fff;
        font-size:14px;
        font-weight:bold;
      }

      .card-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
      .card-row-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .card-title{font-weight:600;font-size:0.92em;color:var(--tm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px}
      .card-categories{display:flex;gap:4px;flex-wrap:wrap}
      .card-category{padding:2px 8px;background:var(--tm-category-bg);border-radius:4px;font-size:0.68em;color:var(--tm-category-text);flex-shrink:0;font-weight:500}
      .card-row-preview{color:var(--tm-text-muted);font-size:0.78em;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .card-row-footer{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px}
      .card-stats{font-size:0.72em;color:var(--tm-text-muted);flex-shrink:0}
      .card-btns{display:flex;gap:3px;flex-shrink:0;flex-wrap:wrap}
      .card-btn{width:28px;height:28px;border:none;border-radius:6px;cursor:pointer;font-size:0.8em;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.08);color:var(--tm-text);transition:all 0.12s}
      .card-btn:hover,.card-btn:active{background:rgba(102,126,234,0.25);transform:scale(1.08)}
      .card-btn-danger:hover,.card-btn-danger:active{background:rgba(255,107,107,0.25)}

      .settings-toggle{background:var(--tm-card);border-radius:10px;padding:14px}
      .toggle-label{display:flex;align-items:center;gap:10px;cursor:pointer}
      .toggle-label input{width:18px;height:18px}
      .toggle-text{font-size:0.9em;color:var(--tm-text)}
      .toggle-desc{font-size:0.75em;color:var(--tm-text-muted);margin-top:6px}

      .history-group{margin-bottom:14px}.history-date{font-size:0.75em;color:var(--tm-accent);margin-bottom:8px}
      .history-item{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--tm-card);border-radius:8px;margin-bottom:6px}
      .history-info{flex:1;min-width:0}.history-title{font-weight:500;color:var(--tm-text);font-size:0.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .history-time{font-size:0.72em;color:var(--tm-text-muted)}.history-btns{display:flex;gap:6px}
      .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
      .stat-card{background:var(--tm-card);border-radius:10px;padding:14px 8px;text-align:center}
      .stat-value{font-size:1.4em;font-weight:700;color:var(--tm-accent)}.stat-label{font-size:0.72em;color:var(--tm-text-muted);margin-top:4px}
      .stats-section{margin-bottom:16px}.stats-section h3{font-size:0.85em;color:var(--tm-text-muted);margin-bottom:10px}
      .category-bars{display:flex;flex-direction:column;gap:6px}
      .category-bar-item{display:flex;align-items:center;gap:10px}
      .category-bar-label{width:70px;font-size:0.75em;color:var(--tm-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .category-bar-track{flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden}
      .category-bar-fill{height:100%;background:var(--tm-header);border-radius:3px}
      .category-bar-value{width:40px;text-align:right;font-size:0.72em;color:var(--tm-text-muted)}
      .top-item{display:flex;align-items:center;gap:10px;padding:10px;background:var(--tm-card);border-radius:8px;margin-bottom:6px}
      .top-rank{font-size:1em;width:26px;text-align:center}.top-info{flex:1;min-width:0}
      .top-title{font-weight:500;color:var(--tm-text);font-size:0.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .top-stats{font-size:0.72em;color:var(--tm-text-muted)}
      .settings-page{padding:4px 0}.settings-section{margin-bottom:20px}.settings-section h3{font-size:0.9em;color:var(--tm-text);margin-bottom:12px}
      .settings-btns{display:flex;flex-wrap:wrap;gap:8px}.settings-btns .tm-btn{flex:1;min-width:100px;justify-content:center}
      .theme-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
      .theme-card{background:var(--tm-card);border:2px solid transparent;border-radius:10px;padding:10px;cursor:pointer;transition:all 0.2s}
      .theme-card:hover,.theme-card:active{border-color:rgba(255,255,255,0.2)}.theme-card.active{border-color:var(--tm-accent);background:var(--tm-card-hover)}
      .theme-preview{height:40px;border-radius:6px;overflow:hidden;margin-bottom:8px}.theme-preview-header{height:12px}
      .theme-name{font-size:0.8em;text-align:center;color:var(--tm-text)}
      .format-guide{background:var(--tm-card);border-radius:10px;padding:14px}
      .format-guide p{font-size:0.82em;color:var(--tm-text-muted);margin-bottom:8px;line-height:1.5}
      .format-guide code{background:rgba(102,126,234,0.2);padding:2px 6px;border-radius:4px;color:var(--tm-accent)}
      .about-info{background:var(--tm-card);border-radius:10px;padding:14px;text-align:center}
      .about-info p{font-size:0.85em;color:var(--tm-text);margin-bottom:6px}.about-muted{color:var(--tm-text-muted)!important;font-size:0.75em!important}
      .tm-undo-bar{display:none;background:linear-gradient(90deg,#667eea,#764ba2);padding:12px 16px;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0;border-radius:0 0 14px 14px}
      .tm-undo-bar.show{display:flex}
      .tm-undo-text{color:#fff;font-size:0.9em;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .tm-undo-action-btn{background:#fff;color:#667eea;border:none;padding:8px 16px;border-radius:8px;font-weight:600;font-size:0.9em;cursor:pointer}
      .tm-undo-timer{background:rgba(255,255,255,0.2);color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.85em;font-weight:600}
      .gen-page{display:flex;flex-direction:column;gap:12px;height:100%}
      .gen-toolbar{display:flex;gap:8px;flex-shrink:0}
      .gen-toolbar input,.gen-toolbar select{padding:8px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:rgba(0,0,0,0.3);color:var(--tm-text);font-size:0.85em}
      .gen-toolbar input{flex:1}
      .gen-toolbar select{max-width:120px}
      .gen-prompt-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px}
      .gen-prompt-card{background:var(--tm-card);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;display:flex;align-items:center;gap:12px;transition:all 0.15s}
      .gen-prompt-card:hover{background:var(--tm-card-hover)}
      .gen-prompt-card.favorite{border-left:3px solid #ffd43b}
      .gen-card-info{flex:1;min-width:0}
      .gen-card-title{font-weight:600;font-size:0.9em;color:var(--tm-text);margin-bottom:4px}
      .gen-card-categories{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px}
      .gen-card-preview{font-size:0.75em;color:var(--tm-text-muted)}
      .gen-card-btns{display:flex;gap:6px}
      .gen-result-area{display:flex;flex-direction:column;gap:12px;height:100%}
      .gen-result-header{display:flex;justify-content:space-between;align-items:center}
      .gen-result-header h3{margin:0;font-size:1em;color:var(--tm-text)}
      .gen-result-content{flex:1;overflow-y:auto;background:var(--tm-card);border-radius:10px;padding:16px}
      .gen-result-actions{display:flex;gap:8px;flex-wrap:wrap}
      .gen-loading{text-align:center;padding:40px}
      .gen-loading-spinner{width:40px;height:40px;border:3px solid var(--tm-card-hover);border-top-color:var(--tm-accent);border-radius:50%;animation:tm-spin 1s linear infinite;margin:0 auto 16px}
      @keyframes tm-spin{to{transform:rotate(360deg)}}
      .gen-loading p{color:var(--tm-text);font-size:0.9em;margin:8px 0}
      .gen-loading-tip{color:var(--tm-text-muted)!important;font-size:0.8em!important}
      .gen-success{display:flex;flex-direction:column;gap:12px}
      .gen-success-header{display:flex;align-items:center;gap:8px;color:#51cf66;font-weight:600}
      .gen-output-box{background:rgba(0,0,0,0.2);border-radius:8px;padding:14px;color:var(--tm-text);font-size:0.88em;line-height:1.6;white-space:pre-wrap;max-height:300px;overflow-y:auto}
      .gen-error{text-align:center;padding:30px}
      .gen-error-icon{font-size:2em;display:block;margin-bottom:12px}
      .preview-categories{display:flex;gap:4px;flex-wrap:wrap}
      .tm-modal-overlay{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100%!important;height:100%!important;background:rgba(0,0,0,0.7)!important;z-index:10002!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:20px!important;box-sizing:border-box!important}
      .tm-modal-overlay.hidden{display:none!important}
      .tm-modal{background:#1e1e32;border-radius:14px;width:100%;max-width:500px;max-height:80vh;overflow-y:auto;box-shadow:0 16px 48px rgba(0,0,0,0.5);margin:auto}
      .tm-modal-header{padding:14px 18px;background:var(--tm-header,linear-gradient(90deg,#667eea,#764ba2));display:flex;justify-content:space-between;align-items:center;border-radius:14px 14px 0 0;position:sticky;top:0;z-index:1}
      .tm-modal-header h2{font-size:1em;color:#fff;margin:0}
      .tm-modal-header-btns{display:flex;align-items:center;gap:8px}
      .tm-favorite-btn{width:36px;height:36px;border:none;border-radius:50%;cursor:pointer;font-size:1.2em;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.15);color:#fff;transition:all 0.2s}
      .tm-favorite-btn.active{background:rgba(255,215,0,0.3);color:#ffd700}
      .tm-modal-close{background:none;border:none;color:#fff;font-size:1.3em;cursor:pointer;opacity:0.8;padding:4px 8px}
      .tm-modal-body{padding:18px}
      .tm-modal-footer{padding:14px 18px;background:rgba(0,0,0,0.2);display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
      .form-group{margin-bottom:14px}.form-group label{display:block;margin-bottom:6px;font-size:0.82em;color:var(--tm-text-muted,#888)}
      .form-input{width:100%;padding:10px 12px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:rgba(0,0,0,0.25);color:var(--tm-text,#e8e8e8);font-size:0.88em;box-sizing:border-box}
      .form-input:focus{outline:none;border-color:var(--tm-accent,#667eea)}
      .form-textarea{min-height:120px;resize:vertical;font-family:inherit}
      .preview-box{padding:10px 12px;background:rgba(0,0,0,0.25);border-radius:8px;color:var(--tm-text,#ccc);font-size:0.88em}
      .preview-small{font-size:0.8em;color:var(--tm-text-muted,#999);max-height:100px;overflow-y:auto}
      .tm-btn{padding:8px 14px;border:none;border-radius:8px;cursor:pointer;font-size:0.82em;font-weight:500;transition:all 0.15s;display:inline-flex;align-items:center;gap:4px}
      .tm-btn-primary{background:var(--tm-header,linear-gradient(135deg,#667eea,#764ba2));color:#fff}
      .tm-btn-secondary{background:rgba(255,255,255,0.08);color:var(--tm-text,#ccc);border:1px solid rgba(255,255,255,0.15)}
      .tm-btn-danger{background:linear-gradient(135deg,#ff6b6b,#ee5a5a);color:#fff}
      .tm-btn-success{background:linear-gradient(135deg,#51cf66,#40c057);color:#fff}
      .tm-btn-accent{background:linear-gradient(135deg,#ffd43b,#fab005);color:#333}
      .tm-btn-small{padding:6px 10px;font-size:0.75em}

      @media(max-width:600px){
        .tm-main-overlay{padding:12px!important}.tm-main-container{max-height:90vh;border-radius:12px}
        .tm-header{padding:10px 14px}.tm-header h1{font-size:1em}.tm-hbtn{width:32px;height:32px;font-size:0.9em}
        .tm-toolbar{padding:8px 14px}.tm-content{padding:10px 14px}
        .stats-grid{grid-template-columns:repeat(2,1fr)}.theme-grid{grid-template-columns:repeat(2,1fr)}
        .card-title{max-width:140px}.card-btn{width:26px;height:26px;font-size:0.75em}
        .tm-modal-overlay{padding:14px!important}.tm-modal{border-radius:12px;max-height:85vh}
        .tm-modal-body{padding:16px}.tm-modal-footer{padding:12px 16px}
        .tm-favorite-btn{width:32px;height:32px;font-size:1.1em}
        .tm-undo-bar{padding:10px 14px;border-radius:0 0 12px 12px}
        .tm-drag-handle{padding:3px 5px;font-size:0.85em}
        .prompt-card .tm-batch-check{width:20px;height:20px}
      }
      @media(max-width:400px){
        .tm-main-overlay{padding:8px!important}.tm-main-container{max-height:92vh}
        .tm-header{padding:8px 12px}.tm-header h1{font-size:0.95em}.tm-hbtn{width:30px;height:30px;font-size:0.85em}
        .tm-toolbar{padding:6px 12px;gap:6px}.tm-toolbar input,.tm-toolbar select{padding:6px 10px;font-size:0.8em}
        .tm-tabs{overflow-x:auto}.tm-tab{padding:10px 4px;font-size:0.72em}
        .card-title{max-width:110px;font-size:0.88em}.card-btns{gap:2px}.card-btn{width:24px;height:24px;font-size:0.72em}
        .settings-btns{flex-direction:column}.settings-btns .tm-btn{min-width:100%}
        .prompt-card .tm-batch-check{width:18px;height:18px}
      }
    </style>`);
  }

  function bindEvents($) {
    const doc = $(getParentWindow().document);
    doc.off('.theaterManager');

    doc.on('input.theaterManager', '#tm-searchInput', () => TheaterManager.filterPrompts());
    doc.on('change.theaterManager', '#tm-categoryFilter', () => TheaterManager.filterPrompts());
    doc.on('input.theaterManager', '#tm-genSearchInput', () => TheaterManager.filterGenPrompts());
    doc.on('change.theaterManager', '#tm-genCategoryFilter', () => TheaterManager.filterGenPrompts());
    doc.on('click.theaterManager', '.tm-tab', function() { TheaterManager.switchTab($(this).data('tab')); });
    doc.on('click.theaterManager', '.tm-header-action', function() { const a = $(this).data('action'); if (a && TheaterManager[a]) TheaterManager[a](); });
    doc.on('click.theaterManager', '.tm-modal-action', function() { const a = $(this).data('action'); if (a && TheaterManager[a]) TheaterManager[a](); });
    doc.on('click.theaterManager', '.tm-category-action', function() { const a = $(this).data('action'); if (a && TheaterManager[a]) TheaterManager[a](); });
    doc.on('click.theaterManager', '.tm-batch-action', function() { const a = $(this).data('action'); if (a && TheaterManager[a]) TheaterManager[a](); });
    doc.on('click.theaterManager', '.tm-preview-action', function() { const a = $(this).data('action'), id = $(this).data('id'); if (a && TheaterManager[a]) TheaterManager[a](id); });
    doc.on('click.theaterManager', '.tm-setting-action', function() { const a = $(this).data('action'); if (a && TheaterManager[a]) TheaterManager[a](); });
    doc.on('click.theaterManager', '.tm-macro-action', function() { const a = $(this).data('action'), id = $(this).data('id'); if (a && TheaterManager[a]) TheaterManager[a](id); });
    doc.on('click.theaterManager', '.tm-duplicate-action', function() { const a = $(this).data('action'); if (a && TheaterManager[a]) TheaterManager[a](); });
    doc.on('click.theaterManager', '.tm-single-action', function() { const a = $(this).data('action'); if (a && TheaterManager[a]) TheaterManager[a](); });
    doc.on('click.theaterManager', '.tm-gen-action', function() { const a = $(this).data('action'), id = $(this).data('id'); if (a && TheaterManager[a]) TheaterManager[a](id); });
    doc.on('click.theaterManager', '.tm-gen-macro-action', function() { const a = $(this).data('action'), id = $(this).data('id'); if (a && TheaterManager[a]) TheaterManager[a](id); });
    doc.on('click.theaterManager', '.tm-title-action', function() { const a = $(this).data('action'); if (a && TheaterManager[a]) TheaterManager[a](); });
    doc.on('click.theaterManager', '.tm-single-title-action', function() { const a = $(this).data('action'); if (a && TheaterManager[a]) TheaterManager[a](); });
    doc.on('click.theaterManager', '.tm-folder-action', function() { const a = $(this).data('action'), id = $(this).data('id'); if (a && TheaterManager[a]) TheaterManager[a](id); });
    doc.on('click.theaterManager', '.tm-move-action', function() { const a = $(this).data('action'); if (a && TheaterManager[a]) TheaterManager[a](); });
    doc.on('click.theaterManager', '.card-btn', function(e) { e.stopPropagation(); const a = $(this).data('action'), id = $(this).data('id'); if (a && TheaterManager[a]) TheaterManager[a](id); });
    doc.on('click.theaterManager', '.folder-header', function(e) { if (!$(e.target).closest('.card-btn, .tm-drag-handle').length) { TheaterManager.toggleFolder($(this).data('folder-id')); } });
    doc.on('change.theaterManager', '.tm-batch-check', function() { TheaterManager.toggleSelect($(this).data('id')); });
    doc.on('change.theaterManager', '#tm-jsonFileInput', (e) => TheaterManager.handleJSONImport(e.originalEvent || e));
    doc.on('change.theaterManager', '#tm-txtFileInput', (e) => TheaterManager.handleTxtImport(e.originalEvent || e));
    doc.on('click.theaterManager', '.tm-main-overlay', function(e) { if (e.target === this) TheaterManager.closeModal(); });
    doc.on('click.theaterManager', '.theme-card', function() { TheaterManager.setTheme($(this).data('theme')); });
    doc.on('click.theaterManager', '#tm-favoriteBtn', function() { TheaterManager.toggleAddFavorite(); });
    doc.on('click.theaterManager', '.tm-undo-action-btn', function(e) { e.preventDefault(); e.stopPropagation(); undoDelete(); });

    doc.on('touchstart.theaterManager', '.prompt-card', function(e) { if (batchSelectMode || $(e.target).closest('.tm-drag-handle, .card-btn, .tm-batch-check').length) return; const id = $(this).data('id'); longPressTimer = setTimeout(() => { TheaterManager.showPreview(id); }, 500); });
    doc.on('touchend.theaterManager touchmove.theaterManager', '.prompt-card', function() { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });

    doc.on('keydown.theaterManager', function(e) {
      if (e.key === 'Escape') {
        const $ = getJQuery();
        if ($('#tm-singleTitleModal').length) TheaterManager.skipRestTitles();
        else if ($('#tm-singleCategoryModal').length) TheaterManager.skipRestAndFinish();
        else if ($('#tm-genMacroModal').length) TheaterManager.closeGenMacroModal();
        else if ($('#tm-macroModal').length) TheaterManager.closeMacroEditor();
        else if ($('#tm-previewModal').length) TheaterManager.closePreview();
        else if ($('#tm-batchEditModal').length) TheaterManager.closeBatchEdit();
        else if ($('#tm-duplicateModal').length) TheaterManager.closeDuplicateModal();
        else if ($('#tm-categoryPromptModal').length) TheaterManager.closeCategoryPrompt();
        else if ($('#tm-titlePromptModal').length) TheaterManager.closeTitlePrompt();
        else if ($('#tm-folderModal').length) TheaterManager.closeFolderModal();
        else if ($('#tm-moveToFolderModal').length) TheaterManager.closeMoveModal();
        else if (!$('#tm-addModal').hasClass('hidden')) TheaterManager.closeAddModal();
        else if ($('#theater-manager-modal').length) TheaterManager.closeModal();
      }
    });
  }

  async function initData() { await loadData(); await updateCurrentInfo(); TheaterManager.renderPromptList(); TheaterManager.updateCategoryFilter(); }

  function initIntegration() {
    const $ = getJQuery();
    if (!$) { setTimeout(initIntegration, 500); return; }
    $('#theater-manager-menu-item').remove();
    const extensionsMenu = $('#extensionsMenu');
    if (!extensionsMenu.length) { setTimeout(initIntegration, 500); return; }
    extensionsMenu.append(`<a id="theater-manager-menu-item" class="list-group-item" href="#" title="小剧场管理器"><i class="fa-solid fa-theater-masks"></i> 小剧场管理器</a>`);
    $('#theater-manager-menu-item').on('click', function(e) { e.preventDefault(); e.stopPropagation(); $('#extensionsMenu').fadeOut(200); createTheaterManagerUI(); });
    console.log('✅ 小剧场管理器 v4.0 已加载');
  }

  function start() { const $ = getJQuery(); if ($ && $('#extensionsMenu').length) initIntegration(); else setTimeout(start, 500); }
  start();
})();
