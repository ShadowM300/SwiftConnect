import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone


class PresenceConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for tracking online/offline presence."""

    # Class-level set to track connected users
    online_users = set()

    async def connect(self):
        self.user = self.scope.get('user')
        if self.user and self.user.is_authenticated:
            self.room_group_name = 'presence'
            await self.channel_layer.group_add(self.room_group_name, self.channel_name)
            await self.accept()

            # Mark user online
            PresenceConsumer.online_users.add(self.user.id)
            await self.set_online_status(True)

            # Broadcast online status to all
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'presence_update',
                    'user_id': self.user.id,
                    'username': self.user.username,
                    'is_online': True,
                }
            )

            # Send current online users list to this user
            await self.send(text_data=json.dumps({
                'type': 'online_users',
                'users': list(PresenceConsumer.online_users),
            }))
        else:
            await self.close()

    async def disconnect(self, close_code):
        if hasattr(self, 'user') and self.user and self.user.is_authenticated:
            PresenceConsumer.online_users.discard(self.user.id)
            await self.set_online_status(False)

            # Broadcast offline status
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'presence_update',
                    'user_id': self.user.id,
                    'username': self.user.username,
                    'is_online': False,
                }
            )
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        """Handle incoming presence messages (e.g., heartbeat)."""
        pass

    async def presence_update(self, event):
        """Send presence updates to WebSocket clients."""
        await self.send(text_data=json.dumps({
            'type': 'presence_update',
            'user_id': event['user_id'],
            'username': event['username'],
            'is_online': event['is_online'],
        }))

    @database_sync_to_async
    def set_online_status(self, is_online):
        """Update user's online status in the database."""
        profile = self.user.profile
        profile.is_online = is_online
        if not is_online:
            profile.last_seen = timezone.now()
        profile.save(update_fields=['is_online', 'last_seen'])
