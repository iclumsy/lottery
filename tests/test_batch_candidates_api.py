import os
import sqlite3
import tempfile
import unittest

import app as app_module


def build_lines(total=40):
    lines = []
    for i in range(total):
        lines.append(''.join(str((i + pos * 3) % 10) for pos in range(5)))
    return lines


class BatchCandidatesApiTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.old_db_path = app_module.DB_PATH
        app_module.DB_PATH = os.path.join(self.tmpdir.name, 'lottery-test.db')
        self._create_test_db()
        app_module.app.config['TESTING'] = True
        self.client = app_module.app.test_client()

    def tearDown(self):
        app_module.DB_PATH = self.old_db_path
        self.tmpdir.cleanup()

    def _create_test_db(self):
        conn = sqlite3.connect(app_module.DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            '''
            CREATE TABLE dadi_base_sets (
                slot INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                numbers_text TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )
        cursor.execute(
            '''
            CREATE TABLE access_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT,
                path TEXT,
                method TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )
        for slot in range(1, 5):
            name = '测试大底' if slot == 2 else f'大底{slot}'
            numbers = '001\n123\n456\n789' if slot == 2 else ''
            cursor.execute(
                'INSERT INTO dadi_base_sets (slot, name, numbers_text) VALUES (?, ?, ?)',
                (slot, name, numbers)
            )
        conn.commit()
        conn.close()

    def test_builds_20_dadi_error_candidates_in_one_request(self):
        response = self.client.post('/api/batch_candidates', json={
            'mode': 'dadi_error',
            'lines': build_lines(),
            'minErr': 0,
            'maxErr': 2,
        })

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(len(payload['candidates']), 20)
        self.assertEqual(payload['candidates'][0]['sourceKey'], 'dadi-err:1:0:2')
        self.assertEqual(payload['candidates'][0]['label'], '容错分析 (1期) [0,2]')
        self.assertEqual(payload['candidates'][-1]['sourceKey'], 'dadi-err:20:0:2')
        self.assertEqual(payload['candidates'][-1]['label'], '容错分析 (20期和) [0,2]')
        self.assertTrue(all(isinstance(item['numbers'], list) for item in payload['candidates']))

    def test_builds_20_dadi_transform_candidates_for_selected_slot(self):
        response = self.client.post('/api/batch_candidates', json={
            'mode': 'dadi_transform',
            'lines': build_lines(),
            'slot': 2,
            'minErr': 0,
            'maxErr': 20,
        })

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(len(payload['candidates']), 20)
        self.assertEqual(payload['candidates'][0]['sourceKey'], 'dadi-transform:2:1:0:20')
        self.assertEqual(payload['candidates'][0]['label'], '大底转换 测试大底 (1期) [0,20]')
        self.assertEqual(payload['candidates'][-1]['sourceKey'], 'dadi-transform:2:20:0:20')
        self.assertEqual(payload['candidates'][-1]['label'], '大底转换 测试大底 (20期和) [0,20]')
        self.assertGreater(len(payload['candidates'][-1]['numbers']), 0)


if __name__ == '__main__':
    unittest.main()
