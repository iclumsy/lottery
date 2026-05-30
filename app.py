from flask import Flask, render_template, request, jsonify, abort, make_response

import urllib.request
from xml.etree import ElementTree
import sqlite3
import re
import ipaddress
from functools import lru_cache
from werkzeug.middleware.proxy_fix import ProxyFix
import os
import json
import threading
import time
import hmac
import hashlib
from datetime import datetime
from urllib.parse import urlencode, quote


def load_env_file(path='.env'):
    if not os.path.exists(path):
        return

    try:
        with open(path, 'r', encoding='utf-8') as env_file:
            for raw_line in env_file:
                line = raw_line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip()
                if not key:
                    continue
                if value[:1] == value[-1:] and value[:1] in {'"', "'"}:
                    value = value[1:-1]
                os.environ.setdefault(key, value)
    except OSError as exc:
        print(f'Failed to load .env: {exc}')


load_env_file()

app = Flask(__name__)
# 信任一层反向代理转发的 header (用于获取客户端真实 IP)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

DB_PATH = 'lottery.db'

# ========================================
# 企业微信消息推送配置
# 从 .env 或系统环境变量读取；未配置时保持为空
# ========================================
WX_CORPID = os.environ.get('WX_CORPID', '')
WX_CORPSECRET = os.environ.get('WX_CORPSECRET', '')
WX_AGENTID = os.environ.get('WX_AGENTID', '')
WX_TOUSER = os.environ.get('WX_TOUSER', '')
PUBLIC_BASE_URL = os.environ.get('PUBLIC_BASE_URL', 'http://cwh868.ctirad.fun').strip().rstrip('/')
ACCESS_LOG_SECRET = os.environ.get('ACCESS_LOG_SECRET', '').strip()
ACCESS_LOG_ROUTE_PATH = '/access-logs'

def get_env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

PUSH_INTERVAL_MINUTES = get_env_int('PUSH_INTERVAL_MINUTES', 5)
ACCESS_LOG_URL_TTL_MINUTES = max(5, get_env_int('ACCESS_LOG_URL_TTL_MINUTES', 720))
ACCESS_LOG_PAGE_LIMIT = max(20, min(1000, get_env_int('ACCESS_LOG_PAGE_LIMIT', 500)))
IP_LOCATION_CACHE_TTL_HOURS = 24 * 30
IP_LOCATION_UNKNOWN_CACHE_TTL_HOURS = 6
IP_LOOKUP_TIMEOUT_SECONDS = 1.8
COUNTRY_CODE_ZH_MAP = {
    'CN': '中国',
    'HK': '中国香港',
    'MO': '中国澳门',
    'TW': '中国台湾',
    'US': '美国',
    'JP': '日本',
    'KR': '韩国',
    'SG': '新加坡',
    'MY': '马来西亚',
    'TH': '泰国',
    'VN': '越南',
    'PH': '菲律宾',
    'ID': '印度尼西亚',
    'IN': '印度',
    'GB': '英国',
    'DE': '德国',
    'FR': '法国',
    'CA': '加拿大',
    'AU': '澳大利亚',
    'NZ': '新西兰',
    'RU': '俄罗斯',
}
# ========================================

