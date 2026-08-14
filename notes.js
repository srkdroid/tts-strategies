// Knowledge Base & Strategy Notes Client Logic

let allNotes = [];
let activeNoteId = null;
let editingNoteId = null;
let notesSearchQuery = "";

// Initialize Notes Module
async function fetchNotesData() {
    try {
        const response = await fetch('/api/notes');
        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            throw new Error('Failed to fetch notes');
        }
        const resJson = await response.json();
        allNotes = resJson.notes || [];
        if (typeof resJson.isAdmin !== 'undefined') {
            window.isAdminMode = !!resJson.isAdmin;
        }
        
        // Show admin controls if logged in as Admin
        const adminBtn = document.getElementById("admin-add-note-btn");
        if (adminBtn) adminBtn.style.display = window.isAdminMode ? "inline-flex" : "none";
        
        renderNotesSidebar();
        
        // Select first note by default if none active
        if (!activeNoteId && allNotes.length > 0) {
            selectNote(allNotes[0].id);
        } else if (activeNoteId) {
            selectNote(activeNoteId);
        }
    } catch (e) {
        console.error("Notes load error:", e);
    }
}

// Search Handler
function onNotesSearchInput(val) {
    notesSearchQuery = (val || "").trim().toLowerCase();
    renderNotesSidebar();
}

// Populate Strategy Dropdown in Editor
function populateNotesStrategyDropdown() {
    const select = document.getElementById("editor-note-strategy-id");
    if (!select) return;
    select.innerHTML = "";

    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.innerText = "-- None (Generic / Unlinked) --";
    select.appendChild(noneOpt);
    
    let strats = [];
    if (window.strategiesData && Array.isArray(window.strategiesData) && window.strategiesData.length > 0) {
        strats = window.strategiesData;
    } else if (typeof strategiesData !== 'undefined' && Array.isArray(strategiesData) && strategiesData.length > 0) {
        strats = strategiesData;
    }

    strats.forEach(st => {
        const opt = document.createElement("option");
        opt.value = st.id;
        opt.innerText = `${st.name} (${st.index || st.sheet || 'Strategy'})`;
        select.appendChild(opt);
    });
}

let collapsedCategories = {}; // Tracks collapsed state per category name

function toggleCategoryCollapse(catName) {
    collapsedCategories[catName] = !collapsedCategories[catName];
    renderNotesSidebar();
}

