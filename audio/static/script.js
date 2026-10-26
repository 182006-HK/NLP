// ═══════════════════════════════════════════════════════════════════════════
//  StudyScribe – script.js
//  Handles: YouTube/Upload input → transcript scrape → AI summarize →
//           Study Tabs (Summary | Notes | Transcript | Keywords)
// ═══════════════════════════════════════════════════════════════════════════

// ── Global State ─────────────────────────────────────────────────────────────
const state = {
    mode: 'youtube',
    currentVideoId: null,
    youtubeUrl: '',
    uploadedFile: null,
    isUploaded: false,
    customKeywords: [],
    analysisData: null,
    summaryData: null,
    segments: [],
    metadata: null,
    player: null,
    playerReady: false,
    syncInterval: null,
    keywordColorMap: new Map(),
    activeStudyTab: 'summary',
};

const COLOR_CLASSES = [
    'kw-idx-0','kw-idx-1','kw-idx-2','kw-idx-3','kw-idx-4','kw-idx-5','kw-idx-6'
];
const CH_COLORS = 6; // ch-color-0 … ch-color-5

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initPresetButtons();
    initTagInput();
    initScrapeButton();
    initFileUpload();
    initExportButtons();
    initLocalPlayerEvents();
    initViewModeToggles();
    initStudyTabs();
    initTranscriptSearch();
});

// ═════════════════════════════════════════════════════════════════════════════
//  INPUT TABS (YouTube / Upload)
// ═════════════════════════════════════════════════════════════════════════════
function initTabs() {
    const tabYt  = document.getElementById('tabYoutube');
    const tabUp  = document.getElementById('tabUpload');
    const ctYt   = document.getElementById('youtubeTabContent');
    const ctUp   = document.getElementById('uploadTabContent');

    tabYt.addEventListener('click', () => {
        state.mode = 'youtube';
        tabYt.classList.add('active');    tabUp.classList.remove('active');
        ctYt.classList.remove('hidden');  ctUp.classList.add('hidden');
    });
    tabUp.addEventListener('click', () => {
        state.mode = 'upload';
        tabUp.classList.add('active');    tabYt.classList.remove('active');
        ctUp.classList.remove('hidden');  ctYt.classList.add('hidden');
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  PRESET BUTTONS
// ═════════════════════════════════════════════════════════════════════════════
function initPresetButtons() {
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const url = btn.getAttribute('data-url');
            document.getElementById('youtubeUrlInput').value = url;
            document.getElementById('tabYoutube').click();
            startStudyProcess();
        });
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  CUSTOM TAG INPUT
// ═════════════════════════════════════════════════════════════════════════════
function initTagInput() {
    const input = document.getElementById('customKeywordsInput');
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const val = input.value.trim().replace(/^,|,$/g, '');
            if (val && !state.customKeywords.includes(val)) {
                addCustomTag(val);
                input.value = '';
                triggerReanalysis();
            }
        }
    });
}

function addCustomTag(kw) { state.customKeywords.push(kw); renderTagsList(); }

function removeCustomTag(kw) {
    state.customKeywords = state.customKeywords.filter(k => k !== kw);
    renderTagsList();
    triggerReanalysis();
}

