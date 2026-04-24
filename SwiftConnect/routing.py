"""
WebSocket URL routing for SwiftConnect.
"""

from django.urls import re_path
from chat.consumers import ChatConsumer
from accounts.consumers import PresenceConsumer
from calls.consumers import CallSignalingConsumer

websocket_urlpatterns = [
    re_path(r'ws/chat/(?P<conversation_id>\d+)/$', ChatConsumer.as_asgi()),
    re_path(r'ws/presence/$', PresenceConsumer.as_asgi()),
    re_path(r'ws/calls/$', CallSignalingConsumer.as_asgi()),
]
