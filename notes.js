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
    
    const strats = (window.strategiesData && Array.isArray(window.strategiesData)) ? window.strategiesData : [];
    strats.forEach(st => {
        const opt = document.createElement("option");
        opt.value = st.id;
        opt.innerText = `${st.name} (${st.index})`;
        select.appendChild(opt);
    });
}

// Render Sidebar List (Grouped 25%)
function renderNotesSidebar() {
    const container = document.getElementById("notes-list-container");
    if (!container) return;
    container.innerHTML = "";

    const filtered = allNotes.filter(n => {
        if (!notesSearchQuery) return true;
        const matchTitle = n.title.toLowerCase().includes(notesSearchQuery);
        const matchContent = (n.content || "").toLowerCase().includes(notesSearchQuery);
        return matchTitle || matchContent;
    });

    const genericNotes = filtered.filter(n => n.category === "Generic");
    const strategyNotes = filtered.filter(n => n.category === "Strategy");

    // Helper to render group
    const renderGroup = (title, icon, notesList) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "note-category-group";

        const titleDiv = document.createElement("div");
        titleDiv.className = "note-category-title";
        titleDiv.innerText = `${icon} ${title} (${notesList.length})`;
        groupDiv.appendChild(titleDiv);

        if (notesList.length === 0) {
            const empty = document.createElement("div");
            empty.style.padding = "0.4rem 0.8rem";
            empty.style.fontSize = "0.75rem";
            empty.style.color = "var(--text-secondary)";
            empty.innerText = "No notes found";
            groupDiv.appendChild(empty);
        } else {
            notesList.forEach(n => {
                const item = document.createElement("div");
                item.className = `note-sidebar-item${n.id === activeNoteId ? ' active' : ''}`;
                item.onclick = () => selectNote(n.id);

                const itemTitle = document.createElement("div");
                itemTitle.className = "note-sidebar-item-title";
                itemTitle.innerText = n.title;

                const itemMeta = document.createElement("div");
                itemMeta.className = "note-sidebar-item-meta";
                const dateStr = n.updatedAt ? new Date(n.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                itemMeta.innerText = dateStr;

                item.appendChild(itemTitle);
                item.appendChild(itemMeta);
                groupDiv.appendChild(item);
            });
        }
        container.appendChild(groupDiv);
    };

    renderGroup("Generic Notes", "📌", genericNotes);
    renderGroup("Strategy Notes", "🎯", strategyNotes);
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

    if (!note) {
        document.getElementById("note-view-title").innerText = "Note Not Found";
        document.getElementById("note-rendered-content").innerHTML = "<p style='color:var(--text-secondary)'>Please select a valid note from the sidebar.</p>";
        return;
    }

    document.getElementById("note-view-title").innerText = note.title;
    
    const catBadge = document.getElementById("note-view-category");
    catBadge.innerText = note.category;
    catBadge.className = `badge ${note.category === 'Generic' ? 'monthly' : 'biweekly'}`;

    // Strategy cross-link badge
    const stratLinkBadge = document.getElementById("note-view-strategy-link");
    if (note.category === 'Strategy' && note.strategyId) {
        stratLinkBadge.style.display = "inline-flex";
    } else {
        stratLinkBadge.style.display = "none";
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
        renderedContainer.innerHTML = marked.parse(note.content || "");
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
    const dep = strats.find(d => d.strategy.id === note.strategyId);
    if (dep && typeof showStrategyDetails === 'function') {
        showStrategyDetails(dep);
    } else if (window.strategiesData) {
        const strat = window.strategiesData.find(s => s.id === note.strategyId);
        if (strat && typeof showStrategyDetails === 'function') {
            showStrategyDetails({ strategy: strat, actualDate: new Date(), expiryDate: new Date(), nominalDate: new Date(), shifted: false });
        } else {
            alert("Strategy details not found");
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
        group.style.display = (val === "Strategy") ? "block" : "none";
    }
}

function updateEditorLivePreview() {
    const raw = document.getElementById("editor-markdown-input").value;
    const preview = document.getElementById("editor-live-preview");
    if (preview) {
        if (typeof marked !== 'undefined' && marked.parse) {
            preview.innerHTML = marked.parse(raw || "");
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
    const strategyId = (category === "Strategy") ? document.getElementById("editor-note-strategy-id").value : null;
    const content = document.getElementById("editor-markdown-input").value;

    if (!title) {
        alert("Please enter a Note Title.");
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
            if (typeof showToast === 'function') showToast("💾 Note saved successfully!");
            activeNoteId = notePayload.id;
            await fetchNotesData();
            cancelNoteEdit();
        } else {
            alert(resJson.error || "Failed to save note");
        }
    } catch (e) {
        alert("Network error saving note");
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
            if (typeof showToast === 'function') showToast("🗑️ Note deleted!");
            activeNoteId = null;
            await fetchNotesData();
        } else {
            alert(resJson.error || "Failed to delete note");
        }
    } catch (e) {
        alert("Network error deleting note");
    }
}

// Jump to specific strategy note from strategy modal
function jumpToStrategyNote() {
    if (!window.currentActiveModalDep || !window.currentActiveModalDep.strategy) return;
    const strat = window.currentActiveModalDep.strategy;
    
    if (typeof hideModal === 'function') hideModal();
    if (typeof switchViewMode === 'function') switchViewMode('notes');

    const note = allNotes.find(n => n.strategyId === strat.id || (n.category === 'Strategy' && n.title.toLowerCase().includes(strat.name.toLowerCase())));
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
            alert(`No strategy notes available yet for ${strat.name}.`);
        }
    }
}
