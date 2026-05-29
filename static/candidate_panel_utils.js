(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.CandidatePanelUtils = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function getCandidatePanelCollapsed({ isHovering }) {
        return !isHovering;
    }

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

    function getIntersectionToleranceValues(total) {
        const count = Math.max(0, parseInt(total, 10) || 0);
        return Array.from({ length: count + 1 }, (_, i) => i);
    }

    function computeCandidateIntersection(candidatePool, minErr, maxErr) {
        if (!Array.isArray(candidatePool) || candidatePool.length === 0) return [];

        const totalSets = candidatePool.length;
        const range = normalizeToleranceRange(minErr, maxErr);
        const minCount = Math.max(0, totalSets - range.maxErr);
        const maxCount = totalSets - range.minErr;
        const counts = new Map();

        candidatePool.forEach(candidate => {
            const seen = new Set(candidate && Array.isArray(candidate.numbers) ? candidate.numbers : []);
            seen.forEach(num => {
                counts.set(num, (counts.get(num) || 0) + 1);
            });
        });

        const results = [];
        for (let i = 0; i < 1000; i++) {
            const code = i.toString().padStart(3, '0');
            const count = counts.get(code) || 0;
            if (count >= minCount && count <= maxCount) {
                results.push(code);
            }
        }

        return results;
    }

    return {
        computeCandidateIntersection,
        getIntersectionToleranceValues,
        getCandidatePanelCollapsed,
        normalizeToleranceRange,
    };
}));
