// ===== SwiftConnect Voice Notes =====
// Simple, reliable voice recording and playback

let mediaRecorder = null;
let audioChunks = [];
let voiceRecordingActive = false;
let voiceTimerInterval = null;
let voiceStartTime = null;
let audioStream = null;
let audioContext = null;
let analyser = null;
let dataArray = null;
let animationFrame = null;

// ===== TOGGLE SEND / MIC BUTTON =====
function toggleSendMic() {
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const micBtn = document.getElementById('micBtn');
    if (!sendBtn || !micBtn) return;
    
    if (input && (input.value.trim().length > 0 || (typeof selectedFile !== 'undefined' && selectedFile))) {
        sendBtn.style.display = 'flex';
        micBtn.style.display = 'none';
    } else {
        sendBtn.style.display = 'none';
        micBtn.style.display = 'flex';
    }
}

// ===== START RECORDING =====
async function startVoiceRecording() {
    if (voiceRecordingActive) return;
    
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        const options = {};
        if (MediaRecorder.isTypeSupported('audio/mp4')) {
            options.mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
            options.mimeType = 'audio/webm';
        }
        mediaRecorder = new MediaRecorder(audioStream, options);
        audioChunks = [];
        
        mediaRecorder.addEventListener('dataavailable', (event) => {
            if (event.data && event.data.size > 0) {
                audioChunks.push(event.data);
                console.log('[Voice] Chunk received, size:', event.data.size);
            }
        });
        
        mediaRecorder.addEventListener('stop', handleRecordingStop);
        
        // Set up real audio visualizer
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(audioStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        // Start recording (NO timeslice, as it can corrupt headers in some browsers)
        mediaRecorder.start();
        voiceRecordingActive = true;
        voiceStartTime = Date.now();
        
        // Show recording UI
        document.getElementById('messageInputArea').style.display = 'none';
        document.getElementById('voiceRecordBar').style.display = 'flex';
        
        // Start timer and visualizer
        updateVoiceTimer();
        voiceTimerInterval = setInterval(updateVoiceTimer, 1000);
        drawWaveform();
        
        console.log('[Voice] Recording started, MIME:', mediaRecorder.mimeType);
        
    } catch (err) {
        console.error('[Voice] Microphone error:', err);
        alert('Please allow microphone access to send voice messages.');
    }
}

let shouldSendVoice = false;

function handleRecordingStop() {
    console.log('[Voice] Recording stopped, chunks:', audioChunks.length, 'shouldSend:', shouldSendVoice);
    
    if (!shouldSendVoice) {
        cleanupRecording();
        return;
    }
    
    const mimeType = mediaRecorder ? mediaRecorder.mimeType : 'audio/webm';
    const audioBlob = new Blob(audioChunks, { type: mimeType });
    console.log('[Voice] Blob created, size:', audioBlob.size, 'type:', mimeType);
    
    const duration = (Date.now() - voiceStartTime) / 1000;
    
    if (audioBlob.size < 1000 || duration < 0.5) {
        console.warn('[Voice] Too short or too small, discarding');
        cleanupRecording();
        return;
    }
    
    // Test playback locally first
    const testUrl = URL.createObjectURL(audioBlob);
    const testAudio = new Audio(testUrl);
    testAudio.oncanplay = () => {
        console.log('[Voice] Local playback test OK, duration:', testAudio.duration);
        URL.revokeObjectURL(testUrl);
    };
    testAudio.onerror = (e) => {
        console.error('[Voice] Local playback test FAILED:', e);
    };
    
    // Determine extension
    let ext = 'webm';
    if (mimeType.includes('mp4')) ext = 'mp4';
    else if (mimeType.includes('ogg')) ext = 'ogg';
    else if (mimeType.includes('wav')) ext = 'wav';
    
    const fileName = `voice_${Date.now()}.${ext}`;
    const file = new File([audioBlob], fileName, { type: mimeType });
    
    cleanupRecording();
    uploadVoiceNote(file, duration);
}

// ===== UPDATE TIMER =====
function updateVoiceTimer() {
    const elapsed = Math.floor((Date.now() - voiceStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timerEl = document.getElementById('voiceTimer');
    if (timerEl) timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ===== AUDIO VISUALIZER =====
function drawWaveform() {
    if (!voiceRecordingActive || !analyser) return;
    
    animationFrame = requestAnimationFrame(drawWaveform);
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average volume
    let sum = 0;
    for(let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    const avg = sum / dataArray.length;
    
    // Scale 0-255 to 0-100%
    const scale = Math.min(100, (avg / 128) * 100);
    
    // Apply to all wave bars (or we could do individual, but let's keep it simple and reactive)
    const bars = document.querySelectorAll('.wave-bar');
    bars.forEach((bar, index) => {
        // Add some variation per bar
        const variation = (dataArray[index % dataArray.length] / 255) * 100;
        bar.style.height = Math.max(10, variation) + '%';
        bar.style.animation = 'none'; // disable CSS animation
    });
}

// ===== CANCEL RECORDING =====
function cancelVoiceRecording() {
    shouldSendVoice = false;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    } else {
        cleanupRecording();
    }
}

// ===== STOP AND SEND =====
function stopAndSendVoice() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    shouldSendVoice = true;
    mediaRecorder.stop();
}

// ===== UPLOAD VOICE NOTE =====
async function uploadVoiceNote(file, duration) {
    if (!activeConversationId) return;
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('caption', '');
    
    try {
        const res = await fetch(`${API_BASE}/api/chat/messages/${activeConversationId}/upload/`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body: formData,
        });
        if (res.ok) {
            const msg = await res.json();
            console.log('[Voice] Upload OK, file_url:', msg.file_url);
            messages.push(msg);
            renderMessages();
            scrollToBottom();
            loadConversations();
        } else {
            console.error('[Voice] Upload failed:', res.status);
        }
    } catch (e) {
        console.error('[Voice] Upload error:', e);
    }
}

// ===== CLEANUP =====
function cleanupRecording() {
    voiceRecordingActive = false;
    shouldSendVoice = false;
    audioChunks = [];
    
    if (animationFrame) cancelAnimationFrame(animationFrame);
    
    if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
    }
    
    if (voiceTimerInterval) {
        clearInterval(voiceTimerInterval);
        voiceTimerInterval = null;
    }
    
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    
    mediaRecorder = null;
    
    document.getElementById('voiceRecordBar').style.display = 'none';
    document.getElementById('messageInputArea').style.display = 'flex';
    
    // Reset visualizer bars
    document.querySelectorAll('.wave-bar').forEach(bar => {
        bar.style.height = '';
        bar.style.animation = ''; // restore CSS animation class
    });
}

// ===== VOICE NOTE PLAYER =====
// Uses browser's native <audio controls> for guaranteed playback
function renderVoicePlayer(fileUrl, msgId) {
    return `
        <div class="voice-note-player" id="vnp-${msgId}">
            <audio controls preload="auto" src="${fileUrl}" 
                   style="height:36px; max-width:280px; min-width:200px;"
                   id="vnAudio-${msgId}">
            </audio>
        </div>
    `;
}

// Placeholder for chat.js compatibility
function generateWaveformBars() { return ''; }

// ===== INITIALIZE =====
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(toggleSendMic, 600);
});
