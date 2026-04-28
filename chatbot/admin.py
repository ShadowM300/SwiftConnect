from django.contrib import admin
from .models import BotConversation, BotMessage, BotSettings


@admin.register(BotSettings)
class BotSettingsAdmin(admin.ModelAdmin):
    """Admin page to configure the Hugging Face API key and model."""
    list_display = ['model_name', 'max_history_messages']
    fieldsets = [
        ('API Configuration', {
            'fields': ['huggingface_api_key', 'model_name'],
            'description': 'Enter your Hugging Face API key and choose a model.'
        }),
        ('Bot Personality', {
            'fields': ['system_prompt', 'max_history_messages'],
        }),
    ]

    def has_add_permission(self, request):
        # Only allow one instance
        return not BotSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(BotConversation)
class BotConversationAdmin(admin.ModelAdmin):
    list_display = ['user', 'created_at', 'updated_at']
    readonly_fields = ['user', 'created_at', 'updated_at']


@admin.register(BotMessage)
class BotMessageAdmin(admin.ModelAdmin):
    list_display = ['conversation', 'role', 'short_content', 'timestamp']
    list_filter = ['role']
    readonly_fields = ['conversation', 'role', 'content', 'timestamp']

    def short_content(self, obj):
        return obj.content[:80]
    short_content.short_description = 'Content'