def build_access_logs_signature(expire_at):
    payload = f'{ACCESS_LOG_ROUTE_PATH}|{expire_at}'
    return hmac.new(
        ACCESS_LOG_SECRET.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

def build_access_logs_url():
    if not PUBLIC_BASE_URL or not ACCESS_LOG_SECRET:
        return PUBLIC_BASE_URL or ''

    expire_at = int(time.time()) + (ACCESS_LOG_URL_TTL_MINUTES * 60)
    query = urlencode({
        'exp': expire_at,
        'sig': build_access_logs_signature(expire_at),
    })
    return f'{PUBLIC_BASE_URL}{ACCESS_LOG_ROUTE_PATH}?{query}'

def is_valid_access_logs_request(expire_at_raw, signature):
    if not ACCESS_LOG_SECRET:
        return False
    if not expire_at_raw or not signature:
        return False
    if not re.fullmatch(r'\d{10,}', str(expire_at_raw)):
        return False

    expire_at = int(expire_at_raw)
    now = int(time.time())
    if expire_at < now:
        return False
    if expire_at > now + (ACCESS_LOG_URL_TTL_MINUTES * 60) + 86400:
        return False

    expected = build_access_logs_signature(expire_at)
    return hmac.compare_digest(str(signature), expected)

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS lottery_history (
            expect TEXT PRIMARY KEY,
            opencode TEXT NOT NULL,
            opentime TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS dadi_base_sets (
            slot INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            numbers_text TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    for slot in range(1, 5):
        cursor.execute(
            'INSERT OR IGNORE INTO dadi_base_sets (slot, name, numbers_text) VALUES (?, ?, ?)',
            (slot, f'大底{slot}', '')
        )
    
    # 访问日志表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS access_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT,
            path TEXT,
            method TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ip_location_cache (
            ip TEXT PRIMARY KEY,
            location TEXT NOT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    
    # Auto fetch if empty
    cursor.execute('SELECT COUNT(*) as count FROM lottery_history')
    row = cursor.fetchone()
    if row and row['count'] == 0:
        print("Database is empty, fetching initial data...")
        try:
            url = 'https://kaijiang.500.com/static/info/kaijiang/xml/plw/list.xml'
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                xml_data = response.read().decode('utf-8')
            
            root = ElementTree.fromstring(xml_data)
            for xml_row in root.findall('row'):
                expect = xml_row.get('expect')
                opencode = xml_row.get('opencode')
                opentime = xml_row.get('opentime', '')
                if expect and opencode:
                    digits = opencode.replace(',', '').strip()
                    if len(digits) == 5:
                        cursor.execute(
                            'INSERT OR IGNORE INTO lottery_history (expect, opencode, opentime) VALUES (?, ?, ?)',
                            (expect, digits, opentime)
                        )
            conn.commit()
            print("Initial data fetched successfully.")
        except Exception as e:
            print(f"Failed to fetch initial data: {e}")
            
    conn.close()

# Initialize DB on startup
init_db()

def should_skip_access_log(path):
    return (
        path.startswith('/static/')
        or path == '/favicon.ico'
        or path == ACCESS_LOG_ROUTE_PATH
    )

@app.before_request
def log_request_info():
    if should_skip_access_log(request.path):
        return
    
    ip = get_client_ip()
    path = request.path
    method = request.method
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('INSERT INTO access_log (ip, path, method) VALUES (?, ?, ?)', (ip, path, method))
    conn.commit()
    conn.close()

def send_wechat_message(content):
    if WX_CORPID.startswith('你的') or not WX_CORPID:
        return
    
    try:
        title, description = content
        message_url = build_access_logs_url() or (PUBLIC_BASE_URL or 'http://127.0.0.1:5002/')
        # 获取 access_token
        token_url = f"https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid={WX_CORPID}&corpsecret={WX_CORPSECRET}"
        req = urllib.request.Request(token_url)
        with urllib.request.urlopen(req, timeout=10) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            if res_data.get('errcode') != 0:
                print("获取微信token失败:", res_data)
                return
            token = res_data.get('access_token')
            
        # 发送消息
        send_url = f"https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={token}"
        msg_data = {
            "touser": WX_TOUSER,
            "msgtype": "textcard",
            "agentid": int(WX_AGENTID),
            "textcard": {
                "title": title,
                "description": description,
                "url": message_url,
                "btntxt": "详情"
            }
        }
        
        req = urllib.request.Request(send_url, data=json.dumps(msg_data).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as response:
            send_res = json.loads(response.read().decode('utf-8'))
            if send_res.get('errcode') != 0:
                print("发送微信消息失败:", send_res)
    except Exception as e:
        print("微信推送出现异常:", e)

def normalize_ip(raw_ip):
    candidate = str(raw_ip or '').strip()
    if not candidate:
        return ''

    if ',' in candidate:
        candidate = candidate.split(',', 1)[0].strip()

    if candidate.startswith('[') and candidate.endswith(']'):
        candidate = candidate[1:-1].strip()

    if candidate.count(':') == 1 and '.' in candidate:
        host, port = candidate.rsplit(':', 1)
        if port.isdigit():
            candidate = host.strip()

    try:
        ip_obj = ipaddress.ip_address(candidate)
        if isinstance(ip_obj, ipaddress.IPv6Address) and ip_obj.ipv4_mapped:
            ip_obj = ip_obj.ipv4_mapped
        return ip_obj.compressed
    except ValueError:
        return ''

def get_client_ip():
    return normalize_ip(request.remote_addr) or ''

def get_local_ip_label(ip_obj):
    if ip_obj.is_loopback:
        return '本机/回环'
    if ip_obj.is_private:
        return '内网地址'
    if ip_obj.is_link_local:
        return '链路本地'
    if ip_obj.is_reserved:
        return '保留地址'
    if ip_obj.is_multicast:
        return '组播地址'
    if ip_obj.is_unspecified:
        return '未指定地址'
    return ''

def format_location_parts(*parts):
    normalized_parts = []
    for raw_part in parts:
        part = str(raw_part or '').strip()
        if not part:
            continue
        if normalized_parts and normalized_parts[-1] == part:
            continue
        normalized_parts.append(part)
    return ' '.join(normalized_parts)

def contains_cjk(text):
    return bool(re.search(r'[\u3400-\u9fff]', str(text or '')))

def normalize_country_name(country, country_code=''):
    country_text = str(country or '').strip()
    country_code = str(country_code or '').strip().upper()
    if contains_cjk(country_text):
        return country_text
    return COUNTRY_CODE_ZH_MAP.get(country_code, '')

def finalize_location(country='', region='', city='', country_code=''):
    country_text = normalize_country_name(country, country_code)
    region_text = str(region or '').strip()
    city_text = str(city or '').strip()

    if not contains_cjk(region_text):
        region_text = ''
    if not contains_cjk(city_text):
        city_text = ''

    location = format_location_parts(country_text, region_text, city_text)
    if location:
        return location
    if country_text:
        return country_text
    return '海外地址'

def load_cached_ip_location(ip):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'SELECT location, updated_at FROM ip_location_cache WHERE ip = ?',
        (ip,)
    )
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None

    try:
        updated_at = datetime.strptime(row['updated_at'], '%Y-%m-%d %H:%M:%S')
    except (TypeError, ValueError):
        return None

    ttl_hours = IP_LOCATION_UNKNOWN_CACHE_TTL_HOURS if row['location'] == '未知' else IP_LOCATION_CACHE_TTL_HOURS
    age_seconds = (datetime.utcnow() - updated_at).total_seconds()
    if age_seconds <= ttl_hours * 3600:
        location = str(row['location'] or '').strip()
        if location and (contains_cjk(location) or location == '未知'):
            return location
    return None

def save_cached_ip_location(ip, location):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        '''
        INSERT INTO ip_location_cache (ip, location, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(ip) DO UPDATE SET
            location = excluded.location,
            updated_at = excluded.updated_at
        ''',
        (ip, location)
    )
    conn.commit()
    conn.close()

def lookup_ip_location(ip):
    providers = (
        (
            f'http://ip-api.com/json/{quote(ip)}?lang=zh-CN',
            lambda data: data.get('status') == 'success',
            lambda data: finalize_location(
                data.get('country'),
                data.get('regionName'),
                data.get('city'),
                data.get('countryCode')
            )
        ),
        (
            f'https://ipwho.is/{quote(ip)}?lang=zh',
            lambda data: data.get('success') is True,
            lambda data: finalize_location(
                data.get('country'),
                data.get('region'),
                data.get('city'),
                data.get('country_code')
            )
        ),
    )

    for url, is_success, build_location in providers:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=IP_LOOKUP_TIMEOUT_SECONDS) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            if is_success(data):
                location = build_location(data)
                if location:
                    return location
        except Exception:
            continue
    return '未知'

def get_ip_location(ip):
    normalized_ip = normalize_ip(ip)
    if not normalized_ip:
        return '未知'

    try:
        ip_obj = ipaddress.ip_address(normalized_ip)
    except ValueError:
        return '未知'

    local_label = get_local_ip_label(ip_obj)
    if local_label:
        return local_label

    cached_location = load_cached_ip_location(normalized_ip)
    if cached_location:
        return cached_location

    location = lookup_ip_location(normalized_ip)
    save_cached_ip_location(normalized_ip, location)
    return location

def wechat_push_worker():
    while True:
        interval = PUSH_INTERVAL_MINUTES
        if interval < 1:
            interval = 1
        time.sleep(interval * 60)
        
        # 检查是否配置了企业微信信息
        if WX_CORPID.startswith('你的') or not WX_CORPID:
            continue
            
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            # 获取最近 interval 分钟内的访问记录
            cursor.execute(
                f'''
                SELECT ip, path, method, datetime(created_at, 'localtime') as local_time
                FROM access_log
                WHERE created_at >= datetime('now', '-{interval} minute')
                  AND path != ?
                ORDER BY created_at DESC
                ''',
                (ACCESS_LOG_ROUTE_PATH,)
            )
            rows = cursor.fetchall()
            
            if rows:
                title = f"【cwh868】新访问记录 (共 {len(rows)} 条)"
                description = f"<div class=\"gray\">最近 {interval} 分钟内的访问：</div>"
                ip_locations = {}
                for row in rows[:20]:
                    # 截取路径，并仅显示时间部分(HH:MM:SS)
                    time_str = str(row['local_time']).split(' ')[1] if ' ' in str(row['local_time']) else row['local_time']
                    path_str = row['path'] if len(row['path']) < 40 else row['path'][:37] + '...'
                    ip_addr = row['ip']
                    if ip_addr not in ip_locations:
                        ip_locations[ip_addr] = get_ip_location(ip_addr)
                    ip_loc = ip_locations[ip_addr]
                    description += f"<div class=\"normal\">{time_str} {ip_addr}({ip_loc}) {row['method']} {path_str}</div>"
                
                if len(rows) > 20:
                    description += "<div class=\"highlight\">...... 省略剩余记录</div>"
                    
                send_wechat_message((title, description))
                
            # 清理 7 天前的过期访问日志，避免数据库过大
            cursor.execute("DELETE FROM access_log WHERE created_at < datetime('now', '-7 days')")
            conn.commit()
            conn.close()
        except Exception as e:
            print("微信推送后台任务异常:", e)

# 启动后台推送线程（已关闭）
# push_thread = threading.Thread(target=wechat_push_worker, daemon=True)
# push_thread.start()

def normalize_dadi_numbers(raw_input):
    if raw_input is None:
        return [], []

    tokens = []
    if isinstance(raw_input, list):
        for item in raw_input:
            parts = re.split(r'[\s,，;；]+', str(item or '').strip())
            tokens.extend(parts)
    else:
        tokens = re.split(r'[\s,，;；]+', str(raw_input).strip())

    numbers = []
    invalid = []
    seen = set()
    for token in tokens:
        token = token.strip()
        if not token:
            continue
        if re.fullmatch(r'\d{3}', token):
            if token not in seen:
                seen.add(token)
                numbers.append(token)
        else:
            invalid.append(token)
    return numbers, invalid

def load_dadi_base_sets():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT slot, name, numbers_text FROM dadi_base_sets ORDER BY slot')
    rows = cursor.fetchall()

    existing_slots = {int(row['slot']) for row in rows}
    if len(existing_slots) < 4:
        for slot in range(1, 5):
            if slot not in existing_slots:
                cursor.execute(
                    'INSERT OR IGNORE INTO dadi_base_sets (slot, name, numbers_text) VALUES (?, ?, ?)',
                    (slot, f'大底{slot}', '')
                )
        conn.commit()
        cursor.execute('SELECT slot, name, numbers_text FROM dadi_base_sets ORDER BY slot')
        rows = cursor.fetchall()

    base_sets = []
    for row in rows:
        numbers, _ = normalize_dadi_numbers(row['numbers_text'] or '')
        slot = int(row['slot'])
        base_sets.append({
            'slot': slot,
            'name': row['name'] or f'大底{slot}',
            'numbers': numbers
        })
    conn.close()
    return base_sets

def compute_dadi_transform(raw_parsed, digit_len, base_sets):
    """大底转换：原始基底不变，19 组偏移基于当前维度数据，计数在当前空间完成"""
    total_lines = len(raw_parsed)
    transform_bases = []

    for base in base_sets:
        numbers = base['numbers']
        counts = {}
        offsets = []
        total_sets = 0

        if digit_len >= 3 and numbers:
            # Set 1: 原始基底不变
            original_set = set(numbers)
            offsets.append({'period': 0, 'offset': [0, 0, 0], 'is_original': True})
            total_sets += 1
            for code in original_set:
                counts[code] = counts.get(code, 0) + 1

            # Set 2..20: 19 组偏移基于当前维度数据
            for k in range(1, 20):
                if total_lines < k:
                    break
                window = raw_parsed[total_lines - k:total_lines]
                offset = [sum(row[pos] for row in window) % 10 for pos in range(3)]
                offsets.append({'period': k, 'offset': offset, 'is_original': False})

                transformed_set = set()
                for num in numbers:
                    conv = ''.join(str((int(num[pos]) - offset[pos]) % 10) for pos in range(3))
                    transformed_set.add(conv)

                total_sets += 1
                for conv in transformed_set:
                    counts[conv] = counts.get(conv, 0) + 1

        transform_bases.append({
            'slot': base['slot'],
            'name': base['name'],
            'sourceCount': len(numbers),
            'totalSets': total_sets,
            'counts': counts,
            'offsets': offsets
        })

    return {'bases': transform_bases}

@lru_cache(maxsize=128)
def compute_dadi(k_period, n_lines, raw_parsed_tuple, L):
    if n_lines < k_period + 1:
        return None
        
    parsed_k = []
    for i in range(n_lines - k_period + 1):
        window = raw_parsed_tuple[i:i + k_period]
        summed_row = []
        for pos in range(L):
            summed_row.append(sum(row[pos] for row in window) % 10)
        parsed_k.append(summed_row)
        
    if len(parsed_k) < 3:
        return None
        
    def extract_top3_unique(digits_row):
        seen = set()
        res = []
        for d in digits_row[:3]:
            if d not in seen:
                seen.add(d)
                res.append(d)
        return tuple(res)
        
    group1 = extract_top3_unique(parsed_k[-1])
    group2 = extract_top3_unique(parsed_k[-2])
    group3 = extract_top3_unique(parsed_k[-3])
    
    all_app = set(group1 + group2 + group3)
    group4 = tuple(d for d in range(10) if d not in all_app)
    
    group5 = set()
    pool_234 = set(group2 + group3 + group4)
    for x in group1:
        for y in pool_234: group5.add(tuple(sorted((x, y))))
    pool_34 = set(group3 + group4)
    for x in group2:
        for y in pool_34: group5.add(tuple(sorted((x, y))))
    for x in group3:
        for y in group4: group5.add(tuple(sorted((x, y))))
        
    dadi = []
    offset_all = [0] * L
    if k_period > 1:
        n_minus_1_window = raw_parsed_tuple[n_lines - (k_period - 1):]
        for pos in range(L):
            offset_all[pos] = sum(row[pos] for row in n_minus_1_window) % 10
            
    # 将 group5 转为 tuple 列表，方便遍历
    group5_list = list(group5)
            
    for num in range(1000):
        # 优化：使用数学运算替代字符串转化
        d1 = num // 100
        d2 = (num // 10) % 10
        d3 = num % 10
        digits = (d1, d2, d3)
        
        valid = False
        for a, b in group5_list:
            if a == b:
                if digits.count(a) >= 2:
                    valid = True
                    break
            else:
                if a in digits and b in digits:
                    valid = True
                    break
        if valid:
            if k_period > 1:
                final_d = ((digits[pos] - offset_all[pos]) % 10 for pos in range(min(3, len(digits))))
                final_d_list = list(final_d)
                dadi.append(f"{final_d_list[0]}{final_d_list[1]}{final_d_list[2]}")
            else:
                dadi.append(f"{d1}{d2}{d3}")
                
    dadi = sorted(list(set(dadi)))
    return {
        'group1': list(group1), 'group2': list(group2), 'group3': list(group3), 'group4': list(group4),
        'group5': [list(p) for p in group5],
        'dadi': dadi,
        'offsetApplied': k_period > 1,
        'offsets': list(offset_all) if k_period > 1 else None
    }

def normalize_tolerance_range(min_err, max_err):
    try:
        normalized_min = int(min_err)
    except (TypeError, ValueError):
        normalized_min = 0
    try:
        normalized_max = int(max_err)
    except (TypeError, ValueError):
        normalized_max = 0

    if normalized_min > normalized_max:
        normalized_min, normalized_max = normalized_max, normalized_min

    return normalized_min, normalized_max

def apply_period_sum_offset(code, offsets):
    if not offsets:
        return code
    return ''.join(str((int(ch) - (offsets[i] if i < len(offsets) else 0)) % 10) for i, ch in enumerate(code))

def compute_numbers_from_counts(counts, total_sets, min_err, max_err, period_sum_offset=None):
    min_count = max(0, total_sets - max_err)
    max_count = total_sets - min_err
    numbers = []

    for num in range(1000):
        code = f'{num:03d}'
        hit_count = counts.get(code, 0)
        if min_count <= hit_count <= max_count:
            numbers.append(code)

    if not period_sum_offset:
        return numbers

    return sorted(set(apply_period_sum_offset(code, period_sum_offset) for code in numbers))

def period_label(period):
    return '1期' if period == 1 else f'{period}期和'

def build_dadi_error_candidate(period, min_err, max_err, fault_tolerance, period_sum_offset=None):
    numbers = compute_numbers_from_counts(
        fault_tolerance.get('counts', {}),
        fault_tolerance.get('total_sets', 0),
        min_err,
        max_err,
        period_sum_offset
    )
    return {
        'sourceKey': f'dadi-err:{period}:{min_err}:{max_err}',
        'label': f'容错分析 ({period_label(period)}) [{min_err},{max_err}]',
        'numbers': numbers,
    }

def build_dadi_transform_candidate(period, min_err, max_err, base, period_sum_offset=None):
    slot = base.get('slot')
    base_name = base.get('name') or f'大底{slot}'
    numbers = compute_numbers_from_counts(
        base.get('counts', {}),
        base.get('totalSets', 0),
        min_err,
        max_err,
        period_sum_offset
    )
    return {
        'sourceKey': f'dadi-transform:{slot}:{period}:{min_err}:{max_err}',
        'label': f'大底转换 {base_name} ({period_label(period)}) [{min_err},{max_err}]',
        'numbers': numbers,
    }

def compute_analysis_payload(lines, period_sum, base_sets=None):
    if not lines:
        return {'error': '请输入数据进行分析（数据为空）。'}, 400

    lines = [str(line).strip() for line in lines if str(line).strip()]

    if len(lines) == 0:
        return {'error': '请输入数据进行分析（无有效数据）。'}, 400

    L = len(lines[0])

    for i, line in enumerate(lines):
        if not line.isdigit() or len(line) != L:
            return {'error': f'输入格式错误：第 {i + 1} 行 "{line}" 不是 {L} 位纯数字。'}, 400

    if len(lines) < 2:
        return {'error': '至少需要输入2行数据（即至少包含1行历史记录与1行最新一期）。'}, 400

    n_lines = len(lines)
    raw_parsed = [[int(ch) for ch in line] for line in lines]

    if period_sum > 1:
        if n_lines < period_sum + 1:
            return {'error': f'至少需要 {period_sum + 1} 行数据来进行 {period_sum} 期和分析。'}, 400

        parsed = []
        for i in range(n_lines - period_sum + 1):
            window = raw_parsed[i:i + period_sum]
            summed_row = []
            for pos in range(L):
                pos_sum = sum(row[pos] for row in window) % 10
                summed_row.append(pos_sum)
            parsed.append(summed_row)
        n = len(parsed)
    else:
        parsed = raw_parsed
        n = len(parsed)

    # ═══ 1. 遗漏统计 ═══
    last_appeared = [[-1] * 10 for _ in range(L)]
    for i, digits in enumerate(parsed):
        row_num = i + 1
        for pos in range(L):
            last_appeared[pos][digits[pos]] = row_num

    gap_results = []
    for pos in range(L):
        max_gap = -1
        candidates = []
        for digit in range(10):
            R = last_appeared[pos][digit]
            gap = n if R == -1 else n - R
            if gap > max_gap:
                max_gap = gap
                candidates = [digit]
            elif gap == max_gap:
                candidates.append(digit)
        gap_results.append({
            'position': pos + 1,
            'maxGap': max_gap,
            'candidates': candidates,
            'is3Pos': False
        })

    if L >= 3:
        last_appeared_3pos = [-1] * 10
        for i, digits in enumerate(parsed):
            row_num = i + 1
            for pos in range(3):
                last_appeared_3pos[digits[pos]] = row_num

        max_gap_3pos = -1
        candidates_3pos = []
        all_gaps_3pos = {}
        for digit in range(10):
            R = last_appeared_3pos[digit]
            gap = n if R == -1 else n - R
            all_gaps_3pos[digit] = gap
            if gap > max_gap_3pos:
                max_gap_3pos = gap
                candidates_3pos = [digit]
            elif gap == max_gap_3pos:
                candidates_3pos.append(digit)

        gap_results.append({
            'position': '前三',
            'maxGap': max_gap_3pos,
            'candidates': candidates_3pos,
            'is3Pos': True,
            'allGaps': all_gaps_3pos
        })

    raw_parsed_tuple = tuple(tuple(row) for row in raw_parsed)
    dadi_results = compute_dadi(period_sum, n_lines, raw_parsed_tuple, L) or {}

    if period_sum > 1:
        base_data_list = parsed
    else:
        base_data_list = raw_parsed
    base_data_tuple = tuple(tuple(row) for row in base_data_list)
    base_n = len(base_data_list)

    dadi_fault_tolerance = {'total_sets': 0, 'counts': {}}
    danger_periods = []
    danger_period_gaps = {}
    raw_n = len(raw_parsed)
    raw_parsed_for_danger = raw_parsed

    period_sum_offset = [0] * L
    if period_sum > 1:
        ps_window = raw_parsed[n_lines - (period_sum - 1):]
        for pos in range(min(3, L)):
            period_sum_offset[pos] = sum(row[pos] for row in ps_window) % 10

    for k in range(1, 21):
        res_k = compute_dadi(k, base_n, base_data_tuple, L)
        if res_k and 'dadi' in res_k:
            dadi_fault_tolerance['total_sets'] += 1
            for num in res_k['dadi']:
                dadi_fault_tolerance['counts'][num] = dadi_fault_tolerance['counts'].get(num, 0) + 1

            pk = []
            if k > 1:
                for i in range(raw_n - k + 1):
                    window = raw_parsed_for_danger[i:i + k]
                    pk.append([sum(row[p] for row in window) % 10 for p in range(L)])
            else:
                pk = raw_parsed_for_danger

            nk = len(pk)
            max_gap_for_k = 0
            if nk > 0:
                last_appeared_k = [[-1] * 10 for _ in range(min(3, L))]
                for i, digits in enumerate(pk):
                    row_num = i + 1
                    for pos in range(min(3, L)):
                        last_appeared_k[pos][digits[pos]] = row_num

                for pos in range(min(3, L)):
                    for digit in range(10):
                        last_i = last_appeared_k[pos][digit]
                        gap = nk if last_i == -1 else nk - last_i
                        if gap > max_gap_for_k:
                            max_gap_for_k = gap

            if max_gap_for_k > 40:
                danger_periods.append(k)
                danger_period_gaps[k] = max_gap_for_k

    transformed_data = ["".join(map(str, row)) for row in (parsed if period_sum > 1 else raw_parsed)]
    if base_sets is None:
        base_sets = load_dadi_base_sets()
    dadi_transform = compute_dadi_transform(base_data_list, L, base_sets)

    return {
        'totalFiles': 1,
        'totalLines': n_lines,
        'parsedData': transformed_data,
        'gapAnalysis': gap_results,
        'dadiAnalysis': dadi_results,
        'dadiFaultTolerance': dadi_fault_tolerance,
        'dadiTransform': dadi_transform,
        'dangerPeriods': danger_periods,
        'dangerPeriodGaps': danger_period_gaps,
        'offsets': dadi_results.get('offsets') if dadi_results else None,
        'periodSum': period_sum,
        'periodSumOffset': period_sum_offset if period_sum > 1 else None
    }, 200

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/help')
def help_page():
    return render_template('help.html')

@app.route(ACCESS_LOG_ROUTE_PATH)
def access_logs_page():
    expire_at_raw = request.args.get('exp', '').strip()
    signature = request.args.get('sig', '').strip()
    if not is_valid_access_logs_request(expire_at_raw, signature):
        abort(404)

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        '''
        SELECT ip, path, method, strftime('%m-%d %H:%M:%S', created_at, 'localtime') AS local_time
        FROM access_log
        WHERE path != ?
        ORDER BY created_at DESC
        LIMIT ?
        ''',
        (ACCESS_LOG_ROUTE_PATH, ACCESS_LOG_PAGE_LIMIT)
    )
    rows = cursor.fetchall()
    logs = [dict(row) for row in rows]
    ip_locations = {}
    for item in logs:
        ip_addr = item.get('ip')
        if ip_addr not in ip_locations:
            ip_locations[ip_addr] = get_ip_location(ip_addr)
        item['location'] = ip_locations[ip_addr]

    cursor.execute(
        '''
        SELECT COUNT(*) AS count, COUNT(DISTINCT ip) AS unique_ips
        FROM access_log
        WHERE created_at >= datetime('now', '-24 hours')
          AND path != ?
        '''
        ,
        (ACCESS_LOG_ROUTE_PATH,)
    )
    stats_24h = cursor.fetchone()

    cursor.execute(
        '''
        SELECT path, COUNT(*) AS count
        FROM access_log
        WHERE created_at >= datetime('now', '-24 hours')
          AND path != ?
        GROUP BY path
        ORDER BY count DESC, path ASC
        LIMIT 10
        '''
        ,
        (ACCESS_LOG_ROUTE_PATH,)
    )
    top_paths = cursor.fetchall()
    conn.close()

    expire_at = datetime.fromtimestamp(int(expire_at_raw)).strftime('%Y-%m-%d %H:%M:%S')
    response = make_response(render_template(
        'access_logs.html',
        logs=logs,
        expires_at=expire_at,
        log_limit=ACCESS_LOG_PAGE_LIMIT,
        total_24h=stats_24h['count'] if stats_24h else 0,
        unique_ips_24h=stats_24h['unique_ips'] if stats_24h else 0,
        top_paths=top_paths,
    ))
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['X-Robots-Tag'] = 'noindex, nofollow, noarchive'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "base-uri 'none'; "
        "form-action 'none'; "
        "frame-ancestors 'none'"
    )
    return response

@app.route('/api/dadi_bases', methods=['GET'])
def get_dadi_bases():
    try:
        base_sets = load_dadi_base_sets()
        return jsonify({
            'success': True,
            'bases': [
                {
                    'slot': base['slot'],
                    'name': base['name'],
                    'sourceCount': len(base['numbers'])
                } for base in base_sets
            ]
        })
    except Exception as e:
        return jsonify({'error': f'读取大底库失败: {str(e)}'}), 500

@app.route('/api/dadi_bases/<int:slot>', methods=['POST'])
def upsert_dadi_base(slot):
    if slot < 1 or slot > 4:
        return jsonify({'error': 'slot 必须在 1 到 4 之间'}), 400

    try:
        default_name = f'大底{slot}'
        name = default_name
        numbers_input = ''

        payload = request.get_json(silent=True) or {}
        name = str(payload.get('name') or request.form.get('name') or default_name).strip() or default_name
        numbers_input = payload.get('numbers') or request.form.get('numbers') or ''

        numbers, invalid = normalize_dadi_numbers(numbers_input)
        if invalid:
            preview = ', '.join(invalid[:5])
            return jsonify({'error': f'存在无效号码（需为3位数字）: {preview}'}), 400

        numbers_text = '\n'.join(numbers)
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            INSERT OR REPLACE INTO dadi_base_sets (slot, name, numbers_text, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ''',
            (slot, name, numbers_text)
        )
        conn.commit()
        conn.close()

        return jsonify({
            'success': True,
            'slot': slot,
            'name': name,
            'sourceCount': len(numbers)
        })
    except Exception as e:
        return jsonify({'error': f'写入大底库失败: {str(e)}'}), 500

@app.route('/api/analyze', methods=['POST'])
def analyze():
    req_data = request.get_json(silent=True) or {}
    lines = req_data.get('lines', [])
    try:
        period_sum = int(req_data.get('period_sum', 1))
    except (TypeError, ValueError):
        period_sum = 1

    if period_sum < 1 or period_sum > 20:
        period_sum = 1

    payload, status = compute_analysis_payload(lines, period_sum)
    return jsonify(payload), status

@app.route('/api/batch_candidates', methods=['POST'])
def batch_candidates():
    req_data = request.get_json(silent=True) or {}
    mode = str(req_data.get('mode') or '').strip()
    lines = req_data.get('lines', [])
    min_err, max_err = normalize_tolerance_range(req_data.get('minErr', 0), req_data.get('maxErr', 0))

    if mode not in {'dadi_error', 'dadi_transform'}:
        return jsonify({'error': 'mode 必须是 dadi_error 或 dadi_transform'}), 400

    slot = None
    if mode == 'dadi_transform':
        try:
            slot = int(req_data.get('slot'))
        except (TypeError, ValueError):
            return jsonify({'error': 'slot 必须在 1 到 4 之间'}), 400
        if slot < 1 or slot > 4:
            return jsonify({'error': 'slot 必须在 1 到 4 之间'}), 400

    base_sets = load_dadi_base_sets()
    candidates = []

    for period in range(1, 21):
        analysis, status = compute_analysis_payload(lines, period, base_sets)
        if status != 200:
            return jsonify(analysis), status

        period_sum_offset = analysis.get('periodSumOffset')
        if mode == 'dadi_error':
            candidate = build_dadi_error_candidate(
                period,
                min_err,
                max_err,
                analysis.get('dadiFaultTolerance') or {},
                period_sum_offset
            )
        else:
            bases = (analysis.get('dadiTransform') or {}).get('bases') or []
            base = next((item for item in bases if str(item.get('slot')) == str(slot)), None)
            if not base:
                return jsonify({'error': f'未找到大底{slot}的转换数据'}), 400
            candidate = build_dadi_transform_candidate(
                period,
                min_err,
                max_err,
                base,
                period_sum_offset
            )
        candidates.append(candidate)

    return jsonify({
        'success': True,
        'mode': mode,
        'candidates': candidates,
    })

@app.route('/api/update_history', methods=['POST', 'GET'])
def update_history():
    try:
        url = 'https://kaijiang.500.com/static/info/kaijiang/xml/plw/list.xml'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            xml_data = response.read().decode('utf-8')
        
        root = ElementTree.fromstring(xml_data)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        added_count = 0
        for xml_row in root.findall('row'):
            expect = xml_row.get('expect')
            opencode = xml_row.get('opencode')
            opentime = xml_row.get('opentime', '')
            if expect and opencode:
                digits = opencode.replace(',', '').strip()
                if len(digits) == 5:
                    cursor.execute(
                        'INSERT OR IGNORE INTO lottery_history (expect, opencode, opentime) VALUES (?, ?, ?)',
                        (expect, digits, opentime)
                    )
                    added_count += cursor.rowcount
                        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'added_count': added_count, 'message': f'成功更新了 {added_count} 条新数据'})
    except Exception as e:
        return jsonify({'error': f'抓取开奖数据失败: {str(e)}'}), 500

@app.route('/api/get_history', methods=['GET'])
def get_history():
    try:
        limit = request.args.get('limit', 300, type=int)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 获取最新的 limit 条数据，按期号倒序排（最前面的是最新的）
        cursor.execute('''
            SELECT expect, opencode, opentime FROM lottery_history
            ORDER BY expect DESC
            LIMIT ?
        ''', (limit,))
        
        rows = cursor.fetchall()
        conn.close()
        
        latest_time = rows[0]['opentime'] if rows else ""
        
        lines = [row['opencode'] for row in rows]
        expects = [row['expect'] for row in rows]

        # 反转列表，确保时间顺序从旧到新 (最后一行为最新一期)
        lines.reverse()
        expects.reverse()
        
        if not lines:
            return jsonify({'error': '数据库中没有开奖数据'}), 404
            
        return jsonify({
            'success': True,
            'data': lines,
            'expects': expects,
            'latest_time': latest_time,
        })
    except Exception as e:
        return jsonify({'error': f'读取历史数据失败: {str(e)}'}), 500

if __name__ == '__main__':
    app.run( host='0.0.0.0', port=5002, debug=True)
