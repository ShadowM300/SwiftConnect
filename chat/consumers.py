import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone


class ChatConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for real-time chat messaging."""

    async def connect(self):
        self.user = self.scope.get('user')
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']
        self.room_group_name = f'chat_{self.conversation_id}'

        if not self.user or not self.user.is_authenticated:
            await self.close()
            return

        # Verify user is participant
        is_participant = await self.check_participant()
        if not is_participant:
            await self.close()
            return

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        # Mark messages as delivered
        await self.mark_delivered()

    async def disconnect(self, close_code):
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get('type', 'message')

        if msg_type == 'message':
            is_blocked = await self.check_if_blocked()
            if is_blocked:
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'Cannot send messages to a blocked chat.'
                }))
                return

            message = await self.save_message(data.get('content', ''), data.get('reply_to'))
            if message:
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'chat_message',
                        'message': message,
                    }
                )
                # Update conversation timestamp
                await self.update_conversation()

        elif msg_type == 'typing':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'typing_indicator',
                    'user_id': self.user.id,
                    'username': self.user.username,
                    'is_typing': data.get('is_typing', True),
                }
            )

        elif msg_type == 'seen':
            message_id = data.get('message_id')
            if message_id:
                await self.mark_seen(message_id)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'message_status_update',
                        'message_id': message_id,
                        'user_id': self.user.id,
                        'status': 'seen',
                    }
                )

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message',
            'message': event['message'],
        }))

    async def typing_indicator(self, event):
        if event['user_id'] != self.user.id:
            await self.send(text_data=json.dumps({
                'type': 'typing',
                'user_id': event['user_id'],
                'username': event['username'],
                'is_typing': event['is_typing'],
            }))

    async def message_status_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'status_update',
            'message_id': event['message_id'],
            'user_id': event['user_id'],
            'status': event['status'],
        }))

    @database_sync_to_async
    def check_participant(self):
        from chat.models import Conversation
        return Conversation.objects.filter(
            id=self.conversation_id, participants=self.user
        ).exists()

    @database_sync_to_async
    def save_message(self, content, reply_to_id=None):
        from chat.models import Conversation, Message, MessageStatus
        try:
            conv = Conversation.objects.get(id=self.conversation_id)
            msg = Message.objects.create(
                conversation=conv,
                sender=self.user,
                content=content,
                message_type='text',
                reply_to_id=reply_to_id,
            )
            # Create status for all other participants
            for p in conv.participants.exclude(id=self.user.id):
                MessageStatus.objects.create(message=msg, user=p, status='sent')

            # Build reply_to_message object if applicable
            reply_to_message = None
            if reply_to_id:
                try:
                    reply_msg = Message.objects.get(id=reply_to_id)
                    reply_to_message = {
                        'id': reply_msg.id,
                        'sender': reply_msg.sender.id,
                        'sender_name': reply_msg.sender.username,
                        'content': reply_msg.content,
                        'message_type': reply_msg.message_type,
                    }
                except Message.DoesNotExist:
                    pass

            return {
                'id': msg.id,
                'sender': self.user.id,
                'sender_name': self.user.username,
                'content': msg.content,
                'message_type': 'text',
                'timestamp': msg.timestamp.isoformat(),
                'reply_to': reply_to_id,
                'reply_to_message': reply_to_message,
                'overall_status': 'sent',
                'is_deleted': False,
            }
        except Exception:
            return None

    @database_sync_to_async
    def mark_delivered(self):
        from chat.models import Message, MessageStatus
        messages = Message.objects.filter(
            conversation_id=self.conversation_id
        ).exclude(sender=self.user)
        for msg in messages:
            MessageStatus.objects.update_or_create(
                message=msg, user=self.user,
                defaults={'status': 'delivered'}
            )

    @database_sync_to_async
    def mark_seen(self, message_id):
        from chat.models import MessageStatus
        MessageStatus.objects.update_or_create(
            message_id=message_id, user=self.user,
            defaults={'status': 'seen'}
        )

    @database_sync_to_async
    def update_conversation(self):
        from chat.models import Conversation
        Conversation.objects.filter(id=self.conversation_id).update(updated_at=timezone.now())

    @database_sync_to_async
    def check_if_blocked(self):
        from chat.models import ConversationSetting
        return ConversationSetting.objects.filter(
            conversation_id=self.conversation_id,
            is_blocked=True
        ).exists()
