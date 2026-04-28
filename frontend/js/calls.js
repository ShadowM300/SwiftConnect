// ===== SwiftConnect Calls (WebRTC) =====

let peerConnection = null;
let localStream = null;
let currentCallType = null;
let currentCallTarget = null;
let currentCallId = null;
let incomingCallData = null;
let isMuted = false;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
    ]
};

function startCall(type) {
    if (!activeConversation || activeConversation.is_group) return;
    const other = activeConversation.participants.find(p => p.id !== currentUser.id);
    if (!other) return;

    currentCallType = type;
    currentCallTarget = other.id;
    currentCallId = null; // Will be set when server echoes call_initiated

    const otherName = (other.first_name || other.last_name)
        ? `${other.first_name} ${other.last_name}`.trim()
        : other.username;

    showCallOverlay(otherName, 'Calling...', false, type);
    initPeerConnection(true, type);
}

function showCallOverlay(name, status, showAccept, callType) {
    const overlay = document.getElementById('callOverlay');
    document.getElementById('callAvatar').textContent = getInitials(name);
    document.getElementById('callName').textContent = name;
    document.getElementById('callStatus').textContent = status;
    document.getElementById('acceptBtn').style.display = showAccept ? 'flex' : 'none';

    // Always show info panel initially; videoContainer shown after stream is ready
    document.getElementById('callInfo').style.display = 'block';
    document.getElementById('videoContainer').style.display = 'none';

    // Show camera toggle only for video calls
    const cameraBtn = document.getElementById('cameraBtn');
    if (cameraBtn) cameraBtn.style.display = callType === 'video' ? 'flex' : 'none';

    overlay.classList.add('active');
}

async function initPeerConnection(isCaller, type) {
    peerConnection = new RTCPeerConnection(rtcConfig);
    const constraints = { audio: true, video: type === 'video' };

    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        if (type === 'video') {
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = localStream;
            document.getElementById('videoContainer').style.display = 'block';
            document.getElementById('callInfo').style.display = 'none';
        }
    } catch (err) {
        console.error('Media access error:', err);
        let msg = 'Could not access camera/microphone.';
        if (err.name === 'NotReadableError') msg = 'Camera or microphone is already in use by another application.';
        else if (err.name === 'NotAllowedError') msg = 'Permission to access camera/microphone was denied.';
        else if (err.name === 'NotFoundError') msg = 'No camera or microphone found.';
        alert(msg);
        endCall();
        return false;
    }

    peerConnection.ontrack = (event) => {
        console.log('[RTC] Received remote track:', event.track.kind);
        if (!event.streams || !event.streams[0]) return;

        if (type === 'video') {
            // Video call: use the <video> element (handles both audio + video)
            const remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                // autoplay attribute handles playback
            }
            // Show video container when the video track arrives
            if (event.track.kind === 'video') {
                document.getElementById('videoContainer').style.display = 'block';
                document.getElementById('callInfo').style.display = 'none';
            }
        } else {
            // Voice call: route to hidden <audio> element (no visibility restrictions)
            const remoteAudio = document.getElementById('remoteAudio');
            if (remoteAudio && remoteAudio.srcObject !== event.streams[0]) {
                remoteAudio.srcObject = event.streams[0];
            }
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && callSocket && callSocket.readyState === WebSocket.OPEN) {
            console.log('[RTC] Sending ICE candidate');
            callSocket.send(JSON.stringify({
                type: 'ice_candidate',
                target_user_id: currentCallTarget,
                candidate: event.candidate,
            }));
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('[RTC] Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            const statusEl = document.getElementById('callStatus');
            if (statusEl) statusEl.textContent = 'Connected';
        } else if (peerConnection.connectionState === 'failed') {
            console.error('[RTC] Connection failed');
            endCall();
        }
    };

    if (isCaller) {
        console.log('[RTC] Creating offer');
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        callSocket.send(JSON.stringify({
            type: 'call_offer',
            target_user_id: currentCallTarget,
            call_type: type,
            sdp: offer,
        }));
    }
    return true;
}

