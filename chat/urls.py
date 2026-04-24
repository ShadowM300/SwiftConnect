from django.urls import path
from . import views

urlpatterns = [
    path('conversations/', views.ConversationListView.as_view(), name='conversation_list'),
    path('conversations/create/', views.ConversationCreateView.as_view(), name='conversation_create'),
    path('conversations/<int:conversation_id>/', views.ConversationDetailView.as_view(), name='conversation_detail'),
    path('groups/create/', views.GroupCreateView.as_view(), name='group_create'),
    path('groups/<int:conversation_id>/manage/', views.GroupManageView.as_view(), name='group_manage'),
    path('conversations/<int:conversation_id>/settings/', views.ConversationSettingView.as_view(), name='conversation-settings'),
    path('messages/<int:conversation_id>/', views.MessageListView.as_view(), name='message_list'),
    path('messages/<int:conversation_id>/upload/', views.FileUploadView.as_view(), name='file_upload'),
    
    # Status URLs
    path('status/', views.StatusListView.as_view(), name='status_list'),
    path('status/create/', views.StatusCreateView.as_view(), name='status_create'),
    path('status/<int:status_id>/like/', views.StatusLikeView.as_view(), name='status_like'),
    
    # Notifications
    path('notifications/', views.NotificationListView.as_view(), name='notification_list'),
    
    # Contact Profile
    path('contact/<int:user_id>/', views.ContactProfileView.as_view(), name='contact_profile'),
]