// Render Sidebar List (Grouped 25% with Collapsible Categories)
function renderNotesSidebar() {
    const container = document.getElementById("notes-list-container");
    if (!container) return;
    container.innerHTML = "";

    const filtered = allNotes.filter(n => {
        if (!notesSearchQuery) return true;
        const matchTitle = (n.title || "").toLowerCase().includes(notesSearchQuery);
        const matchContent = (n.content || "").toLowerCase().includes(notesSearchQuery);
        const matchCat = (n.category || "").toLowerCase().includes(notesSearchQuery);
        return matchTitle || matchContent || matchCat;
    });

    // Group all notes dynamically by their category field
    const grouped = {};
    filtered.forEach(n => {
        let rawCat = (n.category || "Generic").trim();
        let catUpper = rawCat.toUpperCase();
        let cat = "";
        
        if (catUpper === "GENERIC NOTES" || catUpper === "GENERIC") cat = "📌 Generic";
        else if (catUpper === "STRATEGY NOTES" || catUpper === "STRATEGY" || catUpper === "0_ADJUSTMENT") cat = "⚡ Strategy";
        else if (catUpper === "DISCRETIONARY" || catUpper === "DISCRETIONARY NOTES") cat = "🎯 Discretionary";
        else if (catUpper === "ADJUSTMENTS" || catUpper === "REPAIR" || catUpper === "ADJUSTMENT NOTES") cat = "🛠️ Adjustments";
        else {
            let cleanCat = rawCat.replace(/\s+Notes?$/i, "");
            cat = `📁 ${cleanCat}`;
        }

        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(n);
    });

    const categoryPriority = ['📌 Generic', '⚡ Strategy', '🎯 Discretionary', '🛠️ Adjustments'];
    const categoryKeys = Object.keys(grouped).sort((a, b) => {
        const idxA = categoryPriority.indexOf(a);
        const idxB = categoryPriority.indexOf(b);
        const prioA = idxA >= 0 ? idxA : categoryPriority.length;
        const prioB = idxB >= 0 ? idxB : categoryPriority.length;
        if (prioA !== prioB) return prioA - prioB;
        return a.localeCompare(b);
    });

    if (categoryKeys.length === 0) {
        container.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--text-secondary); font-size: 0.82rem;">No notes found matching "${notesSearchQuery}".</div>`;
        return;
    }

    // Auto-expand category containing activeNoteId if it's set
    if (activeNoteId) {
        for (const [catName, notesList] of Object.entries(grouped)) {
            if (notesList.some(n => n.id === activeNoteId)) {
                collapsedCategories[catName] = false;
            }
        }
    }

    categoryKeys.forEach(catName => {
        const notesList = grouped[catName];
        const isCollapsed = !!collapsedCategories[catName];

        const groupDiv = document.createElement("div");
        groupDiv.className = "note-category-group";

        const titleDiv = document.createElement("div");
        titleDiv.className = "note-category-title";
        titleDiv.onclick = () => toggleCategoryCollapse(catName);
        titleDiv.innerHTML = `
            <span style="display: flex; align-items: center; gap: 0.4rem;">
                <span>${catName}</span>
                <span style="opacity: 0.75; font-size: 0.72rem;">(${notesList.length})</span>
            </span>
            <span style="font-size: 0.7rem; color: var(--text-secondary); transition: transform 0.2s;">${isCollapsed ? '▶' : '▼'}</span>
        `;
        groupDiv.appendChild(titleDiv);

        const itemsContainer = document.createElement("div");
        itemsContainer.style.display = isCollapsed ? "none" : "block";

        notesList.forEach(n => {
            const item = document.createElement("div");
            item.className = `note-sidebar-item${n.id === activeNoteId ? ' active' : ''}`;
            item.onclick = () => selectNote(n.id);

            const itemTitle = document.createElement("div");
            itemTitle.className = "note-sidebar-item-title";
            itemTitle.innerText = n.title;
            itemTitle.title = n.title;

            item.appendChild(itemTitle);
            itemsContainer.appendChild(item);
        });

        groupDiv.appendChild(itemsContainer);
        container.appendChild(groupDiv);
    });
}

function showNotesMobileSidebar() {
    const sidebar = document.querySelector(".notes-sidebar");
    if (sidebar) {
        sidebar.scrollIntoView({ behavior: "smooth" });
    }
}

