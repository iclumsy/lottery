import os
import re
import sys
import json
import time
import random
import hashlib
import base64
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

# ==========================================
# 配置参数
# ==========================================
# 目标专辑ID（可以替换为其他省份的专辑ID，例如陕西是 114985847
ALBUM_ID = 79380121

# 基础保存目录
BASE_OUTPUT_DIR = "/Users/ditto/Documents/lottery/downloaded_tracks"
# ==========================================

# 1. 解密播放链接的 AES-128-ECB 算法
def decrypt_play_url(enc_url):
    try:
        b64_str = enc_url.replace('-', '+').replace('_', '/')
        missing_padding = len(b64_str) % 4
        if missing_padding:
            b64_str += '=' * (4 - missing_padding)
        
        enc_data = base64.b64decode(b64_str)
        key = bytes.fromhex('aaad3e4fd540b0f79dca95606e72bf93')
        
        cipher = Cipher(algorithms.AES(key), modes.ECB(), backend=default_backend())
        decryptor = cipher.decryptor()
        dec_data = decryptor.update(enc_data) + decryptor.finalize()
        
        # PKCS7 反填充
        pad_len = dec_data[-1]
        if 1 <= pad_len <= 16:
            if all(x == pad_len for x in dec_data[-pad_len:]):
                dec_data = dec_data[:-pad_len]
                
        return dec_data.decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"解密播放链接失败: {e}")
        return None

# 2. 动态生成 xm-sign 签名
def get_server_time():
    url = "https://www.ximalaya.com/revision/time"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.read().decode('utf-8').strip()
    except Exception:
        return str(int(time.time() * 1000))

def generate_xm_sign(server_time):
    hash_input = f"himalaya-{server_time}"
    m = hashlib.md5()
    m.update(hash_input.encode('utf-8'))
    hash_str = m.hexdigest()
    
    rand1 = random.randint(10, 99)
    rand2 = random.randint(10, 99)
    now_time = int(time.time() * 1000)
    
    return f"{hash_str}({rand1}){server_time}({rand2}){now_time}"

# 3. 从 HAR 文件中读取完整的 Cookie
def load_cookies_from_har():
    har_path = "/Users/ditto/Documents/lottery/Stream-2026-05-19 21:16:52.har"
    if not os.path.exists(har_path):
        print(f"未找到抓包文件: {har_path}")
        return ""
    with open(har_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    entries = data.get('log', {}).get('entries', [])
    cookies_found = {}
    for entry in entries:
        req = entry['request']
        for h in req['headers']:
            if h['name'].lower() == 'cookie':
                cookie_str = h['value']
                parts = cookie_str.split(';')
                for part in parts:
                    part = part.strip()
                    if '=' in part:
                        k, v = part.split('=', 1)
                        if len(v) > len(cookies_found.get(k, '')):
                            cookies_found[k] = v
    return "; ".join([f"{k}={v}" for k, v in cookies_found.items()])

# 4. 获取声音列表元数据 (支持自动抓取所有分页)
def get_album_tracks_metadata(album_id):
    # 用较大的 pageSize (如 200) 来一次性获取完单个专辑所有声音
    url = f"https://mobile.ximalaya.com/mobile/v1/album/track?albumId={album_id}&pageId=1&pageSize=200"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            resp_data = json.loads(res.read().decode('utf-8'))
            if resp_data.get('ret') == 0:
                return resp_data.get('data', {}).get('list', [])
            else:
                print(f"API 返回错误: {resp_data.get('msg')}")
    except Exception as e:
        print(f"获取专辑声音列表请求失败: {e}")
    return []

# 5. 音质评分函数 (用于动态选择最高音质)
def get_quality_score(type_str):
    if not type_str:
        return 0
    type_upper = type_str.upper()
    if 'FLAC' in type_upper or 'LOSSLESS' in type_upper or 'APE' in type_upper:
        return 1000
        
    # 尝试提取比特率，例如 M4A_64 -> 64
    m = re.search(r'\d+', type_upper)
    bitrate = int(m.group()) if m else 0
    
    # M4A/AAC 比 MP3 压缩效率高、音质更好，相同比特率下给予优势加分
    bonus = 0.5 if 'M4A' in type_upper or 'AAC' in type_upper else 0.0
    return bitrate + bonus

# 6. 获取单个声音的播放地址 (支持 1001 系统繁忙时自动重试)
def get_track_play_url(track_id, cookie_header):
    max_retries = 4
    for attempt in range(max_retries):
        server_time = get_server_time()
        xm_sign = generate_xm_sign(server_time)
        now_time = int(time.time() * 1000)
        
        url = f"https://www.ximalaya.com/mobile-playpage/track/v3/baseInfo/{now_time}?trackId={track_id}&device=web"
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Cookie": cookie_header,
            "xm-sign": xm_sign,
        }
        
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                resp_data = json.loads(res.read().decode('utf-8'))
                ret = resp_data.get('ret')
                if ret == 0:
                    track_info = resp_data.get('trackInfo', {})
                    if not track_info:
                        return None, "响应中未找到 trackInfo"
                    play_list = track_info.get('playUrlList', [])
                    if not play_list:
                        return None, "没有可用的播放地址列表"
                    
                    # 动态选择最佳音质
                    sorted_play = sorted(play_list, key=lambda x: get_quality_score(x.get('type')), reverse=True)
                    
                    best_track = sorted_play[0]
                    encrypted_url = best_track.get('url')
                    decrypted_url = decrypt_play_url(encrypted_url)
                    return decrypted_url, None
                elif ret == 1001:
                    wait_time = 2.0 + attempt * 2.0
                    print(f"  [重试] 声音 {track_id} 遇到 1001 繁忙，将在 {wait_time} 秒后进行第 {attempt + 1} 次重试...")
                    time.sleep(wait_time)
                    continue
                else:
                    return None, f"API 返回错误 ret={ret} msg={resp_data.get('msg')}"
        except Exception as e:
            if attempt == max_retries - 1:
                return None, str(e)
            time.sleep(2)
    return None, "达到最大重试次数"

