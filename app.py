from flask import Flask, request, render_template, jsonify, Response, send_file
import yt_dlp
import os
import uuid
import json
import time
import threading
import subprocess
import traceback

app = Flask(__name__)
DOWNLOAD_FOLDER = 'downloads'
if not os.path.exists(DOWNLOAD_FOLDER):
    os.makedirs(DOWNLOAD_FOLDER)

COOKIE_FILE = "/etc/secrets/cookies.txt"

if not os.path.exists(COOKIE_FILE):
    COOKIE_FILE = None

progress_store = {}

# ========== ffmpeg Check ==========
def check_ffmpeg():
    try:
        subprocess.run(['ffmpeg', '-version'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except:
        return False

FFMPEG_AVAILABLE = check_ffmpeg()
if not FFMPEG_AVAILABLE:
    print("⚠️ WARNING: ffmpeg not found. MP3 conversion may fail.")

# ========== Home ==========
@app.route('/')
def index():
    return render_template('index.html')

# ========== Get Video Info (Multiple Strategies) ==========
@app.route('/info', methods=['POST'])
def get_info():
    url = request.form.get('url')
    if not url:
        return jsonify({'error': 'URL required'}), 400
    
    # Try multiple strategies
    strategies = [
        # Strategy 1: Android + Web clients (best for YouTube)
        {
            'extractor_args': {'youtube': {'player_client': ['android', 'web']}},
            'cookiefile': COOKIE_FILE
        },
        # Strategy 2: Only Android
        {
            'extractor_args': {'youtube': {'player_client': ['android']}},
            'cookiefile': COOKIE_FILE
        },
        # Strategy 3: Only Web
        {
            'extractor_args': {'youtube': {'player_client': ['web']}},
            'cookiefile': COOKIE_FILE
        },
        # Strategy 4: No extractor_args (bare)
        {
            'cookiefile': COOKIE_FILE
        },
        # Strategy 5: Without cookies (if cookies exist but fail)
        {
            'extractor_args': {'youtube': {'player_client': ['android', 'web']}},
        },
        # Strategy 6: Completely bare
        {}
    ]
    
    for i, opts in enumerate(strategies):
        try:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'ignoreerrors': True,
                **opts
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if info is not None:
                    # Success! Extract formats
                    formats = []
                    for f in info.get('formats', []):
                        formats.append({
                            'format_id': f.get('format_id'),
                            'height': f.get('height'),
                            'width': f.get('width'),
                            'fps': f.get('fps'),
                            'filesize': f.get('filesize'),
                            'vcodec': f.get('vcodec'),
                            'acodec': f.get('acodec'),
                            'abr': f.get('abr'),
                            'audio_ext': f.get('audio_ext'),
                            'ext': f.get('ext'),
                        })
                    
                    result = {
                        'title': info.get('title', ''),
                        'thumbnail': info.get('thumbnail', ''),
                        'duration': info.get('duration', 0),
                        'channel': info.get('channel', ''),
                        'views': info.get('view_count', 0),
                        'formats': formats
                    }
                    return jsonify(result)
        except Exception as e:
            print(f"\n===== Strategy {i+1} Failed =====")
            traceback.print_exc()
            continue
    
    # All strategies failed
    if not os.path.exists('cookies.txt'):
        return jsonify({'error': 'Invalid URL or unsupported site. Please add cookies.txt (see docs).'}), 400
    else:
        return jsonify({'error': 'Invalid URL or unsupported site. Your cookies may be expired. Please refresh cookies.txt.'}), 400

# ========== Start Download ==========
@app.route('/download', methods=['POST'])
def download():
    url = request.form.get('url')
    format_id = request.form.get('format_id', 'best')
    output_format = request.form.get('output_format', 'mp4')
    
    if not url:
        return jsonify({'error': 'URL required'}), 400
    
    download_id = str(uuid.uuid4())
    temp_path = os.path.join(DOWNLOAD_FOLDER, download_id)
    
    # Common options for all downloads (try without cookies first)
    common_opts = {
        'quiet': False,
        'no_warnings': False,
        'ignoreerrors': True,
        'extractor_args': {
            'youtube': {
                'skip': ['hls', 'dash'],
                'player_client': ['android', 'web'],
            }
        },
        'progress_hooks': [lambda d: progress_hook(d, download_id)],
    }
    
    # Add cookies if available
    if COOKIE_FILE:
        common_opts['cookiefile'] = COOKIE_FILE
    
    if output_format == 'mp3':
        if format_id != 'best':
            format_str = format_id
        else:
            format_str = 'bestaudio/best'
        
        ydl_opts = {
            **common_opts,
            'outtmpl': temp_path + '.%(ext)s',
            'format': format_str,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        }
    else:  # MP4
        if format_id != 'best':
            format_str = f"{format_id}+bestaudio/best"
        else:
            format_str = 'best[ext=mp4]/best'
        
        ydl_opts = {
            **common_opts,
            'outtmpl': temp_path + '.%(ext)s',
            'format': format_str,
            'merge_output_format': 'mp4',
        }
    
    progress_store[download_id] = {
        'status': 'starting',
        'percent': 0,
        'speed': 0,
        'eta': 0,
        'filename': None
    }
    
    def download_thread():
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if info is None:
                    progress_store[download_id]['status'] = 'error'
                    progress_store[download_id]['message'] = 'Invalid URL or unsupported site'
                    return
                actual_file = None
                for f in os.listdir(DOWNLOAD_FOLDER):
                    if f.startswith(download_id):
                        actual_file = f
                        break
                if actual_file:
                    progress_store[download_id]['filename'] = actual_file
                    progress_store[download_id]['status'] = 'finished'
                else:
                    progress_store[download_id]['status'] = 'error'
                    progress_store[download_id]['message'] = 'File not found after download'
        except Exception as e:
            progress_store[download_id]['status'] = 'error'
            progress_store[download_id]['message'] = str(e)
    
    thread = threading.Thread(target=download_thread)
    thread.start()
    
    return jsonify({'download_id': download_id})

# ========== Progress Hook ==========
def progress_hook(d, download_id):
    if d['status'] == 'downloading':
        progress_store[download_id]['status'] = 'downloading'
        pct_str = d.get('_percent_str', '0%').replace('%', '').strip()
        try:
            progress_store[download_id]['percent'] = float(pct_str)
        except:
            progress_store[download_id]['percent'] = 0
        progress_store[download_id]['speed'] = d.get('speed', 0)
        progress_store[download_id]['eta'] = d.get('eta', 0)
    elif d['status'] == 'finished':
        progress_store[download_id]['status'] = 'finished'
        progress_store[download_id]['percent'] = 100

# ========== Progress SSE ==========
@app.route('/progress/<download_id>')
def progress(download_id):
    def generate():
        while True:
            data = progress_store.get(download_id)
            if not data:
                yield f"data: {json.dumps({'status': 'error', 'message': 'Download ID not found'})}\n\n"
                break
            yield f"data: {json.dumps(data)}\n\n"
            if data['status'] in ('finished', 'error'):
                break
            time.sleep(1)
    return Response(generate(), mimetype='text/event-stream')

# ========== Download File ==========
@app.route('/download_file/<download_id>')
def download_file(download_id):
    actual_file = None
    for f in os.listdir(DOWNLOAD_FOLDER):
        if f.startswith(download_id):
            actual_file = os.path.join(DOWNLOAD_FOLDER, f)
            break
    if not actual_file or not os.path.exists(actual_file):
        return "File not found", 404
    
    filename = progress_store.get(download_id, {}).get('filename', 'video.mp4')
    
    def cleanup():
        try:
            os.remove(actual_file)
            if download_id in progress_store:
                del progress_store[download_id]
        except:
            pass
    
    return send_file(actual_file, as_attachment=True, download_name=filename, after_this_request=cleanup)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)