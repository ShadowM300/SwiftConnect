from django.db import models
from django.contrib.auth.models import User


class BotConversation(models.Model):
    """Stores a user's conversation history with the AI bot."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='bot_conversation')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Bot conversation for {self.user.username}"


class BotMessage(models.Model):
    """A single message in a bot conversation."""
    ROLE_CHOICES = [
        ('user', 'User'),
        ('assistant', 'Assistant'),
    ]

    conversation = models.ForeignKey(BotConversation, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=10, choices=ROLE_CHOICES)
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['timestamp']

    def __str__(self):
        return f"[{self.role}] {self.content[:50]}"


class BotSettings(models.Model):
    """Global settings for the AI chatbot (singleton)."""
    huggingface_api_key = models.CharField(max_length=255, blank=True, default='')
    model_name = models.CharField(
        max_length=255,
        default='meta-llama/Meta-Llama-3-8B-Instruct',
        help_text='Hugging Face model ID for text generation'
    )
    system_prompt = models.TextField(
        default=(
            "You are SwiftConnect AI, a friendly and helpful assistant built into the SwiftConnect messaging app. "
            "You can help with questions, writing, coding, math, creative tasks, and general knowledge. "
            "Keep your responses concise, helpful, and conversational. "
            "Use markdown formatting when appropriate for code blocks and lists."
        ),
        help_text='System prompt that defines the bot personality'
    )
    max_history_messages = models.IntegerField(
        default=20,
        help_text='Maximum number of past messages to include as context'
    )

    class Meta:
        verbose_name = 'Bot Settings'
        verbose_name_plural = 'Bot Settings'

    def __str__(self):
        return f"Bot Settings (Model: {self.model_name})"

    def save(self, *args, **kwargs):
        # Ensure only one instance exists (singleton)
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_settings(cls):
        """Get or create the singleton settings instance."""
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
