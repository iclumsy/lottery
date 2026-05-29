(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DadiErrorUtils = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function normalizeToleranceRange(minErr, maxErr) {
        let normalizedMin = parseInt(minErr, 10);
        let normalizedMax = parseInt(maxErr, 10);

        if (!Number.isFinite(normalizedMin)) normalizedMin = 0;
        if (!Number.isFinite(normalizedMax)) normalizedMax = 0;

        if (normalizedMin > normalizedMax) {
            [normalizedMin, normalizedMax] = [normalizedMax, normalizedMin];
        }

        return {
            minErr: normalizedMin,
            maxErr: normalizedMax,
        };
    }

    async function readJsonResponse(response, fallbackMessage = '请求失败') {
        const contentType = response && response.headers
            ? (response.headers.get('content-type') || '')
            : '';

        if (!contentType.toLowerCase().includes('application/json')) {
            const statusText = response && response.status ? `HTTP ${response.status}` : '未知状态';
            throw new Error(`${fallbackMessage}：服务器返回了非 JSON 响应 (${statusText})`);
        }

        let data;
        try {
            data = await response.json();
        } catch (err) {
            throw new Error(`${fallbackMessage}：服务器返回的 JSON 无法解析`);
        }

        if (!response.ok) {
            throw new Error((data && data.error) || fallbackMessage);
        }

        return data;
    }

    function applyPeriodSumOffset(code, offsets) {
        if (!offsets) return code;
        return code.split('').map((ch, i) => {
            const digit = parseInt(ch, 10);
            const offset = offsets[i] || 0;
            return (digit - offset + 10) % 10;
        }).join('');
    }

    function computeDadiErrorNumbers(faultTolerance, minErr, maxErr, periodSumOffset) {
        if (!faultTolerance || !faultTolerance.counts) return [];

        const counts = faultTolerance.counts;
        const totalSets = faultTolerance.total_sets || 0;
        const minCount = Math.max(0, totalSets - maxErr);
        const maxCount = totalSets - minErr;
        const numbers = [];

        for (let i = 0; i < 1000; i++) {
            const code = i.toString().padStart(3, '0');
            const count = counts[code] || 0;
            if (count >= minCount && count <= maxCount) {
                numbers.push(code);
            }
        }

        if (!periodSumOffset) return numbers;

        return [...new Set(numbers.map(code => applyPeriodSumOffset(code, periodSumOffset)))].sort();
    }

    function computeDadiTransformNumbers(base, minErr, maxErr, periodSumOffset) {
        if (!base || !base.sourceCount || !base.totalSets || !base.counts) return [];

        const counts = base.counts || {};
        const totalSets = Number.isFinite(base.totalSets) ? base.totalSets : 0;
        const minCount = Math.max(0, totalSets - maxErr);
        const maxCount = totalSets - minErr;
        const numbers = [];

        for (let i = 0; i < 1000; i++) {
            const code = i.toString().padStart(3, '0');
            const hit = counts[code] || 0;
            if (hit >= minCount && hit <= maxCount) {
                numbers.push(code);
            }
        }

        if (!periodSumOffset) return numbers;

        return [...new Set(numbers.map(code => applyPeriodSumOffset(code, periodSumOffset)))].sort();
    }

    function getDadiErrorPeriodLabel(period) {
        return period === 1 ? '1期' : `${period}期和`;
    }

    function buildDadiErrorCandidate({
        period,
        minErr,
        maxErr,
        faultTolerance,
        periodSumOffset = null,
    }) {
        const range = normalizeToleranceRange(minErr, maxErr);
        const numbers = computeDadiErrorNumbers(
            faultTolerance,
            range.minErr,
            range.maxErr,
            periodSumOffset
        );
        const periodLabel = getDadiErrorPeriodLabel(period);

        return {
            sourceKey: `dadi-err:${period}:${range.minErr}:${range.maxErr}`,
            label: `容错分析 (${periodLabel}) [${range.minErr},${range.maxErr}]`,
            numbers,
        };
    }

    function buildDadiErrorCandidates(periodResults, minErr, maxErr) {
        if (!Array.isArray(periodResults)) return [];

        return periodResults.map(item => buildDadiErrorCandidate({
            period: item.period,
            minErr,
            maxErr,
            faultTolerance: item.faultTolerance,
            periodSumOffset: item.periodSumOffset || null,
        }));
    }

    function buildDadiTransformCandidate({
        period,
        minErr,
        maxErr,
        base,
        periodSumOffset = null,
    }) {
        const range = normalizeToleranceRange(minErr, maxErr);
        const numbers = computeDadiTransformNumbers(
            base,
            range.minErr,
            range.maxErr,
            periodSumOffset
        );
        const slot = base && base.slot;
        const baseName = base && base.name ? base.name : `大底${slot}`;
        const periodLabel = getDadiErrorPeriodLabel(period);

        return {
            sourceKey: `dadi-transform:${slot}:${period}:${range.minErr}:${range.maxErr}`,
            label: `大底转换 ${baseName} (${periodLabel}) [${range.minErr},${range.maxErr}]`,
            numbers,
        };
    }

    function buildDadiTransformCandidates(periodResults, minErr, maxErr) {
        if (!Array.isArray(periodResults)) return [];

        return periodResults.map(item => buildDadiTransformCandidate({
            period: item.period,
            minErr,
            maxErr,
            base: item.base,
            periodSumOffset: item.periodSumOffset || null,
        }));
    }

    return {
        applyPeriodSumOffset,
        buildDadiErrorCandidate,
        buildDadiErrorCandidates,
        buildDadiTransformCandidate,
        buildDadiTransformCandidates,
        computeDadiErrorNumbers,
        computeDadiTransformNumbers,
        getDadiErrorPeriodLabel,
        normalizeToleranceRange,
        readJsonResponse,
    };
}));
