"""
ASGI config for SwiftConnect project.
Routes HTTP and WebSocket connections.
"""

import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'SwiftConnect.settings')
django.setup()

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from django.core.asgi import get_asgi_application
from SwiftConnect.routing import websocket_urlpatterns
from SwiftConnect.middleware import JWTAuthMiddleware

application = ProtocolTypeRouter({
    'http': get_asgi_application(),
    'websocket': JWTAuthMiddleware(
        URLRouter(websocket_urlpatterns)
    ),
})