function handleCallSignal(data) {
    const st = data.signal_type;
    console.log('[RTC] Received signal:', st, data);

    if (st === 'call_initiated') {
        // Server echoes the call_id back to the caller
        currentCallId = data.call_id;
        console.log('[RTC] Call ID assigned:', currentCallId);

    } else if (st === 'call_offer') {
        incomingCallData = data;
        currentCallTarget = data.caller_id;
        currentCallType = data.call_type;
        currentCallId = data.call_id;

        const overlay = document.getElementById('incomingCallOverlay');
        document.getElementById('inCallAvatar').textContent = getInitials(data.caller_name);
        document.getElementById('inCallName').textContent = data.caller_name;
        document.getElementById('inCallStatus').textContent = `Incoming ${data.call_type} call...`;
        overlay.classList.add('active');

    } else if (st === 'call_answer') {
        if (peerConnection && data.sdp) {
            console.log('[RTC] Setting remote description (answer)');
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
                .then(() => {
                    const statusEl = document.getElementById('callStatus');
                    if (statusEl) statusEl.textContent = 'Connected';
                })
                .catch(err => console.error('[RTC] setRemoteDescription error:', err));
        }

    } else if (st === 'ice_candidate') {
        if (peerConnection && data.candidate) {
            console.log('[RTC] Adding ICE candidate');
            peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                .catch(err => console.warn('[RTC] addIceCandidate error:', err));
        }

    } else if (st === 'call_end' || st === 'call_reject') {
        endCall();
    }
}

async function acceptIncomingCall() {
    console.log('[RTC] Accepting call');
    document.getElementById('incomingCallOverlay').classList.remove('active');

    const callerName = document.getElementById('inCallName').textContent;
    showCallOverlay(callerName, 'Connecting...', false, currentCallType);

    const success = await initPeerConnection(false, currentCallType);
    if (!success) return;

    if (incomingCallData && incomingCallData.sdp) {
        console.log('[RTC] Setting remote description (offer)');
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCallData.sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            console.log('[RTC] Sending answer');
            callSocket.send(JSON.stringify({
                type: 'call_answer',
                target_user_id: currentCallTarget,
                sdp: answer,
                call_id: currentCallId,
            }));
            document.getElementById('callStatus').textContent = 'Connected';
        } catch (err) {
            console.error('[RTC] Accept call error:', err);
            endCall();
        }
    }
}

function rejectIncomingCall() {
    document.getElementById('incomingCallOverlay').classList.remove('active');
    if (callSocket && callSocket.readyState === WebSocket.OPEN) {
        callSocket.send(JSON.stringify({
            type: 'call_reject',
            target_user_id: currentCallTarget,
            call_id: currentCallId,
        }));
    }
    cleanupCall();
}

function endCall() {
    // Guard: if already cleaned up (e.g. triggered by remote call_end), don't double-fire
    if (!currentCallTarget && !peerConnection) {
        document.getElementById('callOverlay').classList.remove('active');
        document.getElementById('incomingCallOverlay').classList.remove('active');
        return;
    }
    if (callSocket && callSocket.readyState === WebSocket.OPEN && currentCallTarget) {
        callSocket.send(JSON.stringify({
            type: 'call_end',
            target_user_id: currentCallTarget,
            call_id: currentCallId,
        }));
    }
    document.getElementById('callOverlay').classList.remove('active');
    document.getElementById('incomingCallOverlay').classList.remove('active');
    cleanupCall();
}

function cleanupCall() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    // Reset video/audio elements
    const remoteVideo = document.getElementById('remoteVideo');
    const localVideo = document.getElementById('localVideo');
    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteVideo) remoteVideo.srcObject = null;
    if (localVideo) localVideo.srcObject = null;
    if (remoteAudio) remoteAudio.srcObject = null;

    document.getElementById('videoContainer').style.display = 'none';
    document.getElementById('callInfo').style.display = 'block';
    document.getElementById('muteBtn').textContent = '🎤';

    currentCallTarget = null;
    currentCallId = null;
    currentCallType = null;
    incomingCallData = null;
    isMuted = false;
}

function toggleMute() {
    if (localStream) {
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
        document.getElementById('muteBtn').textContent = isMuted ? '🔇' : '🎤';
    }
}

function toggleCamera() {
    if (localStream && currentCallType === 'video') {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            document.getElementById('cameraBtn').textContent = videoTrack.enabled ? '📹' : '🚫';
        }
    }
}
