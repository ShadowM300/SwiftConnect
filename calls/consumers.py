import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async


class CallSignalingConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for WebRTC call signaling."""

    async def connect(self):
        self.user = self.scope.get('user')
        if not self.user or not self.user.is_authenticated:
            await self.close()
            return

        self.user_channel = f'calls_{self.user.id}'
        await self.channel_layer.group_add(self.user_channel, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'user_channel'):
            await self.channel_layer.group_discard(self.user_channel, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        signal_type = data.get('type')
        target_user_id = data.get('target_user_id')

        if not target_user_id:
            return

        target_channel = f'calls_{target_user_id}'

        if signal_type == 'call_offer':
            call_log = await self.create_call_log(target_user_id, data.get('call_type', 'voice'))
            await self.channel_layer.group_send(target_channel, {
                'type': 'call_signal',
                'signal_type': 'call_offer',
                'caller_id': self.user.id,
                'caller_name': self.user.username,
                'call_type': data.get('call_type', 'voice'),
                'sdp': data.get('sdp'),
                'call_id': call_log,
            })

        elif signal_type == 'call_answer':
            await self.update_call_status(data.get('call_id'), 'answered')
            await self.channel_layer.group_send(target_channel, {
                'type': 'call_signal',
                'signal_type': 'call_answer',
                'caller_id': self.user.id,
                'sdp': data.get('sdp'),
            })

        elif signal_type == 'call_reject':
            await self.update_call_status(data.get('call_id'), 'rejected')
            await self.channel_layer.group_send(target_channel, {
                'type': 'call_signal',
                'signal_type': 'call_reject',
                'caller_id': self.user.id,
            })

        elif signal_type == 'call_end':
            await self.update_call_status(data.get('call_id'), 'ended')
            await self.channel_layer.group_send(target_channel, {
                'type': 'call_signal',
                'signal_type': 'call_end',
                'caller_id': self.user.id,
            })

        elif signal_type == 'ice_candidate':
            await self.channel_layer.group_send(target_channel, {
                'type': 'call_signal',
                'signal_type': 'ice_candidate',
                'caller_id': self.user.id,
                'candidate': data.get('candidate'),
            })

    async def call_signal(self, event):
        await self.send(text_data=json.dumps(event))

    @database_sync_to_async
    def create_call_log(self, receiver_id, call_type):
        from django.contrib.auth.models import User
        from .models import CallLog
        try:
            receiver = User.objects.get(id=receiver_id)
            log = CallLog.objects.create(
                caller=self.user, receiver=receiver, call_type=call_type
            )
            return log.id
        except Exception:
            return None

    @database_sync_to_async
    def update_call_status(self, call_id, status):
        from .models import CallLog
        from django.utils import timezone
        if call_id:
            CallLog.objects.filter(id=call_id).update(
                status=status,
                ended_at=timezone.now() if status in ['ended', 'rejected', 'missed'] else None
            )