// Select & Display Note in Main Viewer Pane (75%)
function selectNote(noteId) {
    activeNoteId = noteId;
    renderNotesSidebar(); // Refresh sidebar active highlight

    const note = allNotes.find(n => n.id === noteId);
    const viewerPane = document.getElementById("note-viewer-pane");
    const editorPane = document.getElementById("note-editor-pane");

    if (viewerPane) viewerPane.style.display = "block";
    if (editorPane) editorPane.style.display = "none";

    // Auto-scroll to note content on mobile screens
    if (window.innerWidth <= 768 && viewerPane) {
        viewerPane.scrollIntoView({ behavior: "smooth" });
    }

    if (!note) {
        document.getElementById("note-view-title").innerText = "Note Not Found";
        document.getElementById("note-rendered-content").innerHTML = "<p style='color:var(--text-secondary)'>Please select a valid note from the sidebar.</p>";
        return;
    }

    if (typeof trackUserActivity === 'function') {
        trackUserActivity('NOTE_VIEW', `Viewed note: ${note.title}`, { noteId: note.id, category: note.category });
    }

    document.getElementById("note-view-title").innerText = note.title;
    
    const catBadge = document.getElementById("note-view-category");
    catBadge.innerText = note.category;
    catBadge.className = `badge ${note.category === 'Generic' ? 'monthly' : 'biweekly'}`;

    // Strategy cross-link badge
    const stratLinkBadge = document.getElementById("note-view-strategy-link");
    if (stratLinkBadge) {
        if (note.strategyId) {
            let stratName = "";
            const strats = window.strategiesData || (typeof strategiesData !== 'undefined' ? strategiesData : []);
            const foundStrat = strats.find(s => s.id === note.strategyId);
            if (foundStrat) stratName = foundStrat.name;
            
            stratLinkBadge.innerText = stratName ? `🎯 Open Strategy: ${stratName}` : `🎯 Open Strategy Detail`;
            stratLinkBadge.style.display = "inline-flex";
        } else {
            stratLinkBadge.style.display = "none";
        }
    }

    const dateEl = document.getElementById("note-view-date");
    if (dateEl) {
        const d = note.updatedAt ? new Date(note.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
        dateEl.innerText = `Updated: ${d}`;
    }

    // Admin action buttons visibility
    const adminActions = document.getElementById("note-admin-actions");
    if (adminActions) {
        const isAdmin = !!(window.isAdminMode || (typeof isAdminMode !== 'undefined' && isAdminMode));
        adminActions.style.display = isAdmin ? "flex" : "none";
    }

    // Render Markdown using marked.js
    const renderedContainer = document.getElementById("note-rendered-content");
    if (typeof marked !== 'undefined' && marked.parse) {
        renderedContainer.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(marked.parse(note.content || "")) : marked.parse(note.content || "");
    } else {
        renderedContainer.innerText = note.content || "";
    }

    // Bind Image Lightbox triggers
    const images = renderedContainer.querySelectorAll("img");
    images.forEach(img => {
        img.onclick = () => openImageLightbox(img.src);
    });
}

// Lightbox image viewer
function openImageLightbox(src) {
    const existing = document.getElementById("image-lightbox-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "image-lightbox-overlay";
    overlay.className = "image-lightbox";
    overlay.onclick = () => overlay.remove();

    const img = document.createElement("img");
    img.src = src;
    overlay.appendChild(img);

    document.body.appendChild(overlay);
}

// Jump to strategy detail modal from note link
function openLinkedStrategyModal() {
    const note = allNotes.find(n => n.id === activeNoteId);
    if (!note || !note.strategyId) return;

    const strats = window.allCalculatedDeployments || [];
    const dep = strats.find(d => d.strategy && d.strategy.id === note.strategyId);
    if (dep && typeof showStrategyDetails === 'function') {
        showStrategyDetails(dep);
    } else if (window.strategiesData) {
        const strat = window.strategiesData.find(s => s.id === note.strategyId);
        if (strat && typeof showStrategyDetails === 'function') {
            showStrategyDetails({ 
                strategy: strat, 
                isInactiveFallback: true, 
                actualDate: null, 
                expiryDate: null, 
                nominalDate: null, 
                shifted: false 
            });
        } else {
            if (typeof showToast === 'function') showToast("Strategy details not found", "warning");
        }
    }
}

// -------------------------------------------------------------
// ADMIN EDITOR & CLIPBOARD SCREENSHOT PASTE LOGIC
// -------------------------------------------------------------

function openNewNoteEditor() {
    editingNoteId = null;
    document.getElementById("note-editor-heading").innerText = "Create New Note";
    document.getElementById("editor-note-title").value = "";
    document.getElementById("editor-note-category").value = "Generic";
    document.getElementById("editor-markdown-input").value = "";
    document.getElementById("editor-live-preview").innerHTML = "";

    populateNotesStrategyDropdown();
    onNoteCategoryChange("Generic");

    document.getElementById("note-viewer-pane").style.display = "none";
    document.getElementById("note-editor-pane").style.display = "block";
    setupEditorPasteListener();
}

function editCurrentNote() {
    const note = allNotes.find(n => n.id === activeNoteId);
    if (!note) return;

    editingNoteId = note.id;
    document.getElementById("note-editor-heading").innerText = "Edit Note";
    document.getElementById("editor-note-title").value = note.title;
    document.getElementById("editor-note-category").value = note.category || "Generic";
    document.getElementById("editor-markdown-input").value = note.content || "";

    populateNotesStrategyDropdown();
    onNoteCategoryChange(note.category || "Generic");

    if (note.strategyId) {
        document.getElementById("editor-note-strategy-id").value = note.strategyId;
    }

    updateEditorLivePreview();

    document.getElementById("note-viewer-pane").style.display = "none";
    document.getElementById("note-editor-pane").style.display = "block";
    setupEditorPasteListener();
}

function cancelNoteEdit() {
    document.getElementById("note-editor-pane").style.display = "none";
    document.getElementById("note-viewer-pane").style.display = "block";
}

function onNoteCategoryChange(val) {
    const group = document.getElementById("editor-strategy-select-group");
    if (group) {
        group.style.display = "block";
    }
}

function updateEditorLivePreview() {
    const raw = document.getElementById("editor-markdown-input").value;
    const preview = document.getElementById("editor-live-preview");
    if (preview) {
        if (typeof marked !== 'undefined' && marked.parse) {
            preview.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(marked.parse(raw || "")) : marked.parse(raw || "");
        } else {
            preview.innerText = raw || "";
        }
    }
}

// Attach Clipboard Image Paste Listener (Ctrl+V)
function setupEditorPasteListener() {
    const textarea = document.getElementById("editor-markdown-input");
    if (!textarea || textarea.dataset.pasteBound) return;

    textarea.dataset.pasteBound = "true";

    textarea.addEventListener("input", updateEditorLivePreview);

    textarea.addEventListener("paste", (event) => {
        const items = (event.clipboardData || event.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.type.indexOf("image") === 0) {
                event.preventDefault();
                const file = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (e) => {
                    const base64Data = e.target.result;
                    const imageMarkdown = `\n![Pasted Screenshot](${base64Data})\n`;
                    
                    // Insert at cursor
                    const startPos = textarea.selectionStart;
                    const endPos = textarea.selectionEnd;
                    textarea.value = textarea.value.substring(0, startPos) + imageMarkdown + textarea.value.substring(endPos);
                    textarea.selectionStart = textarea.selectionEnd = startPos + imageMarkdown.length;

                    updateEditorLivePreview();
                    if (typeof showToast === 'function') {
                        showToast("📸 Screenshot pasted into editor!");
                    }
                };
                reader.readAsDataURL(file);
                break;
            }
        }
    });
}

// Save Note API Call
async function saveNoteFromEditor() {
    const title = document.getElementById("editor-note-title").value.trim();
    const category = document.getElementById("editor-note-category").value;
    const stratSelect = document.getElementById("editor-note-strategy-id");
    const strategyId = (stratSelect && stratSelect.value) ? stratSelect.value : null;
    const content = document.getElementById("editor-markdown-input").value;

    if (!title) {
        if (typeof showToast === 'function') showToast("Please enter a Note Title.", "warning");
        return;
    }

    const notePayload = {
        id: editingNoteId || `note_${Date.now()}`,
        title: title,
        category: category,
        strategyId: strategyId,
        content: content,
        updatedAt: new Date().toISOString()
    };

    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save_note', data: notePayload })
        });
        const resJson = await response.json();
        if (response.ok) {
            if (typeof showToast === 'function') showToast("💾 Note saved successfully!", "success");
            activeNoteId = notePayload.id;
            await fetchNotesData();
            cancelNoteEdit();
        } else {
            if (typeof showToast === 'function') showToast(resJson.error || "Failed to save note", "error");
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast("Network error saving note", "error");
    }
}

