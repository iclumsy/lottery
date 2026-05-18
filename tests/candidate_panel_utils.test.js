const assert = require('node:assert/strict');
const test = require('node:test');

const {
    getCandidatePanelCollapsed,
} = require('../static/candidate_panel_utils.js');

test('expands candidate panel while pointer is hovering', () => {
    assert.equal(getCandidatePanelCollapsed({ isHovering: true }), false);
});

test('collapses candidate panel when pointer leaves', () => {
    assert.equal(getCandidatePanelCollapsed({ isHovering: false }), true);
});
