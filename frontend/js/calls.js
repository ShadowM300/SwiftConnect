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
    ]
};

function startCall(type) {
    if (!activeConversation || activeConversation.is_group) return;
    const other = activeConversation.participants.find(p => p.id !== currentUser.id);
    if (!other) return;

    currentCallType = type;
    currentCallTarget = other.id;

    const overlay = document.getElementById('callOverlay');
    document.getElementById('callAvatar').textContent = getInitials(other.first_name + ' ' + other.last_name || other.username);
    document.getElementById('callName').textContent = other.first_name ? `${other.first_name} ${other.last_name}` : other.username;
    document.getElementById('callStatus').textContent = 'Calling...';
    document.getElementById('acceptBtn').style.display = 'none';
    overlay.classList.add('active');

    initPeerConnection(true, type);
}

async function initPeerConnection(isCaller, type) {
    peerConnection = new RTCPeerConnection(rtcConfig);
    const constraints = { audio: true, video: type === 'video' };

    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        if (type === 'video') {
            document.getElementById('localVideo').srcObject = localStream;
            document.getElementById('videoContainer').style.display = 'block';
            document.getElementById('callInfo').style.display = 'none';
        }
    } catch (err) {
        console.error('Media access error:', err);
        endCall();
        return;
    }

    peerConnection.ontrack = (event) => {
        if (type === 'video') {
            document.getElementById('remoteVideo').srcObject = event.streams[0];
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && callSocket && callSocket.readyState === WebSocket.OPEN) {
            callSocket.send(JSON.stringify({
                type: 'ice_candidate',
                target_user_id: currentCallTarget,
                candidate: event.candidate,
            }));
        }
    };

    if (isCaller) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        callSocket.send(JSON.stringify({
            type: 'call_offer',
            target_user_id: currentCallTarget,
            call_type: type,
            sdp: offer,
        }));
    }
}

function handleCallSignal(data) {
    const st = data.signal_type;

    if (st === 'call_offer') {
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
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            document.getElementById('callStatus').textContent = 'Connected';
        }

    } else if (st === 'ice_candidate') {
        if (peerConnection && data.candidate) {
            peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }

    } else if (st === 'call_end' || st === 'call_reject') {
        endCall();
    }
}

async function acceptIncomingCall() {
    document.getElementById('incomingCallOverlay').classList.remove('active');
    const overlay = document.getElementById('callOverlay');
    document.getElementById('callAvatar').textContent = document.getElementById('inCallAvatar').textContent;
    document.getElementById('callName').textContent = document.getElementById('inCallName').textContent;
    document.getElementById('callStatus').textContent = 'Connecting...';
    overlay.classList.add('active');

    await initPeerConnection(false, currentCallType);

    if (incomingCallData && incomingCallData.sdp) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCallData.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        callSocket.send(JSON.stringify({
            type: 'call_answer',
            target_user_id: currentCallTarget,
            sdp: answer,
            call_id: currentCallId,
        }));
        document.getElementById('callStatus').textContent = 'Connected';
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
    document.getElementById('videoContainer').style.display = 'none';
    document.getElementById('callInfo').style.display = '';
    currentCallTarget = null;
    currentCallId = null;
    isMuted = false;
}

function toggleMute() {
    if (localStream) {
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
        document.getElementById('muteBtn').textContent = isMuted ? '🔇' : '🎤';
    }
}