function renderTagsList() {
    const c = document.getElementById('tagsList');
    c.innerHTML = '';
    state.customKeywords.forEach(kw => {
        const t = document.createElement('div');
        t.className = 'tag-item';
        t.innerHTML = `<span>${escapeHtml(kw)}</span>
            <span class="btn-remove-tag" onclick="removeCustomTag('${escapeJsStr(kw)}')">&times;</span>`;
        c.appendChild(t);
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  STUDY TABS
// ═════════════════════════════════════════════════════════════════════════════
function initStudyTabs() {
    const tabs = [
        { id: 'tabSummary',    panel: 'panelSummary',    key: 'summary'    },
        { id: 'tabNotes',      panel: 'panelNotes',      key: 'notes'      },
        { id: 'tabTranscript', panel: 'panelTranscript', key: 'transcript' },
        { id: 'tabKeywords',   panel: 'panelKeywords',   key: 'keywords'   },
    ];
    tabs.forEach(({ id, panel, key }) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('click', () => {
            tabs.forEach(t => {
                document.getElementById(t.id)?.classList.remove('active');
                document.getElementById(t.panel)?.classList.add('hidden');
            });
            btn.classList.add('active');
            document.getElementById(panel)?.classList.remove('hidden');
            state.activeStudyTab = key;
        });
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN STUDY PROCESS  (scrape → analyze → summarize)
// ═════════════════════════════════════════════════════════════════════════════
function initScrapeButton() {
    const btn   = document.getElementById('scrapeBtn');
    const input = document.getElementById('youtubeUrlInput');
    btn.addEventListener('click', startStudyProcess);
    input.addEventListener('keypress', e => { if (e.key === 'Enter') startStudyProcess(); });
}

async function startStudyProcess() {
    const url = document.getElementById('youtubeUrlInput').value.trim();
    if (!url) { showError('Please enter a valid YouTube URL or Video ID.'); return; }

    state.youtubeUrl = url;
    state.isUploaded = false;
    hideError();
    showLoading();
    setLoadingStep(1);

    try {
        // Step 1: Fetch transcript + keywords
        const scrapeRes = await fetch('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, custom_keywords: state.customKeywords }),
        });
        const scrapeData = await scrapeRes.json();

        if (!scrapeRes.ok || !scrapeData.success) {
            hideLoading();
            showError(scrapeData.error || scrapeData.detail || 'Failed to fetch transcript.');
            return;
        }

        setLoadingStep(2);
        state.metadata     = scrapeData.metadata;
        state.currentVideoId = scrapeData.metadata.video_id;
        state.segments     = scrapeData.segments;
        state.analysisData = scrapeData.analysis;

        // Step 3: Summarize
        setLoadingStep(3);
        const sumData = await fetchSummary(state.segments);
        setLoadingStep(4);

        hideLoading();
        state.summaryData = sumData;

        showDashboard();
        switchPlayerMode(false);
        initYouTubePlayer(state.currentVideoId);
        renderAll();

    } catch (err) {
        hideLoading();
        showError('Network or server error: ' + err.message);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE UPLOAD PROCESS
// ═════════════════════════════════════════════════════════════════════════════
function initFileUpload() {
    const zone     = document.getElementById('dropzone');
    const input    = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadProcessBtn');

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
        e.preventDefault(); zone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', e => {
        if (e.target.files.length) handleFileSelect(e.target.files[0]);
    });
    uploadBtn.addEventListener('click', startFileUploadProcess);
}

function handleFileSelect(file) {
    state.uploadedFile = file;
    const display = document.getElementById('selectedFileName');
    const btn     = document.getElementById('uploadProcessBtn');
    display.textContent = `Selected: ${file.name} (${(file.size/(1024*1024)).toFixed(2)} MB)`;
    display.classList.remove('hidden');
    btn.disabled = false;
}

async function startFileUploadProcess() {
    if (!state.uploadedFile) return;
    hideError();
    showLoading();
    setLoadingStep(1);

    const fd = new FormData();
    fd.append('file', state.uploadedFile);
    fd.append('custom_keywords', JSON.stringify(state.customKeywords));

    try {
        const res  = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await res.json();

        if (!res.ok || !data.success) {
            hideLoading();
            showError(data.error || data.detail || 'Failed to transcribe uploaded file.');
            return;
        }

        setLoadingStep(2);
        state.isUploaded   = true;
        state.metadata     = data.metadata;
        state.segments     = data.segments;
        state.analysisData = data.analysis;

        setLoadingStep(3);
        const sumData = await fetchSummary(state.segments);
        setLoadingStep(4);

        hideLoading();
        state.summaryData = sumData;

        showDashboard();
        switchPlayerMode(true, data.metadata.media_url);
        renderAll();

    } catch (err) {
        hideLoading();
        showError('File processing error: ' + err.message);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  SUMMARIZE API CALL
// ═════════════════════════════════════════════════════════════════════════════
async function fetchSummary(segments) {
    try {
        const res  = await fetch('/api/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments }),
        });
        const data = await res.json();
        return data.success ? data : null;
    } catch {
        return null;
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  RE-ANALYSIS (custom keyword change)
// ═════════════════════════════════════════════════════════════════════════════
async function triggerReanalysis() {
    if (!state.segments.length) return;
    try {
        const res  = await fetch('/api/analyze-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments: state.segments, custom_keywords: state.customKeywords }),
        });
        const data = await res.json();
        if (data.success) {
            state.analysisData = data.analysis;
            renderKeywordStats();
            renderNumberedOccurrences();
            renderSequentialTimeline();
            renderTranscript();
        }
    } catch (e) { console.error('Re-analysis error:', e); }
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDER ALL
// ═════════════════════════════════════════════════════════════════════════════
function renderAll() {
    renderVideoMeta();
    renderKeywordStats();
    renderNumberedOccurrences();
    renderSequentialTimeline();
    renderTranscript();
    if (state.summaryData) {
        renderSummary(state.summaryData);
        renderDetailedNotes(state.summaryData);
        renderChapterNav(state.summaryData.chapters);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  VIDEO PLAYER
// ═════════════════════════════════════════════════════════════════════════════
function switchPlayerMode(isUploaded, mediaUrl = '') {
    const ytW  = document.getElementById('youtubePlayerWrapper');
    const locW = document.getElementById('localMediaWrapper');
    const vid  = document.getElementById('localVideoPlayer');
    if (isUploaded) {
        ytW.classList.add('hidden'); locW.classList.remove('hidden');
        if (mediaUrl) vid.src = mediaUrl;
    } else {
        locW.classList.add('hidden'); ytW.classList.remove('hidden');
        if (vid) vid.pause();
    }
}

function initLocalPlayerEvents() {
    const v = document.getElementById('localVideoPlayer');
    v.addEventListener('timeupdate', () => {
        if (state.isUploaded) highlightActiveSegment(v.currentTime);
    });
}

function initYouTubePlayer(videoId) {
    if (state.player && typeof state.player.loadVideoById === 'function') {
        state.player.loadVideoById(videoId); return;
    }
    if (window.YT && window.YT.Player) {
        state.player = new YT.Player('player', {
            videoId,
            playerVars: { playsinline: 1, autoplay: 0, rel: 0 },
            events: {
                onReady: () => { state.playerReady = true; },
                onStateChange: e => {
                    if (e.data === YT.PlayerState.PLAYING) startSyncTimer();
                    else stopSyncTimer();
                },
            },
        });
    } else {
        window.onYouTubeIframeAPIReady = () => initYouTubePlayer(videoId);
    }
}

function seekToTime(seconds) {
    if (state.isUploaded) {
        const v = document.getElementById('localVideoPlayer');
        v.currentTime = seconds; v.play();
    } else if (state.player && typeof state.player.seekTo === 'function') {
        state.player.seekTo(seconds, true);
        state.player.playVideo();
    }
    highlightActiveSegment(seconds);
    highlightChapterNavItem(seconds);
}

function startSyncTimer() {
    stopSyncTimer();
    state.syncInterval = setInterval(() => {
        if (state.player && typeof state.player.getCurrentTime === 'function') {
            const t = state.player.getCurrentTime();
            highlightActiveSegment(t);
            highlightChapterNavItem(t);
        }
    }, 400);
}
function stopSyncTimer() {
    if (state.syncInterval) { clearInterval(state.syncInterval); state.syncInterval = null; }
}

function highlightActiveSegment(t) {
    const lines = document.querySelectorAll('.transcript-line');
    let found = false;
    lines.forEach(line => {
        const s = parseFloat(line.getAttribute('data-start'));
        const e = parseFloat(line.getAttribute('data-end'));
        if (!found && t >= s && t <= e + 0.5) {
            line.classList.add('active'); found = true;
            line.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            const ct = document.getElementById('captionText');
            const sc = line.querySelector('.segment-content');
            if (ct && sc) ct.innerHTML = sc.innerHTML;
        } else {
            line.classList.remove('active');
        }
    });
}

function highlightChapterNavItem(t) {
    if (!state.summaryData?.chapters) return;
    const chapters = state.summaryData.chapters;
    let active = chapters[0];
    for (const ch of chapters) {
        if (t >= ch.start) active = ch; else break;
    }
    document.querySelectorAll('.chapter-nav-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-ch') == active.chapter_num);
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDER — VIDEO META
// ═════════════════════════════════════════════════════════════════════════════
function renderVideoMeta() {
    const meta = state.metadata;
    document.getElementById('videoTitle').textContent   = meta.title;
    document.getElementById('videoAuthor').textContent  = meta.author;
    const lastSeg = state.segments[state.segments.length - 1];
    document.getElementById('videoDuration').textContent = fmtSec(lastSeg?.end || 0);
    document.getElementById('videoSegments').textContent = state.analysisData.total_segments;
    document.getElementById('videoWordCount').textContent = state.analysisData.total_words;
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDER — QUICK SUMMARY
// ═════════════════════════════════════════════════════════════════════════════
function renderSummary(data) {
    // TL;DR
    document.getElementById('summaryTldr').textContent = data.overall_summary || '(No summary generated.)';

    // Takeaways
    const list = document.getElementById('takeawayList');
    list.innerHTML = '';
    (data.key_takeaways || []).forEach((t, i) => {
        const li = document.createElement('li');
        li.className = 'takeaway-item';
        li.innerHTML = `<span class="takeaway-bullet">${i+1}</span><span>${escapeHtml(t)}</span>`;
        list.appendChild(li);
    });
    if (!data.key_takeaways?.length) {
        list.innerHTML = '<li class="takeaway-placeholder">No takeaways extracted.</li>';
    }

    // Chapter milestones
    const ml = document.getElementById('milestoneList');
    ml.innerHTML = '';
    (data.chapters || []).forEach(ch => {
        const item = document.createElement('div');
        item.className = 'milestone-item';
        item.setAttribute('title', `Jump to ${ch.timestamp}`);
        item.onclick = () => seekToTime(ch.start);
        item.innerHTML = `
            <span class="milestone-num">${ch.chapter_num}</span>
            <span class="milestone-ts">${ch.timestamp}</span>
            <span class="milestone-title">${escapeHtml(ch.title)}</span>
            <i class="fa-solid fa-arrow-right milestone-arrow"></i>`;
        ml.appendChild(item);
    });
    if (!data.chapters?.length) {
        ml.innerHTML = '<div class="milestone-placeholder">No chapters extracted.</div>';
    }

    // Hook export/copy buttons
    document.getElementById('btnExportSummaryMd')?.addEventListener('click', exportNotesMd);
    document.getElementById('btnCopySummary')?.addEventListener('click', () => {
        copyToClipboard(data.overall_summary || '', document.getElementById('btnCopySummary'));
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDER — DETAILED NOTES
// ═════════════════════════════════════════════════════════════════════════════
function renderDetailedNotes(data) {
    const article = document.getElementById('notesArticle');
    article.innerHTML = '';

    if (!data?.chapters?.length) {
        article.innerHTML = `<div class="notes-placeholder">
            <i class="fa-solid fa-pen-nib"></i>
            <p>No chapters generated.</p></div>`;
        return;
    }

    data.chapters.forEach((ch, i) => {
        const colorIdx = i % CH_COLORS;
        const card = document.createElement('div');
        card.className = 'chapter-card';

        let bulletsHtml = '';
        if (ch.bullets?.length) {
            bulletsHtml = `<p class="chapter-bullets-title">Key Points</p>
                <ul class="chapter-bullets">
                    ${ch.bullets.map(b => `<li class="chapter-bullet-item">${escapeHtml(b)}</li>`).join('')}
                </ul>`;
        }
        let termsHtml = '';
        if (ch.key_terms?.length) {
            termsHtml = `<p class="chapter-terms-title">Core Terms</p>
                <div class="chapter-terms">
                    ${ch.key_terms.map(t => `<span class="chapter-term-pill">${escapeHtml(t)}</span>`).join('')}
                </div>`;
        }

        card.innerHTML = `
            <div class="chapter-card-header ch-color-${colorIdx}">
                <div class="chapter-card-label">
                    <span class="chapter-num-badge ch-num-${colorIdx}">CH ${ch.chapter_num}</span>
                    <span class="chapter-card-title">${escapeHtml(ch.title)}</span>
                </div>
                <button class="chapter-ts-btn" onclick="seekToTime(${ch.start})">
                    <i class="fa-solid fa-play"></i> ${ch.timestamp}
                </button>
            </div>
            <div class="chapter-card-body">
                <p class="chapter-summary-text">${escapeHtml(ch.summary)}</p>
                ${bulletsHtml}
                ${termsHtml}
            </div>`;
        article.appendChild(card);
    });

    // Hook toolbar buttons
    document.getElementById('btnExportNotesMd')?.addEventListener('click', exportNotesMd);
    document.getElementById('btnCopyNotes')?.addEventListener('click', () => {
        copyToClipboard(data.notes_markdown || '', document.getElementById('btnCopyNotes'));
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDER — CHAPTER NAVIGATOR (left column)
// ═════════════════════════════════════════════════════════════════════════════
function renderChapterNav(chapters) {
    const card = document.getElementById('chapterNavCard');
    const list = document.getElementById('chapterNavList');
    const count = document.getElementById('chapterNavCount');

    if (!chapters?.length) { card.classList.add('hidden'); return; }

    card.classList.remove('hidden');
    count.textContent = `${chapters.length} chapter${chapters.length > 1 ? 's' : ''}`;
    list.innerHTML = '';

    chapters.forEach((ch, i) => {
        const colorIdx = i % CH_COLORS;
        const item = document.createElement('div');
        item.className = 'chapter-nav-item';
        item.setAttribute('data-ch', ch.chapter_num);
        item.onclick = () => seekToTime(ch.start);
        item.innerHTML = `
            <span class="nav-ch-badge ch-num-${colorIdx}">${ch.chapter_num}</span>
            <span class="nav-ch-ts">${ch.timestamp}</span>
            <span class="nav-ch-title">${escapeHtml(ch.title)}</span>`;
        list.appendChild(item);
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDER — TRANSCRIPT (with search)
// ═════════════════════════════════════════════════════════════════════════════
function initTranscriptSearch() {
    const input = document.getElementById('transcriptSearch');
    if (!input) return;
    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        filterTranscript(q);
    });
}

function renderTranscript() {
    const container = document.getElementById('transcriptContainer');
    container.innerHTML = '';

    const kwCounters = new Map();
    state.analysisData.keyword_stats.forEach(s => kwCounters.set(s.keyword.toLowerCase(), 1));
    const keywords = state.analysisData.keyword_stats.map(s => s.keyword);

    state.segments.forEach((seg, idx) => {
        const line = document.createElement('div');
        line.className = 'transcript-line';
        line.setAttribute('data-start', seg.start);
        line.setAttribute('data-end', seg.end);
        line.setAttribute('data-index', idx);
        line.setAttribute('data-text', seg.text.toLowerCase());

        const highlighted = applyKwHighlightsWithNums(seg.text, keywords, kwCounters);
        line.innerHTML = `
            <button class="timestamp-btn" onclick="seekToTime(${seg.start})">${fmtSec(seg.start)}</button>
            <div class="segment-content">${highlighted}</div>`;
        line.addEventListener('click', e => {
            if (!e.target.classList.contains('timestamp-btn')) seekToTime(seg.start);
        });
        container.appendChild(line);
    });
}

function filterTranscript(query) {
    const lines = document.querySelectorAll('.transcript-line');
    const countEl = document.getElementById('searchMatchCount');
    let matches = 0;

    lines.forEach(line => {
        const text = line.getAttribute('data-text') || '';
        if (!query) {
            line.classList.remove('hidden');
            const sc = line.querySelector('.segment-content');
            if (sc) sc.innerHTML = sc.innerHTML.replace(/<mark class="search-hl">([^<]*)<\/mark>/g, '$1');
        } else {
            if (text.includes(query)) {
                line.classList.remove('hidden');
                matches++;
                const sc = line.querySelector('.segment-content');
                if (sc) {
                    const clean = sc.innerHTML.replace(/<mark class="search-hl">([^<]*)<\/mark>/g, '$1');
                    const regex = new RegExp('(' + escapeRegExp(query) + ')', 'gi');
                    sc.innerHTML = clean.replace(regex, '<mark class="search-hl">$1</mark>');
                }
            } else {
                line.classList.add('hidden');
            }
        }
    });

    if (countEl) {
        if (query) {
            countEl.textContent = `${matches} match${matches !== 1 ? 'es' : ''}`;
            countEl.classList.remove('hidden');
        } else {
            countEl.classList.add('hidden');
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDER — KEYWORD STATS (Keywords tab)
// ═════════════════════════════════════════════════════════════════════════════
function renderKeywordStats() {
    const stats  = state.analysisData.keyword_stats;
    const tbody  = document.getElementById('statsTableBody');
    const chipC  = document.getElementById('keywordsChipContainer');

    if (!tbody || !chipC) return;
    tbody.innerHTML = ''; chipC.innerHTML = '';
    state.keywordColorMap.clear();

    const kwEl = document.getElementById('activeKwCount');
    if (kwEl) kwEl.textContent = `${stats.length} Keywords`;

    stats.forEach((item, idx) => {
        const cc = COLOR_CLASSES[idx % COLOR_CLASSES.length];
        state.keywordColorMap.set(item.keyword.toLowerCase(), cc);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><span class="kw-highlight ${cc}">${escapeHtml(item.keyword)}</span></td>
            <td><span class="type-badge ${item.is_custom ? 'custom' : 'auto'}">${item.is_custom ? 'Custom' : 'Auto'}</span></td>
            <td><span class="freq-count-badge">${item.frequency}</span></td>
            <td>${item.density_percent}%</td>
            <td>${item.occurrences.length
                ? `<button class="btn-icon-sm" onclick="seekToTime(${item.occurrences[0].start})"><i class="fa-solid fa-play"></i></button>`
                : '-'}</td>`;
        tbody.appendChild(row);

        const chip = document.createElement('div');
        chip.className = `kw-chip ${cc}`;
        chip.innerHTML = `<span>${escapeHtml(item.keyword)}</span><span class="count-pill">${item.frequency}</span>`;
        chip.addEventListener('click', () => { if (item.occurrences.length) seekToTime(item.occurrences[0].start); });
        chipC.appendChild(chip);
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDER — NUMBERED OCCURRENCES (Keywords tab – grouped)
// ═════════════════════════════════════════════════════════════════════════════
function renderNumberedOccurrences() {
    const c = document.getElementById('occurrencesListContainer');
    if (!c) return;
    c.innerHTML = '';

    state.analysisData.keyword_stats.forEach(item => {
        if (!item.occurrences?.length) return;
        const cc = state.keywordColorMap.get(item.keyword.toLowerCase()) || 'kw-idx-0';
        const grp = document.createElement('div');
        grp.className = 'kw-occurrence-group';
        grp.innerHTML = `
            <div class="kw-group-header">
                <span class="kw-title kw-highlight ${cc}">${escapeHtml(item.keyword)}</span>
                <span class="subtext">${item.frequency} uses</span>
            </div>
            <div class="occurrence-chips-wrapper">
                ${item.occurrences.map(o => `
                    <button class="occurrence-chip" onclick="seekToTime(${o.start})">
                        <span class="num-badge">#${o.occurrence_num}</span>
                        <span>${fmtSec(o.start)}</span>
                    </button>`).join('')}
            </div>`;
        c.appendChild(grp);
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  RENDER — SEQUENTIAL KEYWORD TIMELINE
// ═════════════════════════════════════════════════════════════════════════════
function initViewModeToggles() {
    const btnSeq = document.getElementById('btnViewSequential');
    const btnGrp = document.getElementById('btnViewGrouped');
    const cSeq   = document.getElementById('sequentialTimelineContainer');
    const cGrp   = document.getElementById('occurrencesListContainer');
    const sub    = document.getElementById('occurrenceSubtext');

    if (!btnSeq || !btnGrp) return;

    btnSeq.addEventListener('click', () => {
        btnSeq.classList.add('active'); btnGrp.classList.remove('active');
        cSeq.classList.remove('hidden'); cGrp.classList.add('hidden');
        if (sub) sub.textContent = 'Keywords in chronological speech order';
    });
    btnGrp.addEventListener('click', () => {
        btnGrp.classList.add('active'); btnSeq.classList.remove('active');
        cGrp.classList.remove('hidden'); cSeq.classList.add('hidden');
        if (sub) sub.textContent = 'Click #N to jump to that occurrence';
    });
}

function renderSequentialTimeline() {
    const c = document.getElementById('sequentialTimelineContainer');
    if (!c) return;
    c.innerHTML = '';

    const seqItems = state.analysisData?.sequential_occurrences || [];
    if (!seqItems.length) {
        c.innerHTML = '<div class="empty-state">No keyword hits detected. Add custom keywords above.</div>';
        return;
    }

    seqItems.forEach(item => {
        const cc = state.keywordColorMap.get(item.keyword.toLowerCase()) || 'kw-idx-0';
        const card = document.createElement('div');
        card.className = 'seq-item-card';
        const ctx = applyKwHighlightSingle(item.segment_text, item.keyword, cc);
        card.innerHTML = `
            <div class="seq-item-left">
                <span class="seq-order-badge">#${item.sequence_num}</span>
                <button class="timestamp-btn" onclick="seekToTime(${item.start})">
                    <i class="fa-solid fa-play"></i> ${fmtSec(item.start)}</button>
            </div>
            <div class="seq-item-body">
                <div class="seq-item-header">
                    <span class="kw-highlight ${cc}">${escapeHtml(item.keyword)}</span>
                    <span class="seq-occ-badge">Occ. #${item.occurrence_num} / ${item.total_keyword_occurrences}</span>
                </div>
                <div class="seq-item-snippet">${ctx}</div>
            </div>`;
        card.addEventListener('click', e => {
            if (!e.target.classList.contains('timestamp-btn') && !e.target.closest('.timestamp-btn'))
                seekToTime(item.start);
        });
        c.appendChild(card);
    });
}

// ═════════════════════════════════════════════════════════════════════════════
//  KEYWORD HIGHLIGHTING HELPERS
// ═════════════════════════════════════════════════════════════════════════════
function applyKwHighlightsWithNums(text, keywords, counters) {
    if (!keywords.length) return escapeHtml(text);
    const sorted  = [...keywords].sort((a, b) => b.length - a.length);
    const pattern = new RegExp('\\b(' + sorted.map(escapeRegExp).join('|') + ')\\b', 'gi');
    return text.replace(pattern, match => {
        const lk = match.toLowerCase();
        const cc = state.keywordColorMap.get(lk) || 'kw-idx-0';
        const n  = counters.get(lk) || 1;
        counters.set(lk, n + 1);
        return `<span class="kw-highlight ${cc}">${escapeHtml(match)} <sup class="kw-num">#${n}</sup></span>`;
    });
}

function applyKwHighlightSingle(text, kw, cc) {
    if (!text || !kw) return escapeHtml(text || '');
    const p = new RegExp('\\b(' + escapeRegExp(kw) + ')\\b', 'gi');
    return text.replace(p, m => `<span class="kw-highlight ${cc}">${escapeHtml(m)}</span>`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  EXPORT BUTTONS
// ═════════════════════════════════════════════════════════════════════════════
function initExportButtons() {
    document.getElementById('btnExportTxt')?.addEventListener('click', () => {
        if (!state.segments.length) return;
        let c = `Transcript: ${state.metadata?.title || ''}\n\n--- KEYWORDS ---\n`;
        state.analysisData.keyword_stats.forEach(s => {
            c += `[${s.keyword}] Freq: ${s.frequency}\n`;
            s.occurrences.forEach(o => { c += `   #${o.occurrence_num}: ${fmtSec(o.start)} – ${o.segment_text}\n`; });
        });
        c += `\n--- TRANSCRIPT ---\n`;
        state.segments.forEach(s => { c += `[${fmtSec(s.start)}] ${s.text}\n`; });
        downloadFile(c, 'transcript.txt', 'text/plain');
    });

    document.getElementById('btnExportJson')?.addEventListener('click', () => {
        if (!state.segments.length) return;
        downloadFile(
            JSON.stringify({ metadata: state.metadata, analysis: state.analysisData, summary: state.summaryData, segments: state.segments }, null, 2),
            'studyscribe_export.json', 'application/json'
        );
    });

    document.getElementById('btnExportCsv')?.addEventListener('click', () => {
        if (!state.analysisData) return;
        let csv = 'Keyword,Occurrence,Start,End,Segment\n';
        state.analysisData.keyword_stats.forEach(s => {
            s.occurrences.forEach(o => {
                csv += `"${s.keyword.replace(/"/g,'""')}",${o.occurrence_num},${o.start},${o.end},"${o.segment_text.replace(/"/g,'""')}"\n`;
            });
        });
        downloadFile(csv, 'keywords.csv', 'text/csv');
    });
}

function exportNotesMd() {
    if (!state.summaryData?.notes_markdown) return;
    const title = (state.metadata?.title || 'StudyNotes').replace(/[^a-z0-9]/gi, '_');
    downloadFile(state.summaryData.notes_markdown, `${title}_notes.md`, 'text/markdown');
}

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        if (!btn) return;
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
    }).catch(() => {});
}

function downloadFile(content, name, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
}

// ═════════════════════════════════════════════════════════════════════════════
//  LOADING STATE HELPERS
// ═════════════════════════════════════════════════════════════════════════════
function showLoading() {
    document.getElementById('loadingOverlay').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    [1,2,3,4].forEach(n => {
        const el = document.getElementById(`step${n}`);
        if (el) { el.classList.remove('active','done'); }
    });
}
function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }

function setLoadingStep(n) {
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById(`step${i}`);
        if (!el) continue;
        el.classList.remove('active','done');
        if (i < n) el.classList.add('done');
        else if (i === n) el.classList.add('active');
    }
    const messages = [
        '', 'Fetching transcript...', 'Analyzing keywords...',
        'Generating chapter summaries...', 'Building study notes...'
    ];
    const statusEl = document.getElementById('loadingStatusText');
    if (statusEl && messages[n]) statusEl.textContent = messages[n];
}

function showDashboard() { document.getElementById('dashboard').classList.remove('hidden'); }

function showError(msg) {
    document.getElementById('errorMessage').textContent = msg;
    document.getElementById('errorBox').classList.remove('hidden');
}
function hideError() { document.getElementById('errorBox').classList.add('hidden'); }

// ═════════════════════════════════════════════════════════════════════════════
//  UTILITY
// ═════════════════════════════════════════════════════════════════════════════
function fmtSec(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}
function escapeHtml(s) {
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function escapeJsStr(s) { return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
