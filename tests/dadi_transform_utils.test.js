const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildDadiTransformCandidate,
    buildDadiTransformCandidates,
} = require('../static/dadi_error_utils.js');

test('builds a Dadi transform candidate for the selected base and period', () => {
    const candidate = buildDadiTransformCandidate({
        period: 2,
        minErr: 0,
        maxErr: 1,
        base: {
            slot: 3,
            name: '无全质大底',
            sourceCount: 2,
            totalSets: 3,
            counts: {
                '001': 3,
                '002': 2,
                '003': 1,
            },
        },
        periodSumOffset: [1, 2, 3],
    });

    assert.equal(candidate.sourceKey, 'dadi-transform:3:2:0:1');
    assert.equal(candidate.label, '大底转换 无全质大底 (2期和) [0,1]');
    assert.deepEqual(candidate.numbers, ['988', '989']);
});

test('builds Dadi transform candidates for every fetched period', () => {
    const candidates = buildDadiTransformCandidates([
        {
            period: 1,
            base: {
                slot: 4,
                name: '组六大底',
                sourceCount: 1,
                totalSets: 2,
                counts: { '111': 2 },
            },
        },
        {
            period: 20,
            base: {
                slot: 4,
                name: '组六大底',
                sourceCount: 1,
                totalSets: 2,
                counts: { '222': 1 },
            },
        },
    ], 0, 1);

    assert.deepEqual(candidates.map(candidate => candidate.sourceKey), [
        'dadi-transform:4:1:0:1',
        'dadi-transform:4:20:0:1',
    ]);
    assert.deepEqual(candidates.map(candidate => candidate.label), [
        '大底转换 组六大底 (1期) [0,1]',
        '大底转换 组六大底 (20期和) [0,1]',
    ]);
});
