document.addEventListener('DOMContentLoaded', () => {
    const errorMsg = document.getElementById('errorMsg');
    const inputDisplay = document.getElementById('inputDisplay');
    const statsDisplay = document.getElementById('statsDisplay');
    const fetchNetBtn = document.getElementById('fetchNetBtn');
    const limitInput = document.getElementById('limitInput');
    const latestResultBanner = document.getElementById('latestResultBanner');
    const bannerDate = document.getElementById('bannerDate');
    const latestNumbersDisplay = document.getElementById('latestNumbersDisplay');
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
    const UPDATE_BTN_BASE_TEXT = '更新开奖';

    let netLines = null;
    let latestOpenDate = '';
    let latestOpenNumbers = '';
    let currentPeriodSum = 1;
    let currentSourceLines = [];
    let currentSourceExpects = [];
    const matrixState = {
        baseRows: [],
        expandedRows: [],
        rowLabels: [],
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

    // Load saved limit from localStorage and bind instant reload.
    const savedLimit = localStorage.getItem('lottery_load_limit');
    setLoadLimit(savedLimit || getCurrentLoadLimit());
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
                if (netLines) doAnalyze(netLines);
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

            renderPreview(netLines);
            doAnalyze(netLines);
            refreshOpenMatrixData(netLines, currentSourceExpects);
        } catch (err) {
            showError('服务器未响应，请检查后端运行状态');
        }
    }

    function refreshOpenMatrixData(rows, rowLabels = currentSourceExpects) {
        if (!matrixOverlay || !matrixOverlay.classList.contains('show')) return;
        if (!rows || rows.length < 3) return;
        if (!rows.every(line => /^\d{5}$/.test(line))) return;
        matrixState.baseRows = [...rows];
        matrixState.expandedRows = rows.map(expandLineToNine);
        matrixState.rowLabels = Array.isArray(rowLabels) && rowLabels.length === rows.length
            ? [...rowLabels]
            : [];
        rebuildMatrixTableAndHighlights();
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
    if (matrixSizeControl) {
        matrixSizeControl.addEventListener('click', e => {
            const toggleBtn = e.target.closest('.matrix-size-toggle-btn');
            if (toggleBtn) {
                if (isCompactMatrixTopbar()) {
                    setMatrixTopbarToolsVisible(true);
                }
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
        syncMatrixLimitControl();
        syncMatrixSizeControl();
        setMatrixMatchPanelVisible(matrixState.matchPanelVisible);
        setMatrixRowIdsVisible(matrixState.showRowIds);
        if (isCompactMatrixTopbar() && !matrixState.topbarToolsVisible) {
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
    setMatrixSizeOptionsOpen(false);
    setMatrixLimitOptionsOpen(false);
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

    // ── Analyze ──
    async function doAnalyze(linesOverride = null) {
        const activeLines = linesOverride || netLines;
        if (!activeLines || !activeLines.length) return;
        clearError();

        try {
            const textContent = activeLines.join('\n');
            const blob = new Blob([textContent], { type: 'text/plain' });
            const fd = new FormData();
            fd.append('file', blob, 'net_data.txt');
            fd.append('period_sum', currentPeriodSum);
            const res = await fetch('/api/analyze', { method: 'POST', body: fd });

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
            { id: 'dadiError', label: '大底容错分析', render: () => renderDadiError(data.dadiFaultTolerance) },
            { id: 'dadiTransform', label: '大底转换', render: () => renderDadiTransform(data.dadiTransform) },
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
                const dom = tab.render();
                if (dom) contentArea.appendChild(dom);
            });
            tabBar.appendChild(btn);
        });

        statsDisplay.appendChild(tabBar);
        statsDisplay.appendChild(contentArea);
        const defaultDom = tabs[0].render();
        if (defaultDom) contentArea.appendChild(defaultDom);
    }

    function renderGap(results, offsets, periodSum) {
        const wrap = document.createElement('div');
        wrap.className = 'cards-list gap-grid animate-in';
        if (!results) return wrap;

        results.forEach(r => {
            const isTargetPos = r.position >= 1 && r.position <= 3;
            const isLargeGap = r.maxGap > 40;
            const shouldHighlight = isTargetPos && isLargeGap;

            const card = document.createElement('div');
            card.className = `stat-card gap-card ${shouldHighlight ? 'danger-card' : ''}`;

            const badgeHtml = r.candidates.sort((a, b) => a - b).map(d => {
                let html = `<span class="digit-badge ${shouldHighlight ? 'danger-badge' : ''}">${d}</span>`;
                if (periodSum > 1 && offsets && offsets[r.position - 1] !== undefined) {
                    const offset = offsets[r.position - 1];
                    const realDigit = (d - offset + 10) % 10;
                    html += '<span class="digit-arrow">→</span>';
                    html += `<span class="digit-badge offset-badge ${shouldHighlight ? 'danger-badge' : ''}">${realDigit}</span>`;
                }
                return `<div class="digit-pair">${html}</div>`;
            }).join('');

            card.innerHTML = `
                <div class="gap-head">
                    <div class="gap-bg-index ${shouldHighlight ? 'danger-text' : ''}">${r.position}</div>
                    <div class="stat-gap gap-head-gap">遗漏 <strong class="${shouldHighlight ? 'danger-text' : ''}">${r.maxGap}</strong> 期</div>
                </div>
                <div class="stat-digits gap-digits">${badgeHtml}</div>`;
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
                                <span class="result-count-info">大底结果过滤出 000-999 内不考虑顺序的组合: <strong>${results.dadi.length}</strong> 注</span>
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

    function renderDadiError(results) {
        if (!results || !results.counts) return document.createElement('div');
        const counts = results.counts;
        const totalSets = results.total_sets || 0;

        const card = document.createElement('div');
        card.className = 'error-panel animate-in';
        const toleranceOptions = Array.from({ length: 13 }, (_, i) => i)
            .map(v => `<option value="${v}">${v}</option>`)
            .join('');

        const controlHtml = `
            <div class="error-settings">
                <span class="error-settings-title">大底容错条件设置 (分析范围: 1-${totalSets} 期和)</span>
                <div class="error-controls">
                    <div class="error-input-group">
                        <label>容错下限:</label>
                        <select id="errMin" class="error-select">
                            ${toleranceOptions}
                        </select>
                    </div>
                    <div class="error-input-group">
                        <label>容错上限:</label>
                        <select id="errMax" class="error-select">
                            ${toleranceOptions}
                        </select>
                    </div>
                    <button id="applyErrBtn" class="apply-btn">立刻过滤分析</button>
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

        const errMinInput = card.querySelector('#errMin');
        const errMaxInput = card.querySelector('#errMax');
        const applyBtn = card.querySelector('#applyErrBtn');
        const copyBtn = card.querySelector('#copyErrBtn');
        const downloadBtn = card.querySelector('#downloadErrBtn');
        const errCountLabel = card.querySelector('#errCountLabel');
        const errResultArea = card.querySelector('#errResultArea');
        errMinInput.value = '0';
        errMaxInput.value = '2';
        fitToleranceSelectWidth(errMinInput);
        fitToleranceSelectWidth(errMaxInput);

        let currentResults = [];

        function updateResults() {
            let minErr = parseInt(errMinInput.value, 10);
            if (isNaN(minErr)) minErr = 0;
            let maxErr = parseInt(errMaxInput.value, 10);
            if (isNaN(maxErr)) maxErr = 0;

            if (minErr > maxErr) {
                [minErr, maxErr] = [maxErr, minErr];
                errMinInput.value = minErr;
                errMaxInput.value = maxErr;
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

            errCountLabel.textContent = currentResults.length;
            errResultArea.innerHTML = currentResults.map(num => `<div class="grid-num-item">${num}</div>`).join('');
        }

        applyBtn.addEventListener('click', updateResults);
        updateResults();

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

    function renderDadiTransform(results) {
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
            .map(v => `<option value="${v}">${v}</option>`)
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
                        <select id="transformErrMin" class="error-select">
                            ${toleranceOptions}
                        </select>
                    </div>
                    <div class="error-input-group">
                        <label>容错上限:</label>
                        <select id="transformErrMax" class="error-select">
                            ${toleranceOptions}
                        </select>
                    </div>
                    <button id="applyTransformBtn" class="apply-btn">立刻过滤分析</button>
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
        const applyBtn = card.querySelector('#applyTransformBtn');
        const copyBtn = card.querySelector('#copyTransformBtn');
        const downloadBtn = card.querySelector('#downloadTransformBtn');
        const countLabel = card.querySelector('#transformCountLabel');
        const metaLabel = card.querySelector('#transformMeta');
        const resultArea = card.querySelector('#transformResultArea');
        const switchButtons = Array.from(card.querySelectorAll('.dadi-transform-base-btn'));
        fitToleranceSelectWidth(minInput);
        fitToleranceSelectWidth(maxInput);

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
            let minErr = Number.parseInt(minInput.value, 10);
            if (Number.isNaN(minErr)) minErr = currentTolerance.minErr;
            let maxErr = Number.parseInt(maxInput.value, 10);
            if (Number.isNaN(maxErr)) maxErr = currentTolerance.maxErr;

            if (minErr > maxErr) {
                [minErr, maxErr] = [maxErr, minErr];
            }
            minInput.value = String(minErr);
            maxInput.value = String(maxErr);
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
            currentResults = nextResults;

            countLabel.innerHTML = `${title} 符合条件的大底号码: <strong>${currentResults.length}</strong> 注`;
            metaLabel.innerHTML = `原始大底 <strong>${sourceCount}</strong> 注；转换大底 <strong>${totalSets}</strong> 组；容错范围 <strong>[${minErr}, ${maxErr}]</strong>`;
            resultArea.innerHTML = currentResults.length
                ? currentResults.map(num => `<div class="grid-num-item">${num}</div>`).join('')
                : '<p class="empty-hint">当前容错范围无结果</p>';
        }

        switchButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const slot = btn.dataset.slot;
                if (!slot) return;
                setActiveSlot(slot);
                const currentTolerance = toleranceBySlot.get(activeSlot) || { minErr: 0, maxErr: 2 };
                minInput.value = String(currentTolerance.minErr);
                maxInput.value = String(currentTolerance.maxErr);
                updateTransformResults();
            });
        });

        applyBtn.addEventListener('click', updateTransformResults);

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
        minInput.value = '0';
        maxInput.value = '2';
        updateTransformResults();

        wrap.appendChild(card);
        return wrap;
    }

    function fitToleranceSelectWidth(selectEl) {
        if (!selectEl || !selectEl.options || !selectEl.options.length) return;
        let maxLen = 1;
        for (const opt of selectEl.options) {
            maxLen = Math.max(maxLen, String(opt.text || '').trim().length);
        }
        const widthPx = Math.max(92, Math.round(maxLen * 14 + 54));
        selectEl.style.width = `${widthPx}px`;
    }

    function normalizeSourceRows() {
        const rows = (currentSourceLines || [])
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
            (matrixSizeControl && matrixSizeControl.classList.contains('open')) ||
            (matrixLimitControl && matrixLimitControl.classList.contains('open'));
        matrixTopbarActions.classList.toggle('menu-open', Boolean(hasOpenMenu));
        if (matrixTopbarTools) {
            matrixTopbarTools.classList.toggle('menu-open', Boolean(hasOpenMenu));
        }
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

        matrixState.baseRows = rows;
        matrixState.expandedRows = rows.map(expandLineToNine);
        matrixState.rowLabels = currentSourceExpects.length === rows.length ? [...currentSourceExpects] : [];
        matrixState.selectedPositions = new Set([1]);
        matrixState.selectedComboGroupsByPos = new Map([[1, new Set([1, 2, 3])]]);
        matrixState.selectedTraceGroupsByPos = new Map([[1, new Set()]]);
        matrixState.matchesByPos = new Map();
        matrixState.searchQuery = '';
        matrixState.searchHitKeys = new Set();
        if (matrixSearchInput) matrixSearchInput.value = '';
        setMatrixSizeOptionsOpen(false);
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

});
