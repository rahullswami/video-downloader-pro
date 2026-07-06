// ========== DOM Elements ==========
const urlInput = document.getElementById('urlInput');
const downloadForm = document.getElementById('downloadForm');
const downloadBtn = document.getElementById('downloadBtn');
const btnText = document.getElementById('btnText');
const spinner = document.getElementById('spinner');
const status = document.getElementById('status');
const preview = document.getElementById('videoPreview');
const thumbnail = document.getElementById('thumbnail');
const videoTitle = document.getElementById('videoTitle');
const videoChannel = document.getElementById('videoChannel');
const videoViews = document.getElementById('videoViews');
const durationBadge = document.getElementById('durationBadge');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const progressSpeed = document.getElementById('progressSpeed');
const progressETA = document.getElementById('progressETA');
const qualitySelect = document.getElementById('qualitySelect');
const optionsPanel = document.getElementById('optionsPanel');
const toggleBtns = document.querySelectorAll('.toggle-btn');
const themeToggle = document.getElementById('themeToggle');

let currentFormat = 'mp4';
let currentQuality = 'best';
let eventSource = null;
let downloadId = null;

// ========== Theme Toggle ==========
const root = document.documentElement;
const storedTheme = localStorage.getItem('theme') || 'dark';
root.setAttribute('data-theme', storedTheme);
updateThemeIcon(storedTheme);

themeToggle.addEventListener('click', () => {
    const current = root.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
});

function updateThemeIcon(theme) {
    const icon = themeToggle.querySelector('i');
    icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
}

// ========== Format Toggle ==========
toggleBtns.forEach(btn => {
    btn.addEventListener('click', function() {
        toggleBtns.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentFormat = this.dataset.format;
        if (!preview.classList.contains('hidden')) {
            const url = urlInput.value.trim();
            if (url) fetchVideoInfo(url);
        }
    });
});

// ========== Fetch Video Info ==========
let debounceTimer;
urlInput.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    const url = this.value.trim();
    if (!url) {
        preview.classList.add('hidden');
        optionsPanel.classList.add('hidden');
        return;
    }
    if (!isValidUrl(url)) return;
    debounceTimer = setTimeout(() => fetchVideoInfo(url), 500);
});

function isValidUrl(string) {
    try { new URL(string); return true; } catch (_) { return false; }
}

async function fetchVideoInfo(url) {
    try {
        status.textContent = '⏳ Fetching video info...';
        status.className = 'status-message';
        
        const response = await fetch('/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'url=' + encodeURIComponent(url)
        });
        
        if (!response.ok) {
            const err = await response.text();
            throw new Error(err || 'Info fetch failed');
        }
        
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        
        thumbnail.src = data.thumbnail || '';
        videoTitle.textContent = data.title || 'Untitled';
        videoChannel.innerHTML = `<i class="fas fa-user"></i> ${data.channel || 'Unknown'}`;
        videoViews.innerHTML = `<i class="fas fa-eye"></i> ${data.views ? formatNumber(data.views) + ' views' : ''}`;
        durationBadge.textContent = formatDuration(data.duration);
        preview.classList.remove('hidden');
        
        populateQualityOptions(data.formats);
        optionsPanel.classList.remove('hidden');
        
        status.textContent = '';
        status.className = 'status-message';
        
    } catch (error) {
        preview.classList.add('hidden');
        optionsPanel.classList.add('hidden');
        status.textContent = '❌ ' + error.message;
        status.className = 'status-message error';
    }
}

function populateQualityOptions(formats) {
    qualitySelect.innerHTML = '';
    let options = [];
    if (currentFormat === 'mp4') {
        const videoFormats = formats.filter(f => f.vcodec !== 'none' && f.height);
        const unique = new Map();
        videoFormats.forEach(f => {
            const key = f.height;
            if (!unique.has(key) || f.filesize > unique.get(key).filesize) {
                unique.set(key, f);
            }
        });
        const sorted = Array.from(unique.values()).sort((a,b) => b.height - a.height);
        sorted.forEach(f => {
            const label = `${f.height}p${f.fps ? ` ${f.fps}fps` : ''} ${f.filesize ? `(${(f.filesize/1024/1024).toFixed(1)}MB)` : ''}`;
            options.push({ value: f.format_id, label });
        });
    } else {
        const audioFormats = formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
        const sorted = audioFormats.sort((a,b) => (b.abr || 0) - (a.abr || 0));
        sorted.forEach(f => {
            const label = `${f.abr || '?'}kbps ${f.audio_ext || 'mp3'}`;
            options.push({ value: f.format_id, label });
        });
    }
    if (options.length > 0) {
        const bestOption = document.createElement('option');
        bestOption.value = 'best';
        bestOption.textContent = 'Best';
        qualitySelect.appendChild(bestOption);
        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            qualitySelect.appendChild(option);
        });
        qualitySelect.value = 'best';
        currentQuality = 'best';
    } else {
        const bestOption = document.createElement('option');
        bestOption.value = 'best';
        bestOption.textContent = 'Best';
        qualitySelect.appendChild(bestOption);
    }
}

