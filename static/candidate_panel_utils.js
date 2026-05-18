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

    return {
        getCandidatePanelCollapsed,
    };
}));
