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

    return {
        applyPeriodSumOffset,
        buildDadiErrorCandidate,
        buildDadiErrorCandidates,
        computeDadiErrorNumbers,
        getDadiErrorPeriodLabel,
        normalizeToleranceRange,
    };
}));