// Delete Note API Call
async function deleteCurrentNote() {
    const note = allNotes.find(n => n.id === activeNoteId);
    if (!note) return;

    if (!confirm(`Are you sure you want to delete note "${note.title}"?`)) return;

    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete_note', data: { id: note.id } })
        });
        const resJson = await response.json();
        if (response.ok) {
            if (typeof showToast === 'function') showToast("🗑️ Note deleted!", "success");
            activeNoteId = null;
            await fetchNotesData();
        } else {
            if (typeof showToast === 'function') showToast(resJson.error || "Failed to delete note", "error");
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast("Network error deleting note", "error");
    }
}

// Jump to specific strategy note from strategy modal
function jumpToStrategyNote() {
    const activeDep = window.currentActiveModalDep || (typeof currentActiveModalDep !== 'undefined' ? currentActiveModalDep : null);
    if (!activeDep || !activeDep.strategy) {
        console.warn("jumpToStrategyNote: No active strategy deployment context found.");
        return;
    }
    const strat = activeDep.strategy;
    
    if (typeof hideModal === 'function') hideModal();
    if (typeof switchViewMode === 'function') switchViewMode('notes');

    const note = allNotes.find(n => 
        (n.strategyId && strat.id && n.strategyId.toLowerCase() === strat.id.toLowerCase()) || 
        (n.category === 'Strategy' && n.title && strat.name && n.title.toLowerCase().includes(strat.name.toLowerCase())) ||
        (n.title && strat.name && strat.name.toLowerCase().includes(n.title.toLowerCase()))
    );

    if (note) {
        selectNote(note.id);
    } else {
        if (window.isAdminMode) {
            if (confirm(`No existing note found for "${strat.name}". Would you like to create one?`)) {
                openNewNoteEditor();
                document.getElementById("editor-note-title").value = `${strat.name} — Operational Notes`;
                document.getElementById("editor-note-category").value = "Strategy";
                onNoteCategoryChange("Strategy");
                const sel = document.getElementById("editor-note-strategy-id");
                if (sel) sel.value = strat.id;
            }
        } else {
            if (typeof showToast === 'function') showToast(`No strategy notes available yet for ${strat.name}.`, "info");
        }
    }
}

