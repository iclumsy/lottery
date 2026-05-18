const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildDadiErrorCandidate,
    buildDadiErrorCandidates,
    normalizeToleranceRange,
} = require('../static/dadi_error_utils.js');

test('normalizes inverted tolerance ranges', () => {
    assert.deepEqual(normalizeToleranceRange(4, 1), { minErr: 1, maxErr: 4 });
});

test('builds one period candidate using the shared tolerance range', () => {
    const candidate = buildDadiErrorCandidate({
        period: 3,
        minErr: 0,
        maxErr: 1,
        faultTolerance: {
            total_sets: 4,
            counts: {
                '001': 4,
                '002': 3,
                '003': 2,
            },
        },
        periodSumOffset: [1, 2, 3],
    });

    assert.equal(candidate.sourceKey, 'dadi-err:3:0:1');
    assert.equal(candidate.label, '容错分析 (3期和) [0,1]');
    assert.deepEqual(candidate.numbers, ['988', '989']);
});

test('builds period one label without 期和 suffix', () => {
    const candidate = buildDadiErrorCandidate({
        period: 1,
        minErr: 2,
        maxErr: 2,
        faultTolerance: {
            total_sets: 4,
            counts: {
                '123': 2,
                '456': 1,
            },
        },
    });

    assert.equal(candidate.sourceKey, 'dadi-err:1:2:2');
    assert.equal(candidate.label, '容错分析 (1期) [2,2]');
    assert.deepEqual(candidate.numbers, ['123']);
});

test('builds a candidate for every fetched period with the same tolerance range', () => {
    const candidates = buildDadiErrorCandidates([
        {
            period: 1,
            faultTolerance: {
                total_sets: 2,
                counts: { '111': 2 },
            },
        },
        {
            period: 20,
            faultTolerance: {
                total_sets: 2,
                counts: { '222': 1 },
            },
        },
    ], 0, 1);

    assert.deepEqual(candidates.map(candidate => candidate.sourceKey), [
        'dadi-err:1:0:1',
        'dadi-err:20:0:1',
    ]);
    assert.deepEqual(candidates.map(candidate => candidate.label), [
        '容错分析 (1期) [0,1]',
        '容错分析 (20期和) [0,1]',
    ]);
});
