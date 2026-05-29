const assert = require('node:assert/strict');
const test = require('node:test');

const {
    readJsonResponse,
} = require('../static/dadi_error_utils.js');

test('readJsonResponse reports html responses without throwing a JSON syntax error', async () => {
    const response = new Response('<!doctype html><h1>Server Error</h1>', {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

    await assert.rejects(
        () => readJsonResponse(response, '5期和分析失败'),
        {
            message: '5期和分析失败：服务器返回了非 JSON 响应 (HTTP 500)',
        }
    );
});

test('readJsonResponse uses api error messages from json responses', async () => {
    const response = Response.json({ error: '至少需要 21 行数据' }, { status: 400 });

    await assert.rejects(
        () => readJsonResponse(response, '20期和分析失败'),
        {
            message: '至少需要 21 行数据',
        }
    );
});