// ========== Helpers ==========
function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m >= 60) {
        const h = Math.floor(m / 60);
        const remM = m % 60;
        return `${h}:${String(remM).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }
    return `${m}:${String(s).padStart(2,'0')}`;
}

function formatNumber(num) {
    if (num >= 1e6) return (num/1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num/1e3).toFixed(1) + 'K';
    return num;
}

// ========== Download Form Submit ==========
downloadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) {
        status.textContent = '❌ Please enter a URL';
        status.className = 'status-message error';
        return;
    }
    
    const quality = qualitySelect.value;
    const format = currentFormat;
    
    downloadBtn.disabled = true;
    btnText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Downloading...';
    spinner.classList.remove('hidden');
    status.textContent = '⏳ Connecting to server...';
    status.className = 'status-message';
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressSpeed.innerHTML = '<i class="fas fa-tachometer-alt"></i> --';
    progressETA.innerHTML = '<i class="fas fa-clock"></i> --';
    
    try {
        const startResponse = await fetch('/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                url: url,
                format_id: quality,
                output_format: format
            })
        });
        
        if (!startResponse.ok) {
            const errText = await startResponse.text();
            throw new Error(errText || 'Download start failed');
        }
        
        const data = await startResponse.json();
        downloadId = data.download_id;
        
        if (eventSource) eventSource.close();
        eventSource = new EventSource(`/progress/${downloadId}`);
        eventSource.onmessage = function(event) {
            const progress = JSON.parse(event.data);
            updateProgress(progress);
        };
        eventSource.onerror = function() {
            eventSource.close();
        };
        
    } catch (error) {
        status.textContent = '❌ ' + error.message;
        status.className = 'status-message error';
        resetUI();
    }
});

// ========== Progress Update ==========
function updateProgress(data) {
    if (data.status === 'downloading') {
        const percent = Math.round(data.percent || 0);
        progressBar.style.width = percent + '%';
        progressPercent.textContent = percent + '%';
        if (data.speed) {
            progressSpeed.innerHTML = `<i class="fas fa-tachometer-alt"></i> ${formatSpeed(data.speed)}`;
        }
        if (data.eta) {
            progressETA.innerHTML = `<i class="fas fa-clock"></i> ${formatETA(data.eta)}`;
        }
        status.textContent = `⏳ Downloading... ${percent}%`;
        status.className = 'status-message';
    } else if (data.status === 'finished') {
        progressBar.style.width = '100%';
        progressPercent.textContent = '100%';
        status.textContent = '✅ Download complete! Saving file...';
        status.className = 'status-message success';
        downloadFile(data.filename);
    } else if (data.status === 'error') {
        status.textContent = '❌ ' + data.message;
        status.className = 'status-message error';
        resetUI();
    }
}

function formatSpeed(bytesPerSecond) {
    if (bytesPerSecond < 1024) return (bytesPerSecond).toFixed(0) + ' B/s';
    if (bytesPerSecond < 1024*1024) return (bytesPerSecond/1024).toFixed(1) + ' KB/s';
    return (bytesPerSecond/(1024*1024)).toFixed(1) + ' MB/s';
}

function formatETA(seconds) {
    if (seconds < 60) return Math.round(seconds) + 's';
    if (seconds < 3600) return Math.round(seconds/60) + 'm ' + Math.round(seconds%60) + 's';
    return Math.round(seconds/3600) + 'h ' + Math.round((seconds%3600)/60) + 'm';
}

function downloadFile(filename) {
    const link = document.createElement('a');
    link.href = `/download_file/${downloadId}`;
    link.download = filename || 'video.mp4';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => resetUI(), 3000);
}

function resetUI() {
    downloadBtn.disabled = false;
    btnText.innerHTML = '<i class="fas fa-arrow-down"></i> Download';
    spinner.classList.add('hidden');
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    setTimeout(() => {
        progressContainer.classList.add('hidden');
    }, 5000);
}

// ========== Quality Change ==========
qualitySelect.addEventListener('change', function() {
    currentQuality = this.value;
});

// ========== FAQ Accordion ==========
document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', function() {
        const item = this.closest('.faq-item');
        const isActive = item.classList.contains('active');
        document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
        if (!isActive) {
            item.classList.add('active');
        }
    });
});

// ========== Keyboard shortcut ==========
urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        downloadForm.dispatchEvent(new Event('submit'));
    }
});

console.log('Video Downloader Pro loaded.');