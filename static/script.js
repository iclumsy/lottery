document.addEventListener('DOMContentLoaded', () => {
    const errorMsg = document.getElementById('errorMsg');
    const inputDisplay = document.getElementById('inputDisplay');
    const statsDisplay = document.getElementById('statsDisplay');
    const fetchNetBtn = document.getElementById('fetchNetBtn');
    const limitInput = document.getElementById('limitInput');
    const latestResultBanner = document.getElementById('latestResultBanner');
    const bannerDate = document.getElementById('bannerDate');
    const latestNumbersDisplay = document.getElementById('latestNumbersDisplay');
    const matrixSourceModeInput = document.getElementById('matrixSourceModeInput');
    const matrixSourceModeControl = document.getElementById('matrixSourceModeControl');
    const matrixSourceModeToggleBtn = document.getElementById('matrixSourceModeToggleBtn');
    const matrixLimitInput = document.getElementById('matrixLimitInput');
    const matrixLimitControl = document.getElementById('matrixLimitControl');
    const matrixLimitToggleBtn = document.getElementById('matrixLimitToggleBtn');

    const periodSumControls = document.getElementById('periodSumControls');
    const currentPeriodLabel = document.getElementById('currentPeriodLabel');
    const openMatrixBtn = document.getElementById('openMatrixBtn');
    const matrixOverlay = document.getElementById('matrixOverlay');
    const matrixShell = matrixOverlay ? matrixOverlay.querySelector('.matrix-shell') : null;
    const matrixTopbarToggleBtn = document.getElementById('matrixTopbarToggleBtn');
    const matrixTopbarTools = document.getElementById('matrixTopbarTools');
    const closeMatrixBtn = document.getElementById('closeMatrixBtn');
    const matrixPosControls = document.getElementById('matrixPosControls');
    const matrixTopbarActions = matrixShell ? matrixShell.querySelector('.matrix-topbar-actions') : null;
    const matrixComboInfo = document.getElementById('matrixComboInfo');
    const matrixNextStats = document.getElementById('matrixNextStats');
    const matrixMatchPanel = document.getElementById('matrixMatchPanel');
    const matrixToggleRowIdsBtn = document.getElementById('matrixToggleRowIdsBtn');
    const matrixToggleMatchBtn = document.getElementById('matrixToggleMatchBtn');
    const matrixTableWrap = document.getElementById('matrixTableWrap');
    const matrixSizeControl = document.getElementById('matrixSizeControl');
    const matrixSizeToggleBtn = document.getElementById('matrixSizeToggleBtn');
    const matrixSearchInput = document.getElementById('matrixSearchInput');
    const matrixSearchBtn = document.getElementById('matrixSearchBtn');
    const matrixClearSearchBtn = document.getElementById('matrixClearSearchBtn');
    const MATRIX_SEARCH_MIN_LEN = 3;
    const MATRIX_SEARCH_MAX_LEN = 24;
    const MATRIX_CELL_SIZE_STORAGE_KEY = 'lottery_matrix_cell_size';
    const MATRIX_MATCH_LAST_COL_MIN = 2;
    const MATRIX_MATCH_LAST_COL_MAX = 6;
    const MATRIX_SOURCE_MODE_LABELS = {
        normal: '正常',
        skip1: '隔 1 期',
        skip2: '隔 2 期',
        skip3: '隔 3 期',
        skip4: '隔 4 期',
        skip5: '隔 5 期',
        skip6: '隔 6 期',
        mod5: '模 5',
    };
    const MATRIX_SOURCE_MODE_SHORT_LABELS = {
        normal: '正常',
        skip1: '隔1',
        skip2: '隔2',
        skip3: '隔3',
        skip4: '隔4',
        skip5: '隔5',
        skip6: '隔6',
        mod5: '模5',
    };
    const UPDATE_BTN_BASE_TEXT = '更新开奖';

    let netLines = null;
    let latestOpenDate = '';
    let latestOpenNumbers = '';
    let currentPeriodSum = 1;
    let currentSourceLines = [];
    let currentSourceExpects = [];
    let isRetreatMode = false;

    function getEffectiveLines(lines) {
        if (!lines || lines.length === 0) return lines;
        return isRetreatMode ? lines.slice(0, -1) : lines;
    }

    function getEffectiveExpects(expects, lines) {
        if (!expects || expects.length === 0) return expects;
        return isRetreatMode ? expects.slice(0, -1) : expects;
    }
    const matrixState = {
        allRows: [],
        allRowLabels: [],
        baseRows: [],
        expandedRows: [],
        rowLabels: [],
        sourceMode: 'normal',
        selectedPositions: new Set(),
        selectedComboGroupsByPos: new Map(),
        selectedTraceGroupsByPos: new Map(),
        matchesByPos: new Map(),
        searchQuery: '',
        searchHitKeys: new Set(),
        matchPanelVisible: false,
        topbarToolsVisible: false,
        showRowIds: false,
        cellSize: 20,
        rowsPerPage: 1,
    };
    let matrixViewportRaf = 0;
    let matrixViewportSettleRaf = 0;
    let matrixTableCalibrationRaf = 0;
    let lastMatrixViewportSignature = null;

    function getMatrixViewportHeight() {
        if (window.visualViewport && Number.isFinite(window.visualViewport.height)) {
            return Math.max(320, Math.round(window.visualViewport.height));
        }
        return Math.max(320, Math.round(window.innerHeight || 0));
    }

    function getViewportWidth() {
        if (window.visualViewport && Number.isFinite(window.visualViewport.width)) {
            return Math.max(320, Math.round(window.visualViewport.width));
        }
        return Math.max(320, Math.round(window.innerWidth || 0));
    }

    function getDefaultMatrixCellSize() {
        const width = getViewportWidth();
        if (width <= 420) return 16;
        if (width <= 640) return 18;
        return 20;
    }

    function getPreferredMatrixCellSize() {
        const saved = parseInt(localStorage.getItem(MATRIX_CELL_SIZE_STORAGE_KEY) || '', 10);
        if (Number.isFinite(saved)) {
            return clampMatrixCellSize(saved);
        }
        return getDefaultMatrixCellSize();
    }

    function useCompactMatrixToolbarLabels() {
        return true;
    }

    function isCompactMatrixTopbar() {
        return getViewportWidth() <= 640;
    }

    function getMatrixViewportMode(width = getViewportWidth()) {
        if (width <= 640) return 'mobile';
        if (width <= 1024) return 'tablet';
        return 'desktop';
    }

    function captureMatrixViewportSignature() {
        const width = getViewportWidth();
        return {
            width,
            height: getMatrixViewportHeight(),
            mode: getMatrixViewportMode(width),
        };
    }

    function rememberMatrixViewportSignature(signature = captureMatrixViewportSignature()) {
        lastMatrixViewportSignature = signature;
    }

    function updateMatrixViewportHeight() {
        if (!matrixOverlay) return;
        matrixOverlay.style.setProperty('--matrix-viewport-height', `${getMatrixViewportHeight()}px`);
    }

    function closeMatrixOverlayState() {
        if (matrixOverlay) {
            matrixOverlay.classList.remove('show');
            matrixOverlay.setAttribute('aria-hidden', 'true');
        }
        cancelPendingMatrixViewportWork();
        if (matrixTableCalibrationRaf) {
            cancelAnimationFrame(matrixTableCalibrationRaf);
            matrixTableCalibrationRaf = 0;
        }
        setMatrixSourceModeOptionsOpen(false);
        setMatrixSizeOptionsOpen(false);
        setMatrixLimitOptionsOpen(false);
        setMatrixTopbarToolsVisible(false);
        document.body.classList.remove('matrix-open');
    }

    async function requestMatrixFullscreen() {
        // [Hotfix]: 移除原生的 requestFullscreen()
        // 因为原生全屏在部分移动端(如安卓 Chrome)下，如果元素较宽，会强制锁定屏幕为横屏(Landscape)。
        // 现统一改为依靠 CSS 的 position: fixed; inset: 0 满屏呈现。
        return true;
    }

    async function exitMatrixFullscreen() {
        // [Hotfix]: 移除原生的 exitFullscreen()
        return true;
    }

    function cancelPendingMatrixViewportWork() {
        if (matrixViewportRaf) {
            cancelAnimationFrame(matrixViewportRaf);
            matrixViewportRaf = 0;
        }
        if (matrixViewportSettleRaf) {
            cancelAnimationFrame(matrixViewportSettleRaf);
            matrixViewportSettleRaf = 0;
        }
    }

    function scheduleMatrixViewportUpdate(rebuild = false, nextSignature = null) {
        cancelPendingMatrixViewportWork();
        matrixViewportRaf = requestAnimationFrame(() => {
            matrixViewportRaf = 0;
            updateMatrixViewportHeight();
            if (rebuild && matrixOverlay && matrixOverlay.classList.contains('show')) {
                matrixViewportSettleRaf = requestAnimationFrame(() => {
                    matrixViewportSettleRaf = 0;
                    rebuildMatrixTableAndHighlights();
                });
                return;
            }
            rememberMatrixViewportSignature(nextSignature || captureMatrixViewportSignature());
        });
    }

    function normalizeLoadLimit(value) {
        const parsed = parseInt(String(value || ''), 10);
        if (!Number.isFinite(parsed)) return 300;
        const stepped = Math.round(parsed / 100) * 100;
        return Math.max(100, Math.min(1000, stepped));
    }

    function setLoadLimit(limitValue) {
        const normalized = normalizeLoadLimit(limitValue);
        const text = String(normalized);
        if (limitInput) limitInput.value = text;
        if (matrixLimitInput) matrixLimitInput.value = text;
        syncMatrixLimitControl();
        localStorage.setItem('lottery_load_limit', text);
        return normalized;
    }

    function getCurrentLoadLimit() {
        const fromMain = limitInput ? limitInput.value : null;
        const fromMatrix = matrixLimitInput ? matrixLimitInput.value : null;
        return normalizeLoadLimit(fromMain || fromMatrix || '300');
    }

    function normalizeMatrixSourceMode(value) {
        const normalized = String(value || '').trim();
        return Object.prototype.hasOwnProperty.call(MATRIX_SOURCE_MODE_LABELS, normalized)
            ? normalized
            : 'normal';
    }

    function getMatrixSourceModeLabel(mode, compact = useCompactMatrixToolbarLabels()) {
        const normalized = normalizeMatrixSourceMode(mode);
        return compact
            ? MATRIX_SOURCE_MODE_SHORT_LABELS[normalized]
            : `取号 ${MATRIX_SOURCE_MODE_LABELS[normalized]}`;
    }

    function getMatrixSourceModeStep(mode) {
        const normalized = normalizeMatrixSourceMode(mode);
        const skipMatch = normalized.match(/^skip([1-6])$/);
        if (skipMatch) {
            return parseInt(skipMatch[1], 10) + 1;
        }
        return 1;
    }

    function transformMatrixSourceRows(rows, mode) {
        const normalized = normalizeMatrixSourceMode(mode);
        if (normalized !== 'mod5') {
            return [...rows];
        }
        return rows.map(line => String(line || '').split('').map(ch => {
            const digit = parseInt(ch, 10);
            if (!Number.isFinite(digit)) return ch;
            return String(digit % 5);
        }).join(''));
    }

    function selectMatrixSourceRows(rows, rowLabels = [], mode = 'normal') {
        const safeRows = Array.isArray(rows) ? rows : [];
        const safeLabels = Array.isArray(rowLabels) && rowLabels.length === safeRows.length ? rowLabels : [];
        const step = getMatrixSourceModeStep(mode);
        if (step === 1) {
            return {
                rows: transformMatrixSourceRows(safeRows, mode),
                rowLabels: [...safeLabels],
            };
        }

        const selectedRows = [];
        const selectedLabels = [];
        for (let idx = safeRows.length - step; idx >= 0; idx -= step) {
            selectedRows.push(safeRows[idx]);
            if (safeLabels.length) {
                selectedLabels.push(safeLabels[idx]);
            }
        }
        selectedRows.reverse();
        selectedLabels.reverse();

        return {
            rows: transformMatrixSourceRows(selectedRows, mode),
            rowLabels: safeLabels.length ? selectedLabels : [],
        };
    }

    // Load saved limit from localStorage and bind instant reload.
    const savedLimit = localStorage.getItem('lottery_load_limit');
    setLoadLimit(savedLimit || getCurrentLoadLimit());

    // Sidebar toggle logic with floating edge tab
    const toggleSidebarBtn = document.getElementById('sidebarEdgeToggle');
    if (toggleSidebarBtn) {
        const container = document.querySelector('.container');
        
        // 强制默认折叠
        container.classList.add('sidebar-collapsed');

        toggleSidebarBtn.addEventListener('click', () => {
            container.classList.toggle('sidebar-collapsed');
        });
    }

    if (limitInput) {
        limitInput.addEventListener('change', async () => {
            const next = setLoadLimit(limitInput.value);
            await loadHistoryData(next);
        });
    }
    if (matrixLimitInput) {
        matrixLimitInput.addEventListener('change', async () => {
            const next = setLoadLimit(matrixLimitInput.value);
            await loadHistoryData(next);
        });
    }
    if (matrixSourceModeInput) {
        matrixSourceModeInput.addEventListener('change', () => {
            applyMatrixSourceMode(matrixSourceModeInput.value);
        });
    }

    // Build period sum buttons
    if (periodSumControls) {
        for (let i = 1; i <= 20; i++) {
            const btn = document.createElement('button');
            btn.className = 'sum-btn' + (i === 1 ? ' active' : '');
            btn.textContent = i === 1 ? '1 期' : `${i} 期和`;
            btn.addEventListener('click', () => {
                if (currentPeriodSum === i) return;

                periodSumControls.querySelectorAll('.sum-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentPeriodSum = i;
                if (currentPeriodLabel) {
                    currentPeriodLabel.textContent = i === 1 ? '1 期' : `${i} 期和`;
                }

                // Re-trigger analysis by current DB data
                if (netLines) doAnalyze(getEffectiveLines(netLines));
            });
            periodSumControls.appendChild(btn);
        }
    }

    // Auto load data on startup
    loadHistoryData();

    function normalizeLatestOpenDate(latestTime) {
        const raw = String(latestTime || '').trim();
        if (!raw) return '';
        const match = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (!match) return '';
        const [, y, m, d] = match;
        return `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    function refreshUpdateButtonText() {
        if (!fetchNetBtn) return;
        fetchNetBtn.textContent = UPDATE_BTN_BASE_TEXT;
        if (latestResultBanner && bannerDate) {
            if (latestOpenDate) {
                bannerDate.textContent = latestOpenDate;

                if (latestOpenNumbers && latestNumbersDisplay) {
                    const numArr = latestOpenNumbers.split('');
                    latestNumbersDisplay.innerHTML = numArr.map(n => `<span class="latest-number-ball">${n}</span>`).join('');
                }
                latestResultBanner.style.display = 'flex';
            } else {
                latestResultBanner.style.display = 'none';
            }
        }
    }

    function clampToUnit(value) {
        return Math.min(1, Math.max(0, value));
    }

    function clearDangerButtonStyle(btn) {
        [
            '--sum-danger-fill-width',
        ].forEach(prop => btn.style.removeProperty(prop));
        btn.removeAttribute('title');
    }

    function getDangerButtonStrength(excessGap, minExcess, maxExcess) {
        if (excessGap <= 0) return 0;
        if (maxExcess <= minExcess) return 1;
        const normalized = clampToUnit((excessGap - minExcess) / (maxExcess - minExcess));
        return 0.24 + (0.76 * Math.pow(normalized, 0.82));
    }

    function applyDangerButtonStyle(btn, maxGap, strength) {
        const fillWidth = `${Math.round(22 + (78 * strength))}%`;
        btn.style.setProperty('--sum-danger-fill-width', fillWidth);
        btn.title = `${btn.textContent} 最大遗漏 ${maxGap} 期`;
    }

    async function loadHistoryData(limitOverride = null) {
        const limit = setLoadLimit(limitOverride === null ? getCurrentLoadLimit() : limitOverride);
        const limitStr = String(limit);
        try {
            const res = await fetch(`/api/get_history?limit=${limitStr}`);
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 404) {
                    inputDisplay.innerHTML = '<p class="empty-hint">数据库为空，请点击上方更新按钮获取数据</p>';
                } else {
                    showError(data.error || '加载历史数据失败');
                }
                return;
            }

            netLines = data.data;
            currentSourceLines = [...netLines];
            currentSourceExpects = Array.isArray(data.expects) && data.expects.length === netLines.length
                ? data.expects.map(expect => String(expect || '').trim())
                : [];
            latestOpenDate = normalizeLatestOpenDate(data.latest_time);
            latestOpenNumbers = netLines.length > 0 ? netLines[netLines.length - 1].replace(/,/g, '') : '';
            refreshUpdateButtonText();

            const effectiveLines = getEffectiveLines(netLines);
            const effectiveExpects = getEffectiveExpects(currentSourceExpects, netLines);
            renderPreview(effectiveLines);
            doAnalyze(effectiveLines);
            refreshOpenMatrixData(effectiveLines, effectiveExpects);
        } catch (err) {
            showError('服务器未响应，请检查后端运行状态');
        }
    }

    function refreshOpenMatrixData(rows, rowLabels = currentSourceExpects) {
        if (!matrixOverlay || !matrixOverlay.classList.contains('show')) return;
        if (!rows || rows.length < 3) return;
        if (!rows.every(line => /^\d{5}$/.test(line))) return;
        matrixState.allRows = [...rows];
        matrixState.allRowLabels = Array.isArray(rowLabels) && rowLabels.length === rows.length
            ? [...rowLabels]
            : [];
        applyMatrixSourceMode(matrixState.sourceMode);
    }

    if (openMatrixBtn) {
        openMatrixBtn.addEventListener('click', openMatrixView);
    }
    if (closeMatrixBtn) {
        closeMatrixBtn.addEventListener('click', closeMatrixView);
    }
    if (matrixOverlay) {
        matrixOverlay.addEventListener('click', e => {
            if (e.target === matrixOverlay) {
                closeMatrixView();
            }
        });
    }
    if (matrixPosControls) {
        matrixPosControls.addEventListener('click', e => {
            const btn = e.target.closest('.matrix-pos-btn');
            if (!btn) return;
            const pos = parseInt(btn.dataset.pos || '', 10);
            if (!Number.isInteger(pos) || pos < 1 || pos > 5) return;
            if (matrixState.selectedPositions.has(pos)) {
                matrixState.selectedPositions = new Set();
            } else {
                matrixState.selectedPositions = new Set([pos]);
                if (!matrixState.selectedComboGroupsByPos.has(pos)) {
                    matrixState.selectedComboGroupsByPos.set(pos, new Set([1, 2, 3]));
                }
            }
            updateMatrixBySelections();
        });
    }
    if (matrixComboInfo) {
        matrixComboInfo.addEventListener('click', e => {
            const traceChip = e.target.closest('.matrix-trace-chip');
            if (traceChip) {
                const pos = parseInt(traceChip.dataset.pos || '', 10);
                const group = parseInt(traceChip.dataset.group || '', 10);
                if (!Number.isInteger(pos) || !Number.isInteger(group)) return;
                if (!matrixState.selectedPositions.has(pos)) return;

                if (!matrixState.selectedTraceGroupsByPos.has(pos)) {
                    matrixState.selectedTraceGroupsByPos.set(pos, new Set());
                }
                const activeTraceGroups = matrixState.selectedTraceGroupsByPos.get(pos);
                if (activeTraceGroups.has(group)) {
                    activeTraceGroups.delete(group);
                } else {
                    activeTraceGroups.add(group);
                }
                updateMatrixBySelections();
                return;
            }

            const chip = e.target.closest('.matrix-combo-chip');
            if (!chip) return;
            const pos = parseInt(chip.dataset.pos || '', 10);
            const group = parseInt(chip.dataset.group || '', 10);
            if (!Number.isInteger(pos) || !Number.isInteger(group)) return;
            if (!matrixState.selectedPositions.has(pos)) return;

            if (!matrixState.selectedComboGroupsByPos.has(pos)) {
                matrixState.selectedComboGroupsByPos.set(pos, new Set([1, 2, 3]));
            }
            const activeGroups = matrixState.selectedComboGroupsByPos.get(pos);
            if (activeGroups.has(group)) {
                activeGroups.delete(group);
            } else {
                activeGroups.add(group);
            }
            updateMatrixBySelections();
        });
    }
    if (matrixToggleMatchBtn) {
        matrixToggleMatchBtn.addEventListener('click', () => {
            setMatrixMatchPanelVisible(!matrixState.matchPanelVisible);
            if (matrixOverlay && matrixOverlay.classList.contains('show')) {
                rebuildMatrixTableAndHighlights();
            }
        });
    }
    if (matrixToggleRowIdsBtn) {
        matrixToggleRowIdsBtn.addEventListener('click', () => {
            setMatrixRowIdsVisible(!matrixState.showRowIds);
        });
    }
    if (matrixTopbarToggleBtn) {
        matrixTopbarToggleBtn.addEventListener('click', () => {
            setMatrixTopbarToolsVisible(!matrixState.topbarToolsVisible);
        });
    }
    if (matrixSourceModeControl) {
        matrixSourceModeControl.addEventListener('click', e => {
            const toggleBtn = e.target.closest('.matrix-size-toggle-btn');
            if (toggleBtn) {
                if (isCompactMatrixTopbar()) {
                    setMatrixTopbarToolsVisible(true);
                }
                setMatrixSizeOptionsOpen(false);
                setMatrixLimitOptionsOpen(false);
                setMatrixSourceModeOptionsOpen(!matrixSourceModeControl.classList.contains('open'));
                return;
            }
            const btn = e.target.closest('.matrix-size-btn');
            if (!btn) return;
            const mode = normalizeMatrixSourceMode(btn.dataset.mode);
            if (matrixSourceModeInput) {
                matrixSourceModeInput.value = mode;
                matrixSourceModeInput.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                applyMatrixSourceMode(mode);
            }
            setMatrixSourceModeOptionsOpen(false);
        });
    }
    if (matrixSizeControl) {
        matrixSizeControl.addEventListener('click', e => {
            const toggleBtn = e.target.closest('.matrix-size-toggle-btn');
            if (toggleBtn) {
                if (isCompactMatrixTopbar()) {
                    setMatrixTopbarToolsVisible(true);
                }
                setMatrixSourceModeOptionsOpen(false);
                setMatrixLimitOptionsOpen(false);
                setMatrixSizeOptionsOpen(!matrixSizeControl.classList.contains('open'));
                return;
            }
            const btn = e.target.closest('.matrix-size-btn');
            if (!btn) return;
            const val = parseInt(btn.dataset.size || '', 10);
            if (!Number.isFinite(val)) return;
            applyMatrixCellSize(val);
            setMatrixSizeOptionsOpen(false);
        });
    }
    if (matrixLimitControl) {
        matrixLimitControl.addEventListener('click', e => {
            const toggleBtn = e.target.closest('.matrix-size-toggle-btn');
            if (toggleBtn) {
                if (isCompactMatrixTopbar()) {
                    setMatrixTopbarToolsVisible(true);
                }
                setMatrixSourceModeOptionsOpen(false);
                setMatrixSizeOptionsOpen(false);
                setMatrixLimitOptionsOpen(!matrixLimitControl.classList.contains('open'));
                return;
            }
            const btn = e.target.closest('.matrix-size-btn');
            if (!btn) return;
            const val = normalizeLoadLimit(btn.dataset.limit);
            if (matrixLimitInput) {
                matrixLimitInput.value = String(val);
                matrixLimitInput.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                setLoadLimit(val);
                loadHistoryData(val);
            }
            setMatrixLimitOptionsOpen(false);
        });
    }
    document.addEventListener('click', e => {
        if (matrixSourceModeControl && !matrixSourceModeControl.contains(e.target)) {
            setMatrixSourceModeOptionsOpen(false);
        }
        if (matrixSizeControl && !matrixSizeControl.contains(e.target)) {
            setMatrixSizeOptionsOpen(false);
        }
        if (matrixLimitControl && !matrixLimitControl.contains(e.target)) {
            setMatrixLimitOptionsOpen(false);
        }
    });
    if (matrixSearchInput) {
        matrixSearchInput.addEventListener('input', e => {
            const filtered = String(e.target.value || '').replace(/\D/g, '').slice(0, MATRIX_SEARCH_MAX_LEN);
            if (e.target.value !== filtered) {
                e.target.value = filtered;
            }
        });
        matrixSearchInput.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            applyMatrixSearchQuery(matrixSearchInput.value);
        });
    }
    if (matrixSearchBtn) {
        matrixSearchBtn.addEventListener('click', () => {
            applyMatrixSearchQuery(matrixSearchInput ? matrixSearchInput.value : '');
        });
    }
    if (matrixClearSearchBtn) {
        matrixClearSearchBtn.addEventListener('click', () => {
            clearMatrixSearchQuery();
        });
    }
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && matrixOverlay && matrixOverlay.classList.contains('show')) {
            closeMatrixView();
        }
    });
    document.addEventListener('fullscreenchange', () => {
        const matrixVisible = Boolean(matrixOverlay && matrixOverlay.classList.contains('show'));
        const matrixIsFullscreen = document.fullscreenElement === matrixOverlay;
        if (matrixVisible && !matrixIsFullscreen) {
            closeMatrixOverlayState();
        }
        scheduleMatrixViewportUpdate(Boolean(matrixOverlay && matrixOverlay.classList.contains('show')));
    });
    const onViewportChange = () => {
        const nextSignature = captureMatrixViewportSignature();
        syncMatrixTopbarToolsVisibility();
        syncMatrixSourceModeControl();
        syncMatrixLimitControl();
        syncMatrixSizeControl();
        setMatrixMatchPanelVisible(matrixState.matchPanelVisible);
        setMatrixRowIdsVisible(matrixState.showRowIds);
        if (isCompactMatrixTopbar() && !matrixState.topbarToolsVisible) {
            setMatrixSourceModeOptionsOpen(false);
            setMatrixSizeOptionsOpen(false);
            setMatrixLimitOptionsOpen(false);
        }
        scheduleMatrixViewportUpdate(Boolean(matrixOverlay && matrixOverlay.classList.contains('show')), nextSignature);
    };
    const onVisualViewportScroll = () => {
        if (!matrixOverlay || !matrixOverlay.classList.contains('show')) return;
        if (matrixViewportRaf || matrixViewportSettleRaf) return;
        matrixViewportRaf = requestAnimationFrame(() => {
            matrixViewportRaf = 0;
            updateMatrixViewportHeight();
            rememberMatrixViewportSignature();
        });
    };
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onViewportChange);
        window.visualViewport.addEventListener('scroll', onVisualViewportScroll);
    }
    applyMatrixCellSize(getPreferredMatrixCellSize(), { rebuild: false });
    setMatrixSourceModeOptionsOpen(false);
    setMatrixSizeOptionsOpen(false);
    setMatrixLimitOptionsOpen(false);
    syncMatrixSourceModeControl();
    syncMatrixLimitControl();
    setMatrixMatchPanelVisible(false);
    setMatrixRowIdsVisible(false);
    syncMatrixTopbarToolsVisibility();
    updateMatrixViewportHeight();
    rememberMatrixViewportSignature();

    function renderPreview(lines) {
        if (!inputDisplay) return;
        inputDisplay.innerHTML = '';
        if (!lines.length) { inputDisplay.innerHTML = '<p class="empty-hint">暂无数据</p>'; return; }
        lines.forEach((line, i) => {
            const row = document.createElement('div');
            row.className = 'data-line';
            const num = document.createElement('span');
            num.className = 'line-num';
            num.textContent = String(i + 1).padStart(3, '0');
            const content = document.createElement('span');
            content.className = 'line-content';
            for (const ch of line) {
                const cell = document.createElement('span');
                cell.className = 'digit-cell';
                cell.textContent = ch;
                content.appendChild(cell);
            }
            row.appendChild(num);
            row.appendChild(content);
            inputDisplay.appendChild(row);
        });
        // 自动滚动到最底部
        inputDisplay.scrollTop = inputDisplay.scrollHeight;
    }

    // ── Fetch Network Data ──
    if (fetchNetBtn) {
        fetchNetBtn.addEventListener('click', async () => {
            clearError();
            fetchNetBtn.disabled = true;
            fetchNetBtn.textContent = '更新中...';

            try {
                const updateRes = await fetch('/api/update_history', { method: 'POST' });
                const updateData = await updateRes.json();
                if (!updateRes.ok) {
                    showError(updateData.error || '更新抓取失败');
                }
                await loadHistoryData();
            } catch (err) {
                showError('网络或服务端异常，请稍后重试');
            } finally {
                fetchNetBtn.disabled = false;
                refreshUpdateButtonText();
            }
        });
    }

    const retreatToggle = document.getElementById('retreatToggle');
    if (retreatToggle) {
        retreatToggle.addEventListener('change', () => {
            isRetreatMode = retreatToggle.checked;
            if (netLines) {
                const effectiveLines = getEffectiveLines(netLines);
                const effectiveExpects = getEffectiveExpects(currentSourceExpects, netLines);
                renderPreview(effectiveLines);
                doAnalyze(effectiveLines);
                refreshOpenMatrixData(effectiveLines, effectiveExpects);
            }
        });
    }

    // ── Analyze ──
    async function doAnalyze(linesOverride = null) {
        const activeLines = linesOverride || netLines;
        if (!activeLines || !activeLines.length) return;
        clearError();

        try {
            const reqData = {
                lines: activeLines,
                period_sum: currentPeriodSum
            };
            const res = await fetch('/api/analyze', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqData)
            });

            const data = await res.json();
            if (!res.ok) { showError(data.error || '解析失败'); return; }

            if (data.parsedData) {
                renderPreview(data.parsedData);
            }

            renderAllStats(data);
            updateDangerButtons(data.dangerPeriods || [], data.dangerPeriodGaps || {});
        } catch (err) {
            console.error(err);
            showError('服务器请求失败');
        }
    }

    function updateDangerButtons(dangerPeriods, dangerPeriodGaps = {}) {
        if (!periodSumControls) return;
        const dangerSet = new Set(dangerPeriods || []);
        const dangerExcesses = Object.values(dangerPeriodGaps)
            .map(value => Number(value))
            .filter(value => Number.isFinite(value) && value > 40)
            .map(value => value - 40);
        const minExcess = dangerExcesses.length ? Math.min(...dangerExcesses) : 0;
        const maxExcess = dangerExcesses.length ? Math.max(...dangerExcesses) : 0;
        const buttons = periodSumControls.querySelectorAll('.sum-btn');
        buttons.forEach((btn, idx) => {
            const k = idx + 1;
            const maxGap = Number(dangerPeriodGaps[k] || 0);
            if (dangerSet.has(k) || maxGap > 40) {
                const strength = getDangerButtonStrength(maxGap - 40, minExcess, maxExcess);
                btn.classList.add('danger-btn');
                applyDangerButtonStyle(btn, Math.max(maxGap, 41), strength);
            } else {
                btn.classList.remove('danger-btn');
                clearDangerButtonStyle(btn);
            }
        });
    }

    function renderAllStats(data) {
        if (!statsDisplay) return;
        statsDisplay.innerHTML = '';

        const tabs = [
            { id: 'gap', label: '遗漏统计', render: () => renderGap(data.gapAnalysis, data.offsets, data.periodSum) },
            { id: 'dadi', label: '大底生成', render: () => renderDadi(data.dadiAnalysis) },
            { id: 'dadiError', label: '大底容错分析', render: () => renderDadiError(data.dadiFaultTolerance, data.periodSumOffset) },
            { id: 'dadiTransform', label: '大底转换', render: () => renderDadiTransform(data.dadiTransform, data.periodSumOffset) },
        ];

        const tabBar = document.createElement('div');
        tabBar.className = 'tab-bar';
        const contentArea = document.createElement('div');
        contentArea.className = 'tab-content';

        tabs.forEach((tab, idx) => {
            const btn = document.createElement('button');
            btn.className = 'tab-btn' + (idx === 0 ? ' active' : '');
            btn.textContent = tab.label;
            btn.addEventListener('click', () => {
                tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                contentArea.innerHTML = '';
                candidateSyncCallbacks = []; // 清空遗留回调
                const dom = tab.render();
                if (dom) contentArea.appendChild(dom);
            });
            tabBar.appendChild(btn);
        });

        statsDisplay.appendChild(tabBar);
        statsDisplay.appendChild(contentArea);
        candidateSyncCallbacks = [];
        const defaultDom = tabs[0].render();
        if (defaultDom) contentArea.appendChild(defaultDom);
    }

    function renderGap(results, offsets, periodSum) {
        const wrap = document.createElement('div');
        wrap.className = 'cards-list gap-grid animate-in';
        if (!results) return wrap;

        results.forEach(r => {
            const isTargetPos = r.position === '前三' || r.is3Pos || (r.position >= 1 && r.position <= 3);
            const isLargeGap = r.maxGap > 40;
            const shouldHighlight = isTargetPos && isLargeGap;

            const card = document.createElement('div');
            card.className = `stat-card gap-card ${shouldHighlight ? 'danger-card' : ''} ${r.is3Pos ? 'gap-card-3pos' : ''}`;

            let badgeHtml = '';
            if (r.is3Pos && r.allGaps) {
                const items = [];
                for (let i = 0; i < 10; i++) {
                    const gap = r.allGaps[i];
                    const isMax = gap === r.maxGap;
                    const isDanger = isMax || gap > 40;
                    items.push(`
                        <div class="digit-gap-item" title="数字 ${i} 遗漏 ${gap} 期">
                            <span class="digit-badge ${isDanger ? 'danger-badge' : ''}">${i}</span>
                            <span class="gap-value ${isDanger ? 'danger-text' : ''}">${gap}</span>
                        </div>
                    `);
                }
                badgeHtml = items.join('');
            } else {
                badgeHtml = r.candidates.sort((a, b) => a - b).map(d => {
                    let html = `<span class="digit-badge ${shouldHighlight ? 'danger-badge' : ''}">${d}</span>`;
                    if (periodSum > 1 && offsets && !r.is3Pos && offsets[r.position - 1] !== undefined) {
                        const offset = offsets[r.position - 1];
                        const realDigit = (d - offset + 10) % 10;
                        html += '<span class="digit-arrow">→</span>';
                        html += `<span class="digit-badge offset-badge ${shouldHighlight ? 'danger-badge' : ''}">${realDigit}</span>`;
                    }
                    return `<div class="digit-pair">${html}</div>`;
                }).join('');
            }

            if (r.is3Pos) {
                card.innerHTML = `
                    <div class="gap-title-3pos">
                        <div class="gap-label-3pos">前三位综合遗漏</div>
                        <div class="stat-gap">最大遗漏 <strong class="${shouldHighlight ? 'danger-text' : ''}">${r.maxGap}</strong> 期</div>
                    </div>
                    <div class="stat-digits gap-digits-3pos">${badgeHtml}</div>`;
            } else {
                card.innerHTML = `
                    <div class="gap-head">
                        <div class="gap-bg-index ${shouldHighlight ? 'danger-text' : ''}">${r.position}</div>
                        <div class="stat-gap gap-head-gap">遗漏 <strong class="${shouldHighlight ? 'danger-text' : ''}">${r.maxGap}</strong> 期</div>
                    </div>
                    <div class="stat-digits gap-digits">${badgeHtml}</div>`;
            }
            wrap.appendChild(card);
        });
        return wrap;
    }

    function renderDadi(results) {
        const wrap = document.createElement('div');
        wrap.className = 'cards-list animate-in';
        if (!results || !results.dadi) {
            wrap.innerHTML = '<p class="empty-hint">历史期数不足，无法生成大底。</p>';
            return wrap;
        }

        const card = document.createElement('div');
        card.className = 'stat-card dadi-card';

        const offsets = results.offsets || [];
        const offsetsDisplay = offsets.length >= 3 ? offsets.slice(0, 3).join(', ') : offsets.join(', ');

        const rulesHtml = `
            <div class="dadi-step-list">
                <details class="dadi-step" open>
                    <summary>
                        <span class="dadi-step-index">步骤 1</span>
                        <strong class="dadi-step-title">规则溯源分组</strong>
                    </summary>
                    <div class="dadi-step-content">
                        <div class="dadi-tag-list">
                            <span class="tag tag-neighbor">组1: ${results.group1.join(',')}</span>
                            <span class="tag tag-neighbor">组2: ${results.group2.join(',')}</span>
                            <span class="tag tag-neighbor">组3: ${results.group3.join(',')}</span>
                            <span class="tag tag-repeat">未见(组4): ${results.group4.join(',')}</span>
                        </div>
                    </div>
                </details>
                <details class="dadi-step">
                    <summary>
                        <span class="dadi-step-index">步骤 2</span>
                        <strong class="dadi-step-title">组合5双码集合： (组1选一配2,3,4选一)∪(组2配3,4)∪(组3配4) 求无序双码集合</strong>
                    </summary>
                    <div class="dadi-step-content">
                        <div class="dadi-pair-list">
                            ${results.group5.map(pair => `<span class="dadi-pair-tag">${pair.join('')}</span>`).join('')}
                        </div>
                    </div>
                </details>
                <details class="dadi-step" open>
                    <summary>
                        <span class="dadi-step-index">步骤 3</span>
                        <strong class="dadi-step-title">输出大底结果</strong>
                    </summary>
                    <div class="dadi-step-content">
                        <div class="error-result-container dadi-result-container">
                            <div class="error-result-header">
                                <span class="result-count-info">大底结果过滤出 000-999 内不考虑顺序的组合: <strong>${results.dadi.length}</strong> 注 <span id="dadiRetreatVerify"></span></span>
                                <div class="result-action-group">
                                    <button id="copyDadiBtn" class="copy-btn-mini">
                                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"></path></svg>
                                        一键复制结果
                                    </button>
                                    <button id="downloadDadiBtn" class="copy-btn-mini download-btn-mini">
                                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 3v12m0 0l4-4m-4 4l-4-4M5 21h14"></path></svg>
                                        下载TXT
                                    </button>
                                </div>
                            </div>
                        ${results.offsetApplied ? `
                        <div class="dadi-offset-tip">
                            <span class="dadi-offset-label">⚠️ 多期和偏移修正：</span>已将每一位数字减去近期偏移值 <strong class="dadi-offset-value">[${offsetsDisplay}]</strong>。
                        </div>` : ''}
                            <div class="error-grid">
                                ${results.dadi.map(num => `<div class="grid-num-item">${num}</div>`).join('')}
                            </div>
                        </div>
                    </div>
                </details>
            </div>
        `;
        card.innerHTML = rulesHtml;

        // 倒退模式验证
        const dadiVerifyEl = card.querySelector('#dadiRetreatVerify');
        if (dadiVerifyEl) {
            dadiVerifyEl.innerHTML = buildRetreatIntersectHtml(results.dadi);
        }

        // 添加到备选按钮
        const addCandidateBtnContainer = card.querySelector('#copyDadiBtn')?.closest('.result-action-group');
        if (addCandidateBtnContainer) {
            const periodLabel = currentPeriodSum === 1 ? '1期' : `${currentPeriodSum}期和`;
            const addBtn = createAddCandidateButton(
                () => `dadi-gen:${currentPeriodSum}`,
                () => `大底生成 (${periodLabel})`,
                () => results.dadi
            );
            addCandidateBtnContainer.appendChild(addBtn);
        }

        const copyBtn = card.querySelector('#copyDadiBtn');
        const downloadBtn = card.querySelector('#downloadDadiBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                const textToCopy = results.dadi.join('\n');
                const success = await copyToClipboard(textToCopy);
                if (success) {
                    const oldText = copyBtn.innerHTML;
                    copyBtn.innerHTML = `
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
                        已成功复制！
                    `;
                    copyBtn.style.background = '#10b981';
                    setTimeout(() => {
                        copyBtn.innerHTML = oldText;
                        copyBtn.style.background = '';
                    }, 1500);
                } else {
                    alert('复制失败，请手动选择复制');
                }
            });
        }
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                if (!results.dadi.length) return;
                const success = downloadTextAsFile(results.dadi, '大底生成结果');
                if (success) {
                    const oldText = downloadBtn.innerHTML;
                    downloadBtn.innerHTML = `
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
                        已下载TXT
                    `;
                    downloadBtn.style.background = '#0f766e';
                    setTimeout(() => {
                        downloadBtn.innerHTML = oldText;
                        downloadBtn.style.background = '';
                    }, 1500);
                } else {
                    alert('下载失败，请重试');
                }
            });
        }
        wrap.appendChild(card);
        return wrap;
    }

    // 将 period_sum 空间的号码转回 1 期空间
    function applyPeriodSumOffset(code, offset) {
        if (!offset || code.length < 3) return code;
        return code.split('').map((ch, i) => ((parseInt(ch, 10) - (offset[i] || 0)) % 10 + 10) % 10).join('');
    }

    // ── 倒退模式验证辅助 ──
    // 获取倒退模式下被隐藏的最新开奖前三位号码
    function getRetreatVerifyTarget() {
        if (!isRetreatMode || !latestOpenNumbers || latestOpenNumbers.length < 3) return null;
        return latestOpenNumbers.slice(0, 3);
    }

    // 根据 counts 对象计算实际容错值（缺席几组），返回 HTML 标签
    // counts: { "000": hitCount, ... }, totalSets: 总组数, periodSumOffset: 偏移量
    function buildRetreatActualErrorHtml(counts, totalSets, periodSumOffset) {
        const target = getRetreatVerifyTarget();
        if (!target || !counts || !totalSets) return '';

        // 如果有偏移，需要将 target 转到分析空间来查 counts
        // counts 是分析空间的，target 是原始空间的
        // 原始 = 分析 - offset  =>  分析 = 原始 + offset
        let lookupKey = target;
        if (periodSumOffset) {
            lookupKey = target.split('').map((ch, i) => ((parseInt(ch, 10) + (periodSumOffset[i] || 0)) % 10)).join('');
        }

        const hitCount = counts[lookupKey] || 0;
        const missCount = totalSets - hitCount;
        const isHit = missCount === 0;
        const color = isHit ? '#10b981' : (missCount <= 2 ? '#f59e0b' : '#ef4444');

        return `<span class="retreat-actual-error" style="color:${color}" title="实际开奖 ${target} 在${totalSets}组中缺席${missCount}组">实际: <strong>${missCount}</strong></span>`;
    }

    // 交集结果验证：检查 target 是否在最终结果集中
    function buildRetreatIntersectHtml(results) {
        const target = getRetreatVerifyTarget();
        if (!target) return '';

        const hit = results.includes(target);
        if (hit) {
            return `<span class="retreat-actual-error" style="color:#10b981" title="实际开奖 ${target} 在交集结果中">✅ ${target} 命中</span>`;
        } else {
            return `<span class="retreat-actual-error" style="color:#ef4444" title="实际开奖 ${target} 不在交集结果中">❌ ${target} 未命中</span>`;
        }
    }

    function renderDadiError(results, periodSumOffset) {
        if (!results || !results.counts) return document.createElement('div');
        const counts = results.counts;
        const totalSets = results.total_sets || 0;

        const card = document.createElement('div');
        card.className = 'error-panel animate-in';
        const toleranceOptions = Array.from({ length: 13 }, (_, i) => i)
            .map(v => `<div class="custom-option${v === 0 ? ' selected' : ''}">${v}</div>`)
            .join('');

        const controlHtml = `
            <div class="error-controls-header">
                <span class="error-settings-title">大底容错条件设置 (分析范围: 1-${totalSets} 期和)</span>
                <div class="error-controls">
                    <div class="error-input-group">
                        <label>容错下限:</label>
                        <div class="custom-select" id="errMin">
                            <div class="custom-select-trigger"><span>0</span><i class="arrow"></i></div>
                            <div class="custom-select-options">${toleranceOptions}</div>
                        </div>
                    </div>
                    <div class="error-input-group">
                        <label>容错上限:</label>
                        <div class="custom-select" id="errMax">
                            <div class="custom-select-trigger"><span>2</span><i class="arrow"></i></div>
                            <div class="custom-select-options">${toleranceOptions}</div>
                        </div>
                    </div>
                    <span id="errRetreatVerify"></span>
                </div>
            </div>
            <div class="error-result-container">
                <div class="error-result-header">
                    <span class="result-count-info">符合条件的大底号码: <strong id="errCountLabel">0</strong> 注</span>
                    <div class="result-action-group">
                        <button id="copyErrBtn" class="copy-btn-mini">
                            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"></path></svg>
                            一键复制结果
                        </button>
                        <button id="downloadErrBtn" class="copy-btn-mini download-btn-mini">
                            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 3v12m0 0l4-4m-4 4l-4-4M5 21h14"></path></svg>
                            下载TXT
                        </button>
                    </div>
                </div>
                <div id="errResultArea" class="error-grid"></div>
            </div>
        `;
        card.innerHTML = controlHtml;

        const errMinSelect = card.querySelector('#errMin');
        const errMaxSelect = card.querySelector('#errMax');
        const copyBtn = card.querySelector('#copyErrBtn');
        const downloadBtn = card.querySelector('#downloadErrBtn');
        const errCountLabel = card.querySelector('#errCountLabel');
        const errResultArea = card.querySelector('#errResultArea');
        // custom select 初始化设置默认值 (第一个子元素)
        initCustomSelect(errMinSelect);
        initCustomSelect(errMaxSelect);

        // 如果想指定默认值，可以在初始化后通过 JS 修改 DOM。
        // 这里容错上限默认定位到第 3 个（value=2），如果在 options 中有的话：
        const opts = errMaxSelect.querySelectorAll('.custom-option');
        if (opts.length > 2) {
            errMaxSelect.querySelector('.custom-select-trigger span').textContent = '2';
            opts.forEach(o => o.classList.remove('selected'));
            opts[2].classList.add('selected');
        }

        let currentResults = [];


        function updateResults() {
            let minErr = getCustomSelectValue(errMinSelect);
            if (isNaN(minErr)) minErr = 0;
            let maxErr = getCustomSelectValue(errMaxSelect);
            if (isNaN(maxErr)) maxErr = 0;

            if (minErr > maxErr) {
                [minErr, maxErr] = [maxErr, minErr];
                setCustomSelectValue(errMinSelect, minErr);
                setCustomSelectValue(errMaxSelect, maxErr);
            }

            const minCount = Math.max(0, totalSets - maxErr);
            const maxCount = totalSets - minErr;
            currentResults = [];

            for (let i = 0; i < 1000; i++) {
                const s = i.toString().padStart(3, '0');
                const count = counts[s] || 0;
                if (count >= minCount && count <= maxCount) {
                    currentResults.push(s);
                }
            }

            // 容错过滤完成后，将结果转回 1 期空间
            if (periodSumOffset) {
                currentResults = currentResults.map(code => applyPeriodSumOffset(code, periodSumOffset));
                currentResults = [...new Set(currentResults)].sort();
            }

            errCountLabel.textContent = currentResults.length;
            errResultArea.innerHTML = currentResults.map(num => `<div class="grid-num-item">${num}</div>`).join('');
            
            // 倒退模式验证
            const verifyContainer = card.querySelector('#errRetreatVerify');
            if (verifyContainer) {
                verifyContainer.innerHTML = buildRetreatActualErrorHtml(counts, totalSets, periodSumOffset);
            }
            
            // 数据变化时同步可能会禁用的按钮
            candidateSyncCallbacks.forEach(cb => cb());
        }

        initCustomSelect(errMinSelect, updateResults);
        initCustomSelect(errMaxSelect, updateResults);
        
        // 初始渲染
        updateResults();

        // 添加到备选按钮
        const addCandidateBtnContainer = card.querySelector('#copyErrBtn')?.closest('.result-action-group');
        if (addCandidateBtnContainer) {
            const periodLabel = currentPeriodSum === 1 ? '1期' : `${currentPeriodSum}期和`;
            const addBtn = createAddCandidateButton(
                () => {
                    const minVal = getCustomSelectValue(errMinSelect);
                    const maxVal = getCustomSelectValue(errMaxSelect);
                    return `dadi-err:${currentPeriodSum}:${minVal}:${maxVal}`;
                },
                () => {
                    const minVal = getCustomSelectValue(errMinSelect);
                    const maxVal = getCustomSelectValue(errMaxSelect);
                    return `容错分析 (${periodLabel}) [${minVal},${maxVal}]`;
                },
                () => [...currentResults]
            );
            addCandidateBtnContainer.appendChild(addBtn);
        }

        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                if (currentResults.length === 0) return;
                const textToCopy = currentResults.join('\n');
                const success = await copyToClipboard(textToCopy);
                if (success) {
                    const originalContent = copyBtn.innerHTML;
                    copyBtn.innerHTML = `
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
                        已成功复制！
                    `;
                    copyBtn.style.background = '#10b981';
                    setTimeout(() => {
                        copyBtn.innerHTML = originalContent;
                        copyBtn.style.background = '';
                    }, 1500);
                } else {
                    alert('复制失败，请手动选择复制');
                }
            });
        }
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                if (currentResults.length === 0) return;
                const success = downloadTextAsFile(currentResults, '大底容错结果');
                if (success) {
                    const originalContent = downloadBtn.innerHTML;
                    downloadBtn.innerHTML = `
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
                        已下载TXT
                    `;
                    downloadBtn.style.background = '#0f766e';
                    setTimeout(() => {
                        downloadBtn.innerHTML = originalContent;
                        downloadBtn.style.background = '';
                    }, 1500);
                } else {
                    alert('下载失败，请重试');
                }
            });
        }
        return card;
    }

    function renderDadiTransform(results, periodSumOffset) {
        const wrap = document.createElement('div');
        wrap.className = 'cards-list animate-in';
        const bases = results && Array.isArray(results.bases) ? results.bases : [];
        if (!bases.length) {
            wrap.innerHTML = '<p class="empty-hint">暂无大底转换数据。</p>';
            return wrap;
        }

        const card = document.createElement('div');
        card.className = 'error-panel animate-in';
        const toleranceOptions = Array.from({ length: 13 }, (_, i) => i)
            .map(v => `<div class="custom-option${v === 0 ? ' selected' : ''}">${v}</div>`)
            .join('');
        const baseButtons = bases
            .map((base, idx) => {
                const title = base.name || `大底${base.slot}`;
                return `<button type="button" class="dadi-transform-base-btn${idx === 0 ? ' active' : ''}" data-slot="${base.slot}">${title}</button>`;
            })
            .join('');

        card.innerHTML = `
            <div class="error-settings">
                <span class="error-settings-title">大底转换：1 组原始大底 + 19 组按最新 1-19 期和前三位逐位减模 10</span>
                <div class="dadi-transform-base-switch">${baseButtons}</div>
                <div class="error-controls">
                    <div class="error-input-group">
                        <label>容错下限:</label>
                        <div id="transformErrMin" class="custom-select">
                            <div class="custom-select-trigger"><span>0</span><div class="arrow"></div></div>
                            <div class="custom-select-options">${toleranceOptions}</div>
                        </div>
                    </div>
                    <div class="error-input-group">
                        <label>容错上限:</label>
                        <div id="transformErrMax" class="custom-select">
                            <div class="custom-select-trigger"><span>2</span><div class="arrow"></div></div>
                            <div class="custom-select-options">${toleranceOptions}</div>
                        </div>
                    </div>
                    <span id="transformRetreatVerify"></span>
                </div>
            </div>
            <div class="error-result-container">
                <div class="error-result-header">
                    <span id="transformCountLabel" class="result-count-info">符合条件的大底号码: <strong>0</strong> 注</span>
                    <div class="result-action-group">
                        <button id="copyTransformBtn" class="copy-btn-mini">
                            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"></path></svg>
                            一键复制结果
                        </button>
                        <button id="downloadTransformBtn" class="copy-btn-mini download-btn-mini">
                            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 3v12m0 0l4-4m-4 4l-4-4M5 21h14"></path></svg>
                            下载TXT
                        </button>
                    </div>
                </div>
                <div id="transformMeta" class="dadi-offset-tip"></div>
                <div id="transformResultArea" class="error-grid"></div>
            </div>
        `;

        const baseMap = new Map(bases.map(base => [String(base.slot), base]));
        const toleranceBySlot = new Map();
        bases.forEach(base => {
            toleranceBySlot.set(String(base.slot), { minErr: 0, maxErr: 2 });
        });

        const minInput = card.querySelector('#transformErrMin');
        const maxInput = card.querySelector('#transformErrMax');
        const copyBtn = card.querySelector('#copyTransformBtn');
        const downloadBtn = card.querySelector('#downloadTransformBtn');
        const countLabel = card.querySelector('#transformCountLabel');
        const metaLabel = card.querySelector('#transformMeta');
        const resultArea = card.querySelector('#transformResultArea');
        const switchButtons = Array.from(card.querySelectorAll('.dadi-transform-base-btn'));

        let activeSlot = String(bases[0].slot);
        let currentResults = [];

        function setActiveSlot(slot) {
            activeSlot = String(slot);
            switchButtons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.slot === activeSlot);
            });
        }

        function updateTransformResults() {
            const activeBase = baseMap.get(activeSlot);
            if (!activeBase) return;

            const currentTolerance = toleranceBySlot.get(activeSlot) || { minErr: 0, maxErr: 2 };
            let minErr = getCustomSelectValue(minInput);
            if (Number.isNaN(minErr)) minErr = currentTolerance.minErr;
            let maxErr = getCustomSelectValue(maxInput);
            if (Number.isNaN(maxErr)) maxErr = currentTolerance.maxErr;

            if (minErr > maxErr) {
                [minErr, maxErr] = [maxErr, minErr];
            }
            setCustomSelectValue(minInput, minErr);
            setCustomSelectValue(maxInput, maxErr);
            toleranceBySlot.set(activeSlot, { minErr, maxErr });

            const totalSets = Number.isFinite(activeBase.totalSets) ? activeBase.totalSets : 0;
            const sourceCount = Number.isFinite(activeBase.sourceCount) ? activeBase.sourceCount : 0;
            const title = activeBase.name || `大底${activeBase.slot}`;

            if (!sourceCount || !totalSets) {
                countLabel.innerHTML = `${title} 暂无可用号码`;
                metaLabel.innerHTML = `请先写入 ${title} 的三位号码数据`;
                resultArea.innerHTML = '<p class="empty-hint">当前基底为空</p>';
                currentResults = [];
                return;
            }

            const minCount = Math.max(0, totalSets - maxErr);
            const maxCount = totalSets - minErr;
            const counts = activeBase.counts || {};
            const nextResults = [];
            for (let i = 0; i < 1000; i++) {
                const code = String(i).padStart(3, '0');
                const hit = counts[code] || 0;
                if (hit >= minCount && hit <= maxCount) {
                    nextResults.push(code);
                }
            }

            // 容错过滤完成后，将结果转回 1 期空间
            if (periodSumOffset) {
                currentResults = nextResults.map(code => applyPeriodSumOffset(code, periodSumOffset));
                currentResults = [...new Set(currentResults)].sort();
            } else {
                currentResults = nextResults;
            }

            countLabel.innerHTML = `${title} 符合条件的大底号码: <strong>${currentResults.length}</strong> 注`;
            metaLabel.innerHTML = `原始大底 <strong>${sourceCount}</strong> 注；转换大底 <strong>${totalSets}</strong> 组；容错范围 <strong>[${minErr}, ${maxErr}]</strong>`;
            resultArea.innerHTML = currentResults.length
                ? currentResults.map(num => `<div class="grid-num-item">${num}</div>`).join('')
                : '<p class="empty-hint">当前容错范围无结果</p>';

            // 倒退模式验证
            const verifyContainer = card.querySelector('#transformRetreatVerify');
            if (verifyContainer) {
                const activeBase = baseMap.get(activeSlot);
                const activeCounts = activeBase ? (activeBase.counts || {}) : {};
                verifyContainer.innerHTML = buildRetreatActualErrorHtml(activeCounts, totalSets, periodSumOffset);
            }

            // 数据变化时同步备选按钮状态
            candidateSyncCallbacks.forEach(cb => cb());
        }

        switchButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const slot = btn.dataset.slot;
                if (!slot) return;
                setActiveSlot(slot);
                const currentTolerance = toleranceBySlot.get(activeSlot) || { minErr: 0, maxErr: 2 };
                setCustomSelectValue(minInput, currentTolerance.minErr);
                setCustomSelectValue(maxInput, currentTolerance.maxErr);
                updateTransformResults();
            });
        });

        initCustomSelect(minInput, updateTransformResults);
        initCustomSelect(maxInput, updateTransformResults);

        // 添加到备选按钮
        const addCandidateBtnContainer = card.querySelector('#copyTransformBtn')?.closest('.result-action-group');
        if (addCandidateBtnContainer) {
            const periodLabel = currentPeriodSum === 1 ? '1期' : `${currentPeriodSum}期和`;
            const addBtn = createAddCandidateButton(
                () => {
                    const minVal = getCustomSelectValue(minInput);
                    const maxVal = getCustomSelectValue(maxInput);
                    return `dadi-transform:${activeSlot}:${currentPeriodSum}:${minVal}:${maxVal}`;
                },
                () => {
                    const activeBase = baseMap.get(activeSlot);
                    const baseName = activeBase && activeBase.name ? activeBase.name : `大底${activeSlot}`;
                    return `大底转换 ${baseName} (${periodLabel})`;
                },
                () => [...currentResults]
            );
            addCandidateBtnContainer.appendChild(addBtn);
        }

        copyBtn.addEventListener('click', async () => {
            if (!currentResults.length) return;
            const textToCopy = currentResults.join('\n');
            const success = await copyToClipboard(textToCopy);
            if (success) {
                const originalContent = copyBtn.innerHTML;
                copyBtn.innerHTML = `
                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
                    已成功复制！
                `;
                copyBtn.style.background = '#10b981';
                setTimeout(() => {
                    copyBtn.innerHTML = originalContent;
                    copyBtn.style.background = '';
                }, 1500);
            } else {
                alert('复制失败，请手动选择复制');
            }
        });
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                if (!currentResults.length) return;
                const activeBase = baseMap.get(activeSlot);
                const baseName = activeBase && activeBase.name ? activeBase.name : `大底${activeSlot}`;
                const success = downloadTextAsFile(currentResults, `大底转换_${baseName}`);
                if (success) {
                    const originalContent = downloadBtn.innerHTML;
                    downloadBtn.innerHTML = `
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
                        已下载TXT
                    `;
                    downloadBtn.style.background = '#0f766e';
                    setTimeout(() => {
                        downloadBtn.innerHTML = originalContent;
                        downloadBtn.style.background = '';
                    }, 1500);
                } else {
                    alert('下载失败，请重试');
                }
            });
        }

        setActiveSlot(activeSlot);
        setCustomSelectValue(minInput, 0);
        setCustomSelectValue(maxInput, 2);
        updateTransformResults();

        wrap.appendChild(card);
        return wrap;
    }

    // 提权全局的自定义下拉框读写方法
    function getCustomSelectValue(el) {
        const text = el.querySelector('.custom-select-trigger span')?.textContent || '0';
        return parseInt(text, 10);
    }

    function setCustomSelectValue(el, val) {
        el.querySelector('.custom-select-trigger span').textContent = val;
        const opts = el.querySelectorAll('.custom-option');
        opts.forEach(o => {
            if(parseInt(o.textContent, 10) === val) o.classList.add('selected');
            else o.classList.remove('selected');
        });
    }

    // 初始化 Custom Select 可选带回调
    function initCustomSelect(container, onChangeCallback = null) {
        if (!container) return;
        if (container.dataset.initialized) {
            // 更新回调
            container._onChangeCallback = onChangeCallback;
            return;
        }
        container.dataset.initialized = 'true';
        container._onChangeCallback = onChangeCallback;

        const trigger = container.querySelector('.custom-select-trigger');
        const optionsContainer = container.querySelector('.custom-select-options');
        
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = container.classList.contains('open');
            // 互斥，关闭其他打开的
            document.querySelectorAll('.custom-select').forEach(el => el.classList.remove('open'));
            if (!isOpen) {
                container.classList.add('open');
            }
        });

        optionsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('custom-option')) {
                const val = e.target.textContent;
                const oldVal = trigger.querySelector('span').textContent;
                trigger.querySelector('span').textContent = val;
                optionsContainer.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
                e.target.classList.add('selected');
                container.classList.remove('open');
                
                if (val !== oldVal && container._onChangeCallback) {
                    container._onChangeCallback(parseInt(val, 10));
                }
            }
        });
    }

    // 点击页面任意地方关闭所有下拉列表
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select').forEach(el => el.classList.remove('open'));
    });

    function normalizeSourceRows() {
        const rows = getEffectiveLines(currentSourceLines || [])
            .map(line => String(line || '').trim())
            .filter(Boolean);
        if (!rows.length) {
            showError('请先加载开奖号码数据');
            return null;
        }
        const isAllFiveDigit = rows.every(line => /^\d{5}$/.test(line));
        if (!isAllFiveDigit) {
            showError('全屏矩阵仅支持 5 位开奖号码');
            return null;
        }
        return rows;
    }

    function expandLineToNine(line) {
        return `${line.slice(-2)}${line}${line.slice(0, 2)}`;
    }

    function formatMatrixRowId(expectValue, rowIdx) {
        const digits = String(expectValue || '').replace(/\D/g, '');
        if (digits.length >= 3) return digits.slice(-3);
        if (digits.length > 0) return digits.padStart(3, '0');
        return String(rowIdx + 1).padStart(3, '0');
    }

    function toBaseColIndex(expandedCol) {
        return ((expandedCol - 2) % 5 + 5) % 5;
    }

    function isAllowedMatrixMatchLastCol(colIdx) {
        return colIdx >= MATRIX_MATCH_LAST_COL_MIN && colIdx <= MATRIX_MATCH_LAST_COL_MAX;
    }

    function buildStatsDedupKey(pos, match) {
        const normalizedPath = match.positions
            .map(([r, c]) => `${r}-${toBaseColIndex(c)}`)
            .join('|');
        const normalizedNext = match.nextPosition
            ? `${match.nextPosition[0]}-${toBaseColIndex(match.nextPosition[1])}`
            : 'none';
        return `${pos}|${match.direction}|${normalizedPath}|${normalizedNext}`;
    }

    function buildTraceStatsDedupKey(pos, groupNo, positions) {
        const normalizedPath = (positions || [])
            .map(([r, c]) => `${r}-${toBaseColIndex(c)}`)
            .join('|');
        return `${pos}|${groupNo}|${normalizedPath}`;
    }

    function setMatrixMatchPanelVisible(visible) {
        const nextVisible = Boolean(visible);
        matrixState.matchPanelVisible = nextVisible;
        if (matrixShell) {
            matrixShell.classList.toggle('show-match-panel', nextVisible);
        }
        if (matrixMatchPanel) {
            matrixMatchPanel.setAttribute('aria-hidden', nextVisible ? 'false' : 'true');
        }
        if (matrixToggleMatchBtn) {
            matrixToggleMatchBtn.textContent = useCompactMatrixToolbarLabels()
                ? '命中'
                : (nextVisible ? '隐藏命中' : '显示命中');
            matrixToggleMatchBtn.setAttribute('aria-pressed', nextVisible ? 'true' : 'false');
        }
    }

    function setMatrixRowIdsVisible(visible) {
        const nextVisible = Boolean(visible);
        matrixState.showRowIds = nextVisible;
        if (matrixShell) {
            matrixShell.classList.toggle('show-row-ids', nextVisible);
        }
        if (matrixToggleRowIdsBtn) {
            matrixToggleRowIdsBtn.textContent = useCompactMatrixToolbarLabels()
                ? '期号'
                : (nextVisible ? '隐藏期号' : '显示期号');
            matrixToggleRowIdsBtn.setAttribute('aria-pressed', nextVisible ? 'true' : 'false');
        }
    }

    function syncMatrixTopbarToolsVisibility() {
        const compact = isCompactMatrixTopbar();
        const showTools = !compact || matrixState.topbarToolsVisible;
        if (matrixShell) {
            matrixShell.classList.toggle('show-topbar-tools', showTools);
        }
        if (matrixTopbarTools) {
            matrixTopbarTools.setAttribute('aria-hidden', showTools ? 'false' : 'true');
        }
        if (matrixTopbarToggleBtn) {
            matrixTopbarToggleBtn.setAttribute('aria-expanded', showTools ? 'true' : 'false');
        }
    }

    function setMatrixTopbarToolsVisible(visible) {
        const nextVisible = Boolean(visible);
        const changed = matrixState.topbarToolsVisible !== nextVisible;
        matrixState.topbarToolsVisible = nextVisible;
        if (!matrixState.topbarToolsVisible) {
            setMatrixSourceModeOptionsOpen(false);
            setMatrixSizeOptionsOpen(false);
            setMatrixLimitOptionsOpen(false);
        }
        syncMatrixTopbarToolsVisibility();
        if (changed && matrixOverlay && matrixOverlay.classList.contains('show')) {
            scheduleMatrixViewportUpdate(true);
        }
    }

    function getPositionTriplets(rows, posIdx) {
        if (!rows || rows.length < 3) return [];
        const mod5 = i => ((i % 5) + 5) % 5;
        const r1 = rows[rows.length - 3];
        const r2 = rows[rows.length - 2];
        const r3 = rows[rows.length - 1];
        return [
            `${r1[mod5(posIdx + 2)]}${r2[mod5(posIdx + 3)]}${r3[mod5(posIdx + 4)]}`,
            `${r1[posIdx]}${r2[posIdx]}${r3[posIdx]}`,
            `${r1[mod5(posIdx + 3)]}${r2[mod5(posIdx + 2)]}${r3[mod5(posIdx + 1)]}`,
        ];
    }

    function clampMatrixCellSize(value) {
        if (!Number.isFinite(value)) return 20;
        return Math.min(88, Math.max(16, value));
    }

    function setMatrixSourceModeOptionsOpen(open) {
        if (!matrixSourceModeControl) return;
        const nextOpen = Boolean(open);
        matrixSourceModeControl.classList.toggle('open', nextOpen);
        if (matrixSourceModeToggleBtn) {
            matrixSourceModeToggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        }
        syncMatrixTopbarActionsState();
    }

    function setMatrixSizeOptionsOpen(open) {
        if (!matrixSizeControl) return;
        const nextOpen = Boolean(open);
        matrixSizeControl.classList.toggle('open', nextOpen);
        if (matrixSizeToggleBtn) {
            matrixSizeToggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        }
        syncMatrixTopbarActionsState();
    }

    function setMatrixLimitOptionsOpen(open) {
        if (!matrixLimitControl) return;
        const nextOpen = Boolean(open);
        matrixLimitControl.classList.toggle('open', nextOpen);
        if (matrixLimitToggleBtn) {
            matrixLimitToggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        }
        syncMatrixTopbarActionsState();
    }

    function syncMatrixTopbarActionsState() {
        if (!matrixTopbarActions) return;
        const hasOpenMenu =
            (matrixSourceModeControl && matrixSourceModeControl.classList.contains('open')) ||
            (matrixSizeControl && matrixSizeControl.classList.contains('open')) ||
            (matrixLimitControl && matrixLimitControl.classList.contains('open'));
        matrixTopbarActions.classList.toggle('menu-open', Boolean(hasOpenMenu));
        if (matrixTopbarTools) {
            matrixTopbarTools.classList.toggle('menu-open', Boolean(hasOpenMenu));
        }
    }

    function syncMatrixSourceModeControl() {
        if (!matrixSourceModeControl) return;
        const modeValue = normalizeMatrixSourceMode(
            matrixSourceModeInput ? matrixSourceModeInput.value : matrixState.sourceMode
        );
        if (matrixSourceModeToggleBtn) {
            matrixSourceModeToggleBtn.textContent = getMatrixSourceModeLabel(modeValue);
        }
        matrixSourceModeControl.querySelectorAll('.matrix-size-btn').forEach(btn => {
            btn.classList.toggle('active', normalizeMatrixSourceMode(btn.dataset.mode) === modeValue);
        });
    }

    function syncMatrixLimitControl() {
        if (!matrixLimitControl) return;
        const limitValue = normalizeLoadLimit(matrixLimitInput ? matrixLimitInput.value : getCurrentLoadLimit());
        if (matrixLimitToggleBtn) {
            matrixLimitToggleBtn.textContent = useCompactMatrixToolbarLabels()
                ? String(limitValue)
                : `期数 ${limitValue}`;
        }
        matrixLimitControl.querySelectorAll('.matrix-size-btn').forEach(btn => {
            const btnLimit = normalizeLoadLimit(btn.dataset.limit);
            btn.classList.toggle('active', btnLimit === limitValue);
        });
    }

    function applyMatrixSourceMode(mode, options = {}) {
        const nextMode = normalizeMatrixSourceMode(mode);
        const { rows, rowLabels } = selectMatrixSourceRows(matrixState.allRows, matrixState.allRowLabels, nextMode);
        if (rows.length < 3) {
            showError('当前取号方式下可用期数不足 3 期，无法展示矩阵');
            return false;
        }

        clearError();
        matrixState.sourceMode = nextMode;
        matrixState.baseRows = rows;
        matrixState.expandedRows = rows.map(expandLineToNine);
        matrixState.rowLabels = rowLabels.length === rows.length ? rowLabels : [];
        matrixState.matchesByPos = new Map();
        matrixState.searchHitKeys = new Set();

        if (matrixSourceModeInput) {
            matrixSourceModeInput.value = nextMode;
        }
        syncMatrixSourceModeControl();

        if (options.resetSelections) {
            matrixState.selectedPositions = new Set([1]);
            matrixState.selectedComboGroupsByPos = new Map([[1, new Set([1, 2, 3])]]);
            matrixState.selectedTraceGroupsByPos = new Map([[1, new Set()]]);
            matrixState.matchesByPos = new Map();
        }

        if (options.resetSearch) {
            matrixState.searchQuery = '';
            matrixState.searchHitKeys = new Set();
            if (matrixSearchInput) {
                matrixSearchInput.value = '';
            }
        }

        if (options.rebuild !== false && matrixOverlay && matrixOverlay.classList.contains('show')) {
            rebuildMatrixTableAndHighlights();
        }
        return true;
    }

    function syncMatrixSizeControl() {
        if (matrixSizeControl) {
            matrixSizeControl.querySelectorAll('.matrix-size-btn').forEach(btn => {
                const size = parseInt(btn.dataset.size || '', 10);
                btn.classList.toggle('active', size === matrixState.cellSize);
            });
        }
        if (matrixSizeToggleBtn) {
            matrixSizeToggleBtn.textContent = useCompactMatrixToolbarLabels()
                ? String(matrixState.cellSize)
                : `单元格 ${matrixState.cellSize}`;
        }
        if (matrixTableWrap) {
            matrixTableWrap.style.setProperty('--matrix-cell-size', `${matrixState.cellSize}px`);
        }
    }

    function applyMatrixCellSize(value, options = {}) {
        const next = clampMatrixCellSize(value);
        matrixState.cellSize = next;
        localStorage.setItem(MATRIX_CELL_SIZE_STORAGE_KEY, String(next));
        syncMatrixSizeControl();
        if (options.rebuild === false) return;
        if (matrixOverlay && matrixOverlay.classList.contains('show')) {
            rebuildMatrixTableAndHighlights();
        }
    }

    function computeRowsPerPage(totalRows) {
        if (!matrixTableWrap || !totalRows) return 1;
        const usableHeight = Math.max(220, matrixTableWrap.clientHeight || 0);
        const unitHeight = Math.max(12, matrixState.cellSize + 1);
        const rows = Math.floor(usableHeight / unitHeight);
        return Math.max(1, Math.min(totalRows, rows));
    }

    function calibrateRowsPerPageByRenderedTable(totalRows, currentRowsPerPage) {
        if (!matrixTableWrap || !totalRows) return currentRowsPerPage;
        const firstTable = matrixTableWrap.querySelector('.matrix-table');
        if (!firstTable) return currentRowsPerPage;
        const bodyRow = firstTable.querySelector('tbody tr');
        if (!bodyRow) return currentRowsPerPage;

        const usableHeight = Math.max(220, matrixTableWrap.clientHeight || 0);
        const rowHeight = Math.max(1, bodyRow.getBoundingClientRect().height);
        const tableHeight = Math.max(0, firstTable.getBoundingClientRect().height);
        const tolerance = Math.max(1, rowHeight * 0.12);
        let calibrated = Math.floor((usableHeight + tolerance) / rowHeight);
        calibrated = Math.max(1, Math.min(totalRows, calibrated));

        if (tableHeight > usableHeight + tolerance) {
            return Math.max(1, Math.min(currentRowsPerPage - 1, calibrated));
        }
        if (tableHeight + rowHeight <= usableHeight - tolerance) {
            return Math.max(1, Math.min(totalRows, Math.max(currentRowsPerPage + 1, calibrated)));
        }
        return calibrated;
    }

    function scheduleMatrixTableCalibration(expandedRows, remainingPasses) {
        if (!matrixTableWrap || remainingPasses <= 0) return;
        if (matrixTableCalibrationRaf) {
            cancelAnimationFrame(matrixTableCalibrationRaf);
        }
        matrixTableCalibrationRaf = requestAnimationFrame(() => {
            matrixTableCalibrationRaf = 0;
            const calibratedRows = calibrateRowsPerPageByRenderedTable(expandedRows.length, matrixState.rowsPerPage);
            if (calibratedRows !== matrixState.rowsPerPage) {
                renderMatrixTable(expandedRows, calibratedRows, remainingPasses - 1);
                return;
            }
            scheduleMatrixTableCalibration(expandedRows, remainingPasses - 1);
        });
    }

    function renderMatrixTable(expandedRows, rowsPerPageOverride = null, calibrationPasses = 3) {
        if (!matrixTableWrap) return;
        if (matrixTableCalibrationRaf) {
            cancelAnimationFrame(matrixTableCalibrationRaf);
            matrixTableCalibrationRaf = 0;
        }
        matrixState.rowsPerPage = Number.isInteger(rowsPerPageOverride)
            ? rowsPerPageOverride
            : computeRowsPerPage(expandedRows.length);

        let stripHtml = '<div class="matrix-table-strip">';

        for (let start = 0; start < expandedRows.length; start += matrixState.rowsPerPage) {
            const end = Math.min(expandedRows.length, start + matrixState.rowsPerPage);
            stripHtml += '<table class="matrix-table"><tbody>';

            for (let rowIdx = start; rowIdx < end; rowIdx++) {
                const line = expandedRows[rowIdx];
                stripHtml += '<tr>';
                stripHtml += `<th class="matrix-row-id">${formatMatrixRowId(matrixState.rowLabels[rowIdx], rowIdx)}</th>`;

                for (let colIdx = 0; colIdx < line.length; colIdx++) {
                    const key = `${rowIdx}-${colIdx}`;
                    stripHtml += `
                        <td class="matrix-cell" data-key="${key}">
                            <span class="matrix-cell-digit">${line[colIdx]}</span>
                            <span class="matrix-cell-mark"></span>
                        </td>
                    `;
                }
                stripHtml += '</tr>';
            }
            stripHtml += '</tbody></table>';
        }

        stripHtml += '</div>';
        matrixTableWrap.innerHTML = stripHtml;
        syncMatrixSizeControl();
        if (matrixState.baseRows.length) {
            updateMatrixBySelections();
        }
        scheduleMatrixTableCalibration(expandedRows, calibrationPasses);
    }

    function findMatrixMatches(expandedRows, triplets) {
        if (!expandedRows.length || !triplets.length) return [];
        const rowCount = expandedRows.length;
        const colCount = expandedRows[0].length;
        const targetGroupMap = new Map();
        triplets.forEach((triplet, idx) => {
            targetGroupMap.set(triplet, idx);
        });

        const matches = [];
        const collect = (positions, direction, deltaRow, deltaCol) => {
            const sequence = positions.map(([r, c]) => expandedRows[r][c]).join('');
            const group = targetGroupMap.get(sequence);
            if (group === undefined) return;
            const [lastRow, lastCol] = positions[positions.length - 1];
            if (!isAllowedMatrixMatchLastCol(lastCol)) return;
            const nextRow = lastRow + deltaRow;
            const nextCol = lastCol + deltaCol;
            const hasNext = nextRow >= 0 && nextRow < rowCount && nextCol >= 0 && nextCol < colCount;
            const nextDigit = hasNext ? expandedRows[nextRow][nextCol] : null;
            matches.push({
                sequence,
                group,
                direction,
                positions,
                nextDigit,
                nextPosition: hasNext ? [nextRow, nextCol] : null,
            });
        };

        const directions = [
            { name: '横向→', dr: 0, dc: 1 },
            { name: '横向←', dr: 0, dc: -1 },
            { name: '纵向↓', dr: 1, dc: 0 },
            { name: '纵向↑', dr: -1, dc: 0 },
            { name: '斜向↘', dr: 1, dc: 1 },
            { name: '斜向↖', dr: -1, dc: -1 },
            { name: '斜向↙', dr: 1, dc: -1 },
            { name: '斜向↗', dr: -1, dc: 1 },
        ];
        directions.forEach(({ name, dr, dc }) => {
            for (let r = 0; r < rowCount; r++) {
                for (let c = 0; c < colCount; c++) {
                    const positions = [];
                    let valid = true;
                    for (let i = 0; i < 3; i++) {
                        const nr = r + dr * i;
                        const nc = c + dc * i;
                        if (nr < 0 || nr >= rowCount || nc < 0 || nc >= colCount) {
                            valid = false;
                            break;
                        }
                        positions.push([nr, nc]);
                    }
                    if (!valid) continue;
                    collect(positions, name, dr, dc);
                }
            }
        });

        return matches;
    }

    function isValidMatrixSearchQuery(query) {
        return /^\d+$/.test(query) && query.length >= MATRIX_SEARCH_MIN_LEN && query.length <= MATRIX_SEARCH_MAX_LEN;
    }

    function findMatrixSearchHitKeys(expandedRows, query) {
        const keys = new Set();
        if (!expandedRows.length || !isValidMatrixSearchQuery(query)) return keys;
        const queryLen = query.length;
        const rowCount = expandedRows.length;
        const colCount = expandedRows[0].length;
        const directions = [
            { dr: 0, dc: 1 },
            { dr: 0, dc: -1 },
            { dr: 1, dc: 0 },
            { dr: -1, dc: 0 },
            { dr: 1, dc: 1 },
            { dr: -1, dc: -1 },
            { dr: 1, dc: -1 },
            { dr: -1, dc: 1 },
        ];

        directions.forEach(({ dr, dc }) => {
            for (let r = 0; r < rowCount; r++) {
                for (let c = 0; c < colCount; c++) {
                    const positions = [];
                    let sequence = '';
                    let valid = true;
                    for (let i = 0; i < queryLen; i++) {
                        const nr = r + dr * i;
                        const nc = c + dc * i;
                        if (nr < 0 || nr >= rowCount || nc < 0 || nc >= colCount) {
                            valid = false;
                            break;
                        }
                        positions.push([nr, nc]);
                        sequence += expandedRows[nr][nc];
                    }
                    if (!valid || sequence !== query) continue;
                    positions.forEach(([nr, nc]) => keys.add(`${nr}-${nc}`));
                }
            }
        });

        return keys;
    }

    function applyMatrixSearchQuery(rawValue) {
        const cleaned = String(rawValue || '').replace(/\D/g, '').slice(0, MATRIX_SEARCH_MAX_LEN);
        if (matrixSearchInput) {
            matrixSearchInput.value = cleaned;
        }
        if (!cleaned) {
            clearMatrixSearchQuery();
            return;
        }
        if (!isValidMatrixSearchQuery(cleaned)) {
            showError(`请输入至少 ${MATRIX_SEARCH_MIN_LEN} 位数字进行搜索`);
            return;
        }
        clearError();
        matrixState.searchQuery = cleaned;
        updateMatrixBySelections();
    }

    function clearMatrixSearchQuery() {
        if (matrixSearchInput) {
            matrixSearchInput.value = '';
        }
        matrixState.searchQuery = '';
        matrixState.searchHitKeys = new Set();
        clearError();
        updateMatrixBySelections();
    }

    function getTraceConfig(posIdx, groupNo) {
        // Fixed trace lanes over expanded 9 columns:
        // G1 (↘): [0-1-2] .. [4-5-6]
        // G2 (↓): [2] .. [6]
        // G3 (↙): [4-3-2] .. [8-7-6]
        const safePos = Math.max(0, Math.min(4, Number.isInteger(posIdx) ? posIdx : 0));
        let upperCol = safePos + 2;
        let lowerCol = safePos + 2;
        let nextCol = safePos + 2;
        let direction = '↓';
        const dr = 1;
        let dc = 0;

        if (groupNo === 1) {
            direction = '↘';
            upperCol = safePos;
            lowerCol = safePos + 1;
            nextCol = safePos + 2;
            dc = 1;
        } else if (groupNo === 2) {
            direction = '↓';
            upperCol = safePos + 2;
            lowerCol = safePos + 2;
            nextCol = safePos + 2;
            dc = 0;
        } else {
            direction = '↙';
            upperCol = safePos + 4;
            lowerCol = safePos + 3;
            nextCol = safePos + 2;
            dc = -1;
        }

        return {
            upperCol,
            lowerCol,
            nextCol,
            direction,
            dr,
            dc,
        };
    }

    function findTraceNextPositions(expandedRows, pairText, config) {
        if (!expandedRows.length || !pairText || pairText.length < 2) return [];
        const rowCount = expandedRows.length;
        const colCount = expandedRows[0].length;
        const [firstChar, secondChar] = pairText.split('');
        const hits = [];
        const dr = Number.isInteger(config.dr) ? config.dr : 1;
        for (let r = 0; r < rowCount; r++) {
            const secondRow = r + dr;
            const nextRow = r + dr * 2;
            if (secondRow < 0 || secondRow >= rowCount || nextRow < 0 || nextRow >= rowCount) continue;
            if (
                config.upperCol < 0 || config.upperCol >= colCount ||
                config.lowerCol < 0 || config.lowerCol >= colCount ||
                config.nextCol < 0 || config.nextCol >= colCount
            ) {
                continue;
            }
            if (
                expandedRows[r][config.upperCol] === firstChar &&
                expandedRows[secondRow][config.lowerCol] === secondChar
            ) {
                hits.push([
                    [r, config.upperCol],
                    [secondRow, config.lowerCol],
                    [nextRow, config.nextCol],
                ]);
            }
        }
        return hits;
    }

    function findTraceSeedPositions(expandedRows, pairText, config) {
        if (!expandedRows.length || !pairText || pairText.length < 2) return [];
        if (expandedRows.length < 2) return [];
        const colCount = expandedRows[0].length;
        const [firstChar, secondChar] = pairText.split('');
        const firstRow = expandedRows.length - 2;
        const secondRow = expandedRows.length - 1;
        if (
            config.upperCol < 0 || config.upperCol >= colCount ||
            config.lowerCol < 0 || config.lowerCol >= colCount
        ) {
            return [];
        }
        if (
            expandedRows[firstRow][config.upperCol] !== firstChar ||
            expandedRows[secondRow][config.lowerCol] !== secondChar
        ) {
            return [];
        }
        return [[[firstRow, config.upperCol], [secondRow, config.lowerCol]]];
    }

    function renderMatrixNextStats(matchesByPos, traceNextHitsByPos, hasTraceSelection = false, traceLabelByGroup = new Map()) {
        if (!matrixNextStats) return;
        if ((!matchesByPos || !matchesByPos.size) && (!traceNextHitsByPos || !traceNextHitsByPos.size)) {
            matrixNextStats.innerHTML = '<p class="matrix-next-empty">请选择至少 1 个位置</p>';
            return;
        }

        const initGroupStats = sourceMap => {
            const groupStats = [];
            sourceMap.forEach((_, pos) => {
                for (let group = 1; group <= 3; group++) {
                    groupStats.push({
                        pos,
                        group,
                        total: 0,
                        nextCount: new Map(),
                    });
                }
            });
            const groupMap = new Map(groupStats.map(item => [`${item.pos}-${item.group}`, item]));
            return { groupStats, groupMap };
        };

        const hitStatsData = initGroupStats(matchesByPos || new Map());
        const hitSummary = {
            total: 0,
            nextCount: new Map(),
        };
        const hitDedupSet = new Set();
        (matchesByPos || new Map()).forEach((matches, pos) => {
            matches.forEach(match => {
                const groupNo = (match.group || 0) + 1;
                const groupItem = hitStatsData.groupMap.get(`${pos}-${groupNo}`);
                if (!groupItem) return;

                const dedupKey = `${buildStatsDedupKey(pos, match)}|g${groupNo}`;
                if (hitDedupSet.has(dedupKey)) return;
                hitDedupSet.add(dedupKey);

                groupItem.total += 1;
                hitSummary.total += 1;
                if (match.nextDigit === null) return;
                groupItem.nextCount.set(match.nextDigit, (groupItem.nextCount.get(match.nextDigit) || 0) + 1);
                hitSummary.nextCount.set(match.nextDigit, (hitSummary.nextCount.get(match.nextDigit) || 0) + 1);
            });
        });

        const traceStatsData = initGroupStats(traceNextHitsByPos || new Map());
        const traceSummary = {
            total: 0,
            nextCount: new Map(),
        };
        const hasActiveTrace = Boolean(hasTraceSelection) || [...(traceNextHitsByPos || new Map()).values()].some(groupMap => groupMap && groupMap.size > 0);
        const traceDedupSet = new Set();
        (traceNextHitsByPos || new Map()).forEach((groupMap, pos) => {
            groupMap.forEach((hitGroups, groupNo) => {
                const groupItem = traceStatsData.groupMap.get(`${pos}-${groupNo}`);
                if (!groupItem) return;
                (hitGroups || []).forEach(positions => {
                    if (!positions || !positions.length) return;
                    const dedupKey = buildTraceStatsDedupKey(pos, groupNo, positions);
                    if (traceDedupSet.has(dedupKey)) return;
                    traceDedupSet.add(dedupKey);

                    if (positions.length < 3) return;
                    groupItem.total += 1;
                    traceSummary.total += 1;
                    const [nextRow, nextCol] = positions[positions.length - 1];
                    const nextDigit = matrixState.expandedRows[nextRow] ? matrixState.expandedRows[nextRow][nextCol] : null;
                    if (nextDigit === null || nextDigit === undefined) return;
                    groupItem.nextCount.set(nextDigit, (groupItem.nextCount.get(nextDigit) || 0) + 1);
                    traceSummary.nextCount.set(nextDigit, (traceSummary.nextCount.get(nextDigit) || 0) + 1);
                });
            });
        });

        const renderCountHeatRows = countMap => {
            const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
            const counts = digits.map(d => (countMap.get(d) || countMap.get(Number(d)) || 0));
            const maxCount = Math.max(...counts, 0);
            const digitRow = digits.map((digit, idx) => {
                const hasHit = counts[idx] > 0;
                const hitClass = hasHit ? ' hit' : '';
                return `<span class="matrix-next-heat-cell matrix-next-heat-digit${hitClass}">${digit}</span>`;
            }).join('');
            const countRow = counts.map(count => {
                if (count <= 0) {
                    return '<span class="matrix-next-heat-cell matrix-next-heat-count zero">0</span>';
                }
                const strength = maxCount > 0 ? (count / maxCount) : 0;
                const alpha = (0.22 + strength * 0.72).toFixed(3);
                const textColor = strength >= 0.52 ? '#ffffff' : '#7f1d1d';
                return `<span class="matrix-next-heat-cell matrix-next-heat-count" style="background: rgba(220, 38, 38, ${alpha}); color: ${textColor};">${count}</span>`;
            }).join('');
            return `
                <div class="matrix-next-heat" role="presentation">
                    <div class="matrix-next-heat-row">${digitRow}</div>
                    <div class="matrix-next-heat-row">${countRow}</div>
                </div>
            `;
        };

        const renderStatsSection = ({ title, groupStats, summary, groupLabel, emptyHint, itemLabelBuilder, showGroupBlocks = true, showWhenZero = false }) => {
            groupStats.sort((a, b) => {
                if (a.pos !== b.pos) return a.pos - b.pos;
                return a.group - b.group;
            });
            if (!summary.total && !showWhenZero) {
                return `
                    <section class="matrix-next-section">
                        <div class="matrix-next-title">${title}</div>
                        <p class="matrix-next-empty-chip">${emptyHint}</p>
                    </section>
                `;
            }
            const groupBlocks = showGroupBlocks
                ? groupStats.map(item => `
                    <section class="matrix-next-group">
                        <div class="matrix-next-group-head matrix-combo-group-chip-${item.group}">
                            <span class="matrix-next-group-title">${[itemLabelBuilder(item), groupLabel].filter(Boolean).join(' ')}</span>
                            <span class="matrix-next-group-count">${item.total} 次</span>
                        </div>
                        ${renderCountHeatRows(item.nextCount)}
                    </section>
                `).join('')
                : '';
            const summaryLabel = groupLabel ? `汇总：${groupLabel}` : '汇总';
            const summaryBlock = `
                <section class="matrix-next-summary">
                    <div class="matrix-next-summary-head">
                        <span class="matrix-next-group-title">${summaryLabel}</span>
                        <span class="matrix-next-group-count">${summary.total} 次</span>
                    </div>
                    ${renderCountHeatRows(summary.nextCount)}
                </section>
            `;
            return `<section class="matrix-next-section"><div class="matrix-next-title">${title}</div>${groupBlocks}${summaryBlock}</section>`;
        };

        const hitSection = renderStatsSection({
            title: '命中统计',
            groupStats: hitStatsData.groupStats,
            summary: hitSummary,
            groupLabel: '命中',
            emptyHint: '当前位次未命中任何组合',
            itemLabelBuilder: item => `P${item.pos}-C${item.group}`,
        });
        const traceSection = renderStatsSection({
            title: '追踪统计',
            groupStats: traceStatsData.groupStats,
            summary: traceSummary,
            groupLabel: '',
            emptyHint: '当前未开启追踪或暂无追踪命中',
            itemLabelBuilder: item => traceLabelByGroup.get(`${item.pos}-${item.group}`) || '追踪 --',
            showGroupBlocks: true,
            showWhenZero: hasActiveTrace,
        });
        matrixNextStats.innerHTML = `${hitSection}${traceSection}`;
    }

    function renderMatrixComboInfo(comboGroups) {
        if (!matrixComboInfo) return;
        if (!comboGroups.length) {
            matrixComboInfo.innerHTML = '<span class="matrix-combo-empty">请选择至少 1 个位置</span>';
            return;
        }
        matrixComboInfo.innerHTML = comboGroups.map(group => {
            const comboButtons = group.triplets
                .map((triplet, idx) => {
                    const groupNo = idx + 1;
                    const isActive = group.activeGroups.has(groupNo);
                    const stateClass = isActive ? 'active' : 'inactive';
                    return `<button type="button" class="matrix-combo-chip matrix-combo-group-chip-${groupNo} ${stateClass}" data-pos="${group.pos}" data-group="${groupNo}">P${group.pos}-C${groupNo}: ${triplet}</button>`;
                })
                .join('');
            const traceButtons = group.triplets
                .map((triplet, idx) => {
                    const groupNo = idx + 1;
                    const pairText = triplet.slice(1);
                    const isTraceActive = group.activeTraceGroups.has(groupNo);
                    const traceStateClass = isTraceActive ? 'active' : 'inactive';
                    const traceDirection = getTraceConfig(group.pos - 1, groupNo).direction;
                    return `<button type="button" class="matrix-trace-chip matrix-combo-group-chip-${groupNo} ${traceStateClass}" data-pos="${group.pos}" data-group="${groupNo}">追踪 ${traceDirection} ${pairText}</button>`;
                })
                .join('');
            return `<div class="matrix-combo-group">${comboButtons}${traceButtons}</div>`;
        }).join('');
    }

    function paintMatrixMatches(matchesByPos, traceNextHitsByPos, searchHitKeys) {
        if (!matrixTableWrap) return;

        // 优化点：不遍历所有节点，而是只清空当前身上带有高亮类名的那些节点
        const activeCells = matrixTableWrap.querySelectorAll(
            '.matrix-hit-pos1, .matrix-hit-pos2, .matrix-hit-pos3, .matrix-hit-pos4, .matrix-hit-pos5, ' +
            '.matrix-hit-pos-multi, .matrix-hit-group1, .matrix-hit-group2, .matrix-hit-group3, .matrix-hit-group-multi, ' +
            '.matrix-hit-next-red, .matrix-hit-search'
        );

        activeCells.forEach(cell => {
            cell.className = 'matrix-cell'; // 重置为唯一基础类名
            const mark = cell.querySelector('.matrix-cell-mark');
            if (mark) mark.textContent = '';
        });

        const hitMap = new Map();
        matchesByPos.forEach((matches, pos) => {
            matches.forEach(match => {
                match.positions.forEach(([r, c]) => {
                    const key = `${r}-${c}`;
                    if (!hitMap.has(key)) {
                        hitMap.set(key, {
                            posSet: new Set(),
                            groupSet: new Set(),
                        });
                    }
                    const hit = hitMap.get(key);
                    hit.posSet.add(pos);
                    hit.groupSet.add((match.group || 0) + 1);
                });
            });
        });

        // 获取对应的 DOM 对象
        const getCellDom = (key) => matrixTableWrap.querySelector(`td[data-key="${key}"]`);

        hitMap.forEach((hit, key) => {
            const cell = getCellDom(key);
            if (!cell) return;
            const groups = [...hit.groupSet].sort((a, b) => a - b);
            if (groups.length !== 1 || hit.posSet.size !== 1) {
                cell.classList.add('matrix-hit-group-multi');
                return;
            }
            cell.classList.add(`matrix-hit-group${groups[0]}`);
        });

        traceNextHitsByPos.forEach(groupMap => {
            groupMap.forEach(hitGroups => {
                hitGroups.forEach(positions => {
                    positions.forEach(([r, c]) => {
                        const cell = getCellDom(`${r}-${c}`);
                        if (cell) cell.classList.add('matrix-hit-next-red');
                    });
                });
            });
        });

        (searchHitKeys || new Set()).forEach(key => {
            const cell = getCellDom(key);
            if (cell) cell.classList.add('matrix-hit-search');
        });
    }

    function updateMatrixBySelections() {
        if (!matrixState.baseRows.length || !matrixState.expandedRows.length) return;
        if (matrixPosControls) {
            matrixPosControls.querySelectorAll('.matrix-pos-btn').forEach(btn => {
                const pos = parseInt(btn.dataset.pos || '', 10);
                const isActive = matrixState.selectedPositions.has(pos);
                btn.classList.toggle('active', isActive);
            });
        }

        const selected = [...matrixState.selectedPositions].sort((a, b) => a - b);
        const comboGroups = [];
        const matchesByPos = new Map();
        const traceNextHitsByPos = new Map();
        const traceLabelByGroup = new Map();
        let hasTraceSelection = false;
        selected.forEach(pos => {
            const triplets = getPositionTriplets(matrixState.baseRows, pos - 1);
            for (let groupNo = 1; groupNo <= 3; groupNo++) {
                const pairText = triplets[groupNo - 1] ? triplets[groupNo - 1].slice(1) : '';
                const traceDirection = getTraceConfig(pos - 1, groupNo).direction;
                traceLabelByGroup.set(`${pos}-${groupNo}`, `追踪 ${traceDirection} ${pairText || '--'}`);
            }
            const activeGroups = matrixState.selectedComboGroupsByPos.get(pos) || new Set([1, 2, 3]);
            matrixState.selectedComboGroupsByPos.set(pos, activeGroups);
            const activeTraceGroups = matrixState.selectedTraceGroupsByPos.get(pos) || new Set();
            matrixState.selectedTraceGroupsByPos.set(pos, activeTraceGroups);
            if (activeTraceGroups.size > 0) {
                hasTraceSelection = true;
            }
            comboGroups.push({ pos, triplets, activeGroups, activeTraceGroups });

            const allMatches = findMatrixMatches(matrixState.expandedRows, triplets);
            const filteredMatches = allMatches.filter(match => activeGroups.has((match.group || 0) + 1));
            matchesByPos.set(pos, filteredMatches);

            const traceHitsByGroup = new Map();
            activeTraceGroups.forEach(groupNo => {
                if (groupNo < 1 || groupNo > 3) return;
                const pairText = triplets[groupNo - 1] ? triplets[groupNo - 1].slice(1) : '';
                const config = getTraceConfig(pos - 1, groupNo);
                const nextHits = findTraceNextPositions(matrixState.expandedRows, pairText, config);
                const seedHits = findTraceSeedPositions(matrixState.expandedRows, pairText, config);
                traceHitsByGroup.set(groupNo, [...nextHits, ...seedHits]);
            });
            traceNextHitsByPos.set(pos, traceHitsByGroup);
        });

        if (isValidMatrixSearchQuery(matrixState.searchQuery || '')) {
            matrixState.searchHitKeys = findMatrixSearchHitKeys(matrixState.expandedRows, matrixState.searchQuery);
        } else {
            matrixState.searchHitKeys = new Set();
        }

        matrixState.matchesByPos = matchesByPos;
        renderMatrixComboInfo(comboGroups);
        renderMatrixNextStats(matchesByPos, traceNextHitsByPos, hasTraceSelection, traceLabelByGroup);
        paintMatrixMatches(matchesByPos, traceNextHitsByPos, matrixState.searchHitKeys);
    }

    function rebuildMatrixTableAndHighlights() {
        if (!matrixState.expandedRows.length) return;
        updateMatrixViewportHeight();
        renderMatrixTable(matrixState.expandedRows);
        rememberMatrixViewportSignature();
    }

    async function openMatrixView() {
        clearError();
        const rows = normalizeSourceRows();
        if (!rows) return;
        if (rows.length < 3) {
            showError('至少需要 3 期开奖号码才能开启全屏矩阵');
            return;
        }

        matrixState.allRows = [...rows];
        matrixState.allRowLabels = currentSourceExpects.length === rows.length ? [...currentSourceExpects] : [];
        matrixState.sourceMode = 'normal';
        applyMatrixSourceMode('normal', {
            resetSelections: true,
            resetSearch: true,
            rebuild: false,
        });
        setMatrixSizeOptionsOpen(false);
        setMatrixSourceModeOptionsOpen(false);
        setMatrixLimitOptionsOpen(false);
        setMatrixMatchPanelVisible(false);
        setMatrixRowIdsVisible(false);
        setMatrixTopbarToolsVisible(false);
        applyMatrixCellSize(getPreferredMatrixCellSize(), { rebuild: false });
        updateMatrixViewportHeight();

        if (matrixOverlay) {
            matrixOverlay.classList.add('show');
            matrixOverlay.setAttribute('aria-hidden', 'false');
        }
        document.body.classList.add('matrix-open');
        void requestMatrixFullscreen();
        await new Promise(resolve => requestAnimationFrame(resolve));
        updateMatrixViewportHeight();
        rebuildMatrixTableAndHighlights();

    }

    async function closeMatrixView() {
        closeMatrixOverlayState();
        await exitMatrixFullscreen();
    }

    function showError(msg) {
        if (errorMsg) errorMsg.textContent = msg;
    }
    function clearError() {
        if (errorMsg) errorMsg.textContent = '';
    }

    async function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (err) {
                console.error('Clipboard API failed:', err);
            }
        }
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-9999px';
            textArea.style.top = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            return successful;
        } catch (err) {
            console.error('Fallback copy failed:', err);
            return false;
        }
    }

    function buildFileTimestamp() {
        const now = new Date();
        const pad = num => String(num).padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }

    function sanitizeFilename(name) {
        const base = String(name || '').trim() || '导出结果';
        return base.replace(/[\\/:*?"<>|]/g, '_');
    }

    function downloadTextAsFile(lines, filePrefix) {
        if (!Array.isArray(lines) || !lines.length) return false;
        try {
            const content = lines.map(line => String(line)).join('\n');
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${sanitizeFilename(filePrefix)}_${buildFileTimestamp()}.txt`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(link.href), 200);
            return true;
        } catch (err) {
            console.error('Download txt failed:', err);
            return false;
        }
    }

    // ═══ 备选池管理 (Candidate Pool) ═══
    const candidatePanel = document.getElementById('candidatePanel');
    const candidateToggleTab = document.getElementById('candidateToggleTab');
    const candidateBadge = document.getElementById('candidateBadge');
    const candidateListEl = document.getElementById('candidateList');
    const candidateClearAllBtn = document.getElementById('candidateClearAllBtn');
    const candidateIntersectBtn = document.getElementById('candidateIntersectBtn');
    const intersectionModal = document.getElementById('intersectionModal');
    const intersectionCloseBtn = document.getElementById('intersectionCloseBtn');
    const intersectionCopyBtn = document.getElementById('intersectionCopyBtn');
    const intersectionDownloadBtn = document.getElementById('intersectionDownloadBtn');
    const intersectionCountLabel = document.getElementById('intersectionCountLabel');
    const intersectionResultArea = document.getElementById('intersectionResultArea');

    let candidatePool = [];
    let candidateIdCounter = 0;
    let lastIntersectionResults = [];
    let candidateSyncCallbacks = [];

    function addCandidate(sourceKey, label, numbers) {
        if (!numbers || !numbers.length) return;
        candidateIdCounter++;
        candidatePool.push({
            id: candidateIdCounter,
            sourceKey: sourceKey,
            label: label,
            numbers: [...numbers]
        });
        renderCandidatePanel();
        // 自动展开面板
        if (candidatePanel && candidatePanel.classList.contains('collapsed')) {
            candidatePanel.classList.remove('collapsed');
        }
    }

    function removeCandidate(id) {
        candidatePool = candidatePool.filter(c => c.id !== id);
        renderCandidatePanel();
    }

    function clearAllCandidates() {
        candidatePool = [];
        renderCandidatePanel();
    }

    function computeIntersection(minErr, maxErr) {
        if (candidatePool.length === 0) return [];
        const totalSets = candidatePool.length;

        // 统计每个号码出现在多少个备选中
        const counts = new Map();
        candidatePool.forEach(c => {
            const seen = new Set(c.numbers);
            seen.forEach(num => {
                counts.set(num, (counts.get(num) || 0) + 1);
            });
        });

        // 根据容错范围过滤
        const minCount = Math.max(0, totalSets - maxErr);
        const maxCount = totalSets - minErr;
        const results = [];
        counts.forEach((count, num) => {
            if (count >= minCount && count <= maxCount) {
                results.push(num);
            }
        });
        return results.sort();
    }

    function buildIntersectionToleranceOptions(total) {
        const intersectionErrMin = document.getElementById('intersectionErrMin');
        const intersectionErrMax = document.getElementById('intersectionErrMax');
        const settingsTitle = document.getElementById('intersectionSettingsTitle');
        if (!intersectionErrMin || !intersectionErrMax) return;

        // 容错范围 0 到 total-1
        const maxTolerance = Math.max(0, total - 1);
        const optionsHtml = Array.from({ length: maxTolerance + 1 }, (_, i) =>
            `<div class="custom-option${i===0?' selected':''}">${i}</div>`
        ).join('');
        intersectionErrMin.querySelector('.custom-select-options').innerHTML = optionsHtml;
        intersectionErrMax.querySelector('.custom-select-options').innerHTML = optionsHtml;
        intersectionErrMin.querySelector('.custom-select-trigger span').textContent = '0';
        intersectionErrMax.querySelector('.custom-select-trigger span').textContent = '0';
        
        initCustomSelect(intersectionErrMin, applyIntersectionFilter);
        initCustomSelect(intersectionErrMax, applyIntersectionFilter);

        if (settingsTitle) {
            settingsTitle.textContent = `容错条件（共 ${total} 项备选）`;
        }
    }

    function getCustomSelectValueById(id) {
        const span = document.querySelector(`#${id} .custom-select-trigger span`);
        return span ? parseInt(span.textContent, 10) : 0;
    }

    function applyIntersectionFilter() {
        let minErr = getCustomSelectValueById('intersectionErrMin');
        let maxErr = getCustomSelectValueById('intersectionErrMax');
        if (isNaN(minErr)) minErr = 0;
        if (isNaN(maxErr)) maxErr = 0;
        if (minErr > maxErr) [minErr, maxErr] = [maxErr, minErr];

        const results = computeIntersection(minErr, maxErr);
        lastIntersectionResults = results;
        if (intersectionCountLabel) {
            intersectionCountLabel.textContent = results.length;
        }
        if (intersectionResultArea) {
            intersectionResultArea.innerHTML = results.length > 0
                ? results.map(num => `<div class="grid-num-item">${num}</div>`).join('')
                : '<p class="empty-hint">无符合条件的结果</p>';
        }
        // 倒退模式验证
        const verifyEl1 = document.getElementById('intersectionRetreatVerify');
        if (verifyEl1) verifyEl1.innerHTML = buildRetreatIntersectHtml(results);
    }

    function showIntersectionModal() {
        if (!intersectionModal) return;

        // 初始化容错选项
        buildIntersectionToleranceOptions(candidatePool.length);

        // 默认容错 0,0 即精确交集
        const results = computeIntersection(0, 0);
        lastIntersectionResults = results;

        if (intersectionCountLabel) {
            intersectionCountLabel.textContent = results.length;
        }
        if (intersectionResultArea) {
            intersectionResultArea.innerHTML = results.length > 0
                ? results.map(num => `<div class="grid-num-item">${num}</div>`).join('')
                : '<p class="empty-hint">无符合条件的结果</p>';
        }
        // 倒退模式验证
        const intersectVerifyEl = document.getElementById('intersectionRetreatVerify');
        if (intersectVerifyEl) intersectVerifyEl.innerHTML = buildRetreatIntersectHtml(results);

        // 绑定重新过滤按钮
        const applyBtn = document.getElementById('intersectionApplyBtn');
        if (applyBtn) {
            applyBtn.onclick = applyIntersectionFilter;
        }

        intersectionModal.style.display = 'flex';
    }

    function renderCandidatePanel() {
        if (!candidateListEl) return;

        // 更新角标
        if (candidateBadge) {
            if (candidatePool.length > 0) {
                candidateBadge.textContent = candidatePool.length;
                candidateBadge.style.display = 'flex';
            } else {
                candidateBadge.style.display = 'none';
            }
        }

        // 更新列表
        if (candidatePool.length === 0) {
            candidateListEl.innerHTML = '<p class="empty-hint">暂无备选项</p>';
        } else {
            candidateListEl.innerHTML = candidatePool.map(c => `
                <div class="candidate-item" data-id="${c.id}">
                    <div class="candidate-item-info">
                        <span class="candidate-item-label" title="${c.label}">${c.label}</span>
                        <span class="candidate-item-count">${c.numbers.length} 注</span>
                    </div>
                    <button class="candidate-remove-btn" data-id="${c.id}" type="button" title="移除">✕</button>
                </div>
            `).join('');

            // 绑定移除按钮事件
            candidateListEl.querySelectorAll('.candidate-remove-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = parseInt(btn.dataset.id, 10);
                    if (Number.isInteger(id)) removeCandidate(id);
                });
            });
        }

        // 更新求交集按钮状态
        if (candidateIntersectBtn) {
            candidateIntersectBtn.disabled = candidatePool.length < 2;
            candidateIntersectBtn.textContent = candidatePool.length < 2
                ? '求交集（至少选2项）'
                : `求交集（${candidatePool.length} 项）`;
        }

        // 同步所有添加按钮状态
        candidateSyncCallbacks.forEach(cb => cb());
    }

    function hideIntersectionModal() {
        if (intersectionModal) intersectionModal.style.display = 'none';
        lastIntersectionResults = [];
    }

    // 绑定面板事件
    if (candidateToggleTab) {
        candidateToggleTab.addEventListener('click', () => {
            if (candidatePanel) candidatePanel.classList.toggle('collapsed');
        });
    }

    if (candidateClearAllBtn) {
        candidateClearAllBtn.addEventListener('click', clearAllCandidates);
    }

    if (candidateIntersectBtn) {
        candidateIntersectBtn.addEventListener('click', () => {
            showIntersectionModal();
        });
    }

    if (intersectionCloseBtn) {
        intersectionCloseBtn.addEventListener('click', hideIntersectionModal);
    }

    if (intersectionModal) {
        const backdrop = intersectionModal.querySelector('.intersection-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', hideIntersectionModal);
        }
    }

    if (intersectionCopyBtn) {
        intersectionCopyBtn.addEventListener('click', async () => {
            if (!lastIntersectionResults.length) return;
            const success = await copyToClipboard(lastIntersectionResults.join('\n'));
            if (success) {
                const old = intersectionCopyBtn.innerHTML;
                intersectionCopyBtn.innerHTML = `
                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
                    已成功复制！
                `;
                intersectionCopyBtn.style.background = '#10b981';
                setTimeout(() => {
                    intersectionCopyBtn.innerHTML = old;
                    intersectionCopyBtn.style.background = '';
                }, 1500);
            } else {
                alert('复制失败，请手动选择复制');
            }
        });
    }

    if (intersectionDownloadBtn) {
        intersectionDownloadBtn.addEventListener('click', () => {
            if (!lastIntersectionResults.length) return;
            const success = downloadTextAsFile(lastIntersectionResults, '交集结果');
            if (success) {
                const old = intersectionDownloadBtn.innerHTML;
                intersectionDownloadBtn.innerHTML = `
                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
                    已下载TXT
                `;
                intersectionDownloadBtn.style.background = '#0f766e';
                setTimeout(() => {
                    intersectionDownloadBtn.innerHTML = old;
                    intersectionDownloadBtn.style.background = '';
                }, 1500);
            } else {
                alert('下载失败，请重试');
            }
        });
    }

    // 初始化面板
    renderCandidatePanel();

    // 创建添加到备选按钮的通用工厂函数
    function isCandidateSourceKeyExists(sourceKey) {
        return candidatePool.some(c => c.sourceKey === sourceKey);
    }

    function createAddCandidateButton(getSourceKey, getLabel, getNumbers) {
        const btn = document.createElement('button');
        btn.className = 'add-candidate-btn';
        const defaultHtml = `
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14"></path></svg>
            添加到备选
        `;
        const addedHtml = `
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg>
            已添加
        `;

        function syncState() {
            const sourceKey = getSourceKey();
            if (isCandidateSourceKeyExists(sourceKey)) {
                btn.disabled = true;
                btn.classList.add('added');
                btn.innerHTML = addedHtml;
            } else {
                btn.disabled = false;
                btn.classList.remove('added');
                btn.innerHTML = defaultHtml;
            }
        }

        btn.innerHTML = defaultHtml;
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            const sourceKey = getSourceKey();
            const label = getLabel();
            const numbers = getNumbers();
            if (!numbers || !numbers.length) {
                alert('当前无结果可添加');
                return;
            }
            if (isCandidateSourceKeyExists(sourceKey)) return;
            addCandidate(sourceKey, label, numbers);
            syncState();
        });

        // 注册回调：备选池变化时自动同步按钮状态
        candidateSyncCallbacks.push(syncState);
        syncState();
        return btn;
    }

});