# 6. 清理文件名或目录名中的非法字符
def clean_filename(name):
    name = re.sub(r'[\/:*?"<>|]', '_', name)
    return name.strip()

# 7. 下载单个音频文件 (支持网络异常自动重试)
def download_file(url, output_path):
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    max_retries = 3
    for attempt in range(max_retries):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as response, open(output_path, 'wb') as out_file:
                data = response.read()
                out_file.write(data)
            return True, None
        except Exception as e:
            if attempt == max_retries - 1:
                return False, str(e)
            time.sleep(2)
    return False, "达到最大重试次数"

# 8. 主执行函数
def main():
    print("开始初始化喜马拉雅音频下载程序...")
    cookie_header = load_cookies_from_har()
    if not cookie_header:
        print("错误: 无法从 HAR 文件中提取 VIP Cookie，请确保抓包文件有效！")
        return
        
    # 获取声音列表
    print(f"正在向服务器请求专辑 ID: {ALBUM_ID} 的声音列表...")
    tracks = get_album_tracks_metadata(ALBUM_ID)
    if not tracks:
        print("错误: 无法获取声音列表，请检查网络或专辑 ID 是否正确。")
        return
        
    # 获取专辑名称并建立对应文件夹
    album_title = tracks[0].get('albumTitle', f"album_{ALBUM_ID}")
    safe_album_title = clean_filename(album_title)
    
    # 动态拼接专属于该省份/该专辑的保存目录
    album_output_dir = os.path.join(BASE_OUTPUT_DIR, safe_album_title)
    os.makedirs(album_output_dir, exist_ok=True)
    
    # 提取省份简称 (例如：从 “大中华寻宝记 · 新疆寻宝记” 提取出 “新疆”)
    m = re.findall(r'([\u4e00-\u9fa5]{2,4})寻宝记', album_title)
    province = "寻宝"
    if m:
        valid_provinces = [p for p in m if p != "大中华"]
        province = valid_provinces[0] if valid_provinces else m[0]
    
    # 过滤掉非故事音频 (发刊词, 小剧场, 大咖推荐, 推荐序, 完结, 致辞)
    exclude_keywords = ["发刊词", "小剧场", "大咖推荐", "推荐序", "完结", "致辞"]
    filtered_tracks = []
    for t in tracks:
        title = t.get('title', '')
        should_exclude = False
        for kw in exclude_keywords:
            if kw in title:
                should_exclude = True
                break
        if not should_exclude:
            filtered_tracks.append(t)
            
    print(f"专辑标题: {album_title} (省份: {province})")
    print(f"共发现 {len(tracks)} 个声音资源，其中 {len(filtered_tracks)} 个为核心故事音频")
    print(f"保存目录: {album_output_dir}")
    print("即将开始下载...")
    
    success_count = 0
    fail_count = 0
    
    # 定义线程任务
    def process_track(index, t):
        track_id = t.get('trackId')
        title = t.get('title')
        order_no = index + 1
        
        # 提取干净的集名 (去掉喜马拉雅的前缀如“大中华寻宝记【第XX集】”和“大中华寻宝记【番外篇】”)
        clean_title = re.sub(r'^大中华寻宝记【(?:第\d+集|番外篇)】(?:-\s*)?', '', title)
        clean_title = clean_filename(clean_title)
        
        filename = f"{province}-{order_no:03d}-{clean_title}.m4a"
        output_path = os.path.join(album_output_dir, filename)
        
        # 如果已经下载过了，直接跳过
        if os.path.exists(output_path) and os.path.getsize(output_path) > 100000:
            return f"[跳过] 声音 {order_no:03d}: {title} 已存在。"
            
        # 获取真实播放地址
        time.sleep(0.5)
        play_url, err = get_track_play_url(track_id, cookie_header)
        if err or not play_url:
            return f"[失败] 声音 {order_no:03d}: {title} 获取下载链接失败 ({err or '解密空地址'})"
            
        # 开始下载
        time.sleep(0.5)
        success, dl_err = download_file(play_url, output_path)
        if success:
            return f"[成功] 声音 {order_no:03d}: {title} 下载完成！"
        else:
            # 下载失败时删除不完整的文件
            if os.path.exists(output_path):
                os.remove(output_path)
            return f"[失败] 声音 {order_no:03d}: {title} 下载文件失败 ({dl_err})"

    # 单线程顺序下载 (每秒下载一个，更安全防屏蔽)
    print("开始单线程顺序下载...")
    for idx, t in enumerate(filtered_tracks):
        res = process_track(idx, t)
        print(res)
        if "成功" in res or "跳过" in res:
            success_count += 1
        else:
            fail_count += 1
        
        # 成功下载后，强制等待 1.0 秒以控制请求频率
        if "成功" in res:
            time.sleep(1.0)
            
    print(f"\n下载任务结束。成功: {success_count} 个，失败: {fail_count} 个。")
    print(f"音频保存总路径: {album_output_dir}")

if __name__ == "__main__":
    main()
