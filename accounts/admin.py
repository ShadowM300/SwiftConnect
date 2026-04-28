from django.contrib import admin
from .models import UserProfile, UserNote

@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'phone_number', 'is_online', 'last_seen']
    search_fields = ['user__username', 'phone_number']

@admin.register(UserNote)
class UserNoteAdmin(admin.ModelAdmin):
    list_display = ['user', 'emoji', 'content', 'created_at', 'expires_at']
    search_fields = ['user__username', 'content']
    readonly_fields = ['created_at', 'expires_at']