async function openCapitalAllocationGuidanceNote() {
    if (typeof hideModal === 'function') hideModal();

    if (!allNotes || allNotes.length === 0) {
        if (typeof fetchNotesData === 'function') {
            await fetchNotesData();
        }
    }

    if (!allNotes || allNotes.length === 0) {
        if (typeof switchViewMode === 'function') switchViewMode('notes');
        if (typeof showToast === 'function') showToast("No notes available in Knowledge Base.", "info");
        return;
    }

    const keywords = [
        "priority sequencing",
        "intraday allocation",
        "monthly, weekly",
        "trading strategies",
        "capital allocation",
        "allocation",
        "sequencing",
        "priority",
        "general margin"
    ];

    let bestNote = null;
    let highestScore = 0;

    allNotes.forEach(n => {
        let score = 0;
        const titleLower = (n.title || "").toLowerCase();
        const contentLower = (n.content || "").toLowerCase();
        const catLower = (n.category || "").toLowerCase();

        keywords.forEach((kw, index) => {
            const weight = keywords.length - index;
            if (titleLower.includes(kw)) score += weight * 10;
            if (contentLower.includes(kw)) score += weight * 2;
            if (catLower.includes(kw)) score += weight * 1;
        });

        if (score > highestScore) {
            highestScore = score;
            bestNote = n;
        }
    });

    // If score > 0, we found the best matching guidance note
    if (!bestNote || highestScore === 0) {
        bestNote = allNotes.find(n => (n.category || "").toLowerCase().includes("generic"));
    }

    if (bestNote) {
        activeNoteId = bestNote.id;
        window.preventFetchNotesDataReset = true;
        if (typeof switchViewMode === 'function') switchViewMode('notes');
        window.preventFetchNotesDataReset = false;
        selectNote(bestNote.id);
    } else {
        if (typeof switchViewMode === 'function') switchViewMode('notes');
        if (typeof showToast === 'function') showToast("Capital Allocation Guidance note not found.", "info");
    }
}

async function openNoteByTitleSearch(titleKeyword) {
    return openCapitalAllocationGuidanceNote();
}

window.openCapitalAllocationGuidanceNote = openCapitalAllocationGuidanceNote;
window.openNoteByTitleSearch = openNoteByTitleSearch;

// Dynamic drag-to-resize support for notes sidebar panel
function setupNotesSidebarResizer() {
    const resizer = document.getElementById("notes-resizer");
    const sidebar = document.querySelector(".notes-sidebar");
    if (!resizer || !sidebar || window.innerWidth <= 768) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    const startDrag = (clientX) => {
        isResizing = true;
        startX = clientX;
        startWidth = sidebar.getBoundingClientRect().width;
        resizer.classList.add("resizing");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    };

    const doDrag = (clientX) => {
        if (!isResizing) return;
        const dx = clientX - startX;
        const newWidth = Math.max(180, Math.min(650, startWidth + dx));
        sidebar.style.width = `${newWidth}px`;
    };

    const stopDrag = () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove("resizing");
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        }
    };

    // Mouse Events
    resizer.addEventListener("mousedown", (e) => startDrag(e.clientX));
    document.addEventListener("mousemove", (e) => doDrag(e.clientX));
    document.addEventListener("mouseup", stopDrag);

    // Touch Events
    resizer.addEventListener("touchstart", (e) => {
        if (e.touches.length === 1) startDrag(e.touches[0].clientX);
    });
    document.addEventListener("touchmove", (e) => {
        if (e.touches.length === 1) doDrag(e.touches[0].clientX);
    });
    document.addEventListener("touchend", stopDrag);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupNotesSidebarResizer);
} else {
    setupNotesSidebarResizer();
}
