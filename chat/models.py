from django.db import models
from django.contrib.auth.models import User


class Conversation(models.Model):
    """A conversation between two or more users (individual or group)."""
    is_group = models.BooleanField(default=False)
    group_name = models.CharField(max_length=100, blank=True, null=True)
    group_icon = models.ImageField(upload_to='group_icons/', blank=True, null=True)
    participants = models.ManyToManyField(User, related_name='conversations')
    hidden_participants = models.ManyToManyField(User, related_name='hidden_in_conversations', blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_conversations')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        if self.is_group:
            return f"Group: {self.group_name}"
        users = self.participants.all()
        return f"Chat: {', '.join([u.username for u in users[:2]])}"

    def get_last_message(self):
        return self.messages.order_by('-timestamp').first()

    def get_unread_count(self, user):
        return self.messages.exclude(sender=user).exclude(
            message_statuses__user=user,
            message_statuses__status='seen'
        ).count()


class Message(models.Model):
    """A single message within a conversation."""
    MESSAGE_TYPES = [
        ('text', 'Text'),
        ('image', 'Image'),
        ('video', 'Video'),
        ('audio', 'Audio'),
        ('file', 'File'),
    ]

    STATUS_CHOICES = [
        ('sent', 'Sent'),
        ('delivered', 'Delivered'),
        ('seen', 'Seen'),
    ]

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    content = models.TextField(blank=True, null=True)
    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPES, default='text')
    file = models.FileField(upload_to='chat_files/%Y/%m/%d/', blank=True, null=True)
    file_name = models.CharField(max_length=255, blank=True, null=True)
    file_size = models.BigIntegerField(default=0)
    timestamp = models.DateTimeField(auto_now_add=True)
    reply_to = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='replies')
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ['timestamp']

    def __str__(self):
        return f"{self.sender.username}: {self.content[:30] if self.content else self.message_type}"


class MessageStatus(models.Model):
    """Tracks per-recipient delivery and read status of each message."""
    STATUS_CHOICES = [
        ('sent', 'Sent'),
        ('delivered', 'Delivered'),
        ('seen', 'Seen'),
    ]

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='message_statuses')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='sent')
    timestamp = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('message', 'user')

    def __str__(self):
        return f"{self.message.id} - {self.user.username}: {self.status}"


class ConversationSetting(models.Model):
    """Per-user settings for a conversation (mute, block, archive, lock, favourite, report)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='chat_settings')
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='settings')
    is_muted = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    is_locked = models.BooleanField(default=False)
    is_blocked = models.BooleanField(default=False)
    is_favourite = models.BooleanField(default=False)
    is_reported = models.BooleanField(default=False)
    advanced_privacy = models.BooleanField(default=False)
    is_study_allowed = models.BooleanField(default=False)
    cleared_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        unique_together = ('user', 'conversation')

    def __str__(self):
        return f"{self.user.username} settings for {self.conversation.id}"


class StarredMessage(models.Model):
    """A message starred/bookmarked by a user."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='starred_messages')
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='starred_by')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'message')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.username} starred message {self.message.id}"


class Status(models.Model):
    """Temporary status update (text or media) that expires after 24 hours."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='statuses')
    content = models.TextField(blank=True, null=True)
    file = models.FileField(upload_to='status_files/%Y/%m/%d/', blank=True, null=True)
    status_type = models.CharField(max_length=10, choices=[('text', 'Text'), ('image', 'Image'), ('video', 'Video')], default='text')
    timestamp = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f"Status by {self.user.username} at {self.timestamp}"


class StatusLike(models.Model):
    """Tracks likes on a status update."""
    status = models.ForeignKey(Status, on_delete=models.CASCADE, related_name='likes')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='liked_statuses')
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('status', 'user')


class Notification(models.Model):
    """Simple notification system for events like status likes."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_notifications')
    notification_type = models.CharField(max_length=20, default='status_like')
    status = models.ForeignKey(Status, on_delete=models.CASCADE, blank=True, null=True)
    is_read = models.BooleanField(default=False)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']
