from django.urls import path
from . import views

urlpatterns = [
    path('chat/', views.BotChatView.as_view(), name='bot_chat'),
    path('history/', views.BotHistoryView.as_view(), name='bot_history'),
    path('clear/', views.BotClearView.as_view(), name='bot_clear'),
]
