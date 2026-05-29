const assert = require('node:assert/strict');
const test = require('node:test');

const {
    computeCandidateIntersection,
    getIntersectionToleranceValues,
    getCandidatePanelCollapsed,
} = require('../static/candidate_panel_utils.js');

test('expands candidate panel while pointer is hovering', () => {
    assert.equal(getCandidatePanelCollapsed({ isHovering: true }), false);
});

test('collapses candidate panel when pointer leaves', () => {
    assert.equal(getCandidatePanelCollapsed({ isHovering: false }), true);
});

test('builds intersection tolerance values through the full candidate count', () => {
    assert.deepEqual(getIntersectionToleranceValues(20), [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
        11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
});

test('candidate intersection can include numbers missing from every candidate at full tolerance', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({
        numbers: [String(index).padStart(3, '0')],
    }));

    const results = computeCandidateIntersection(candidates, 20, 20);

    assert.equal(results.includes('999'), true);
    assert.equal(results.includes('000'), false);
});
