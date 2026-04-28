from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone
from datetime import timedelta


class UserProfile(models.Model):
    """Extended user profile with phone, avatar, and presence info."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    phone_number = models.CharField(max_length=15, unique=True, blank=True, null=True)
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    about = models.CharField(max_length=200, default='Hey there! I am using SwiftConnect')
    chat_lock_pin = models.CharField(max_length=4, blank=True, null=True)
    is_online = models.BooleanField(default=False)
    study_mode_active = models.BooleanField(default=False)
    last_seen = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username}'s profile"


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """Auto-create a UserProfile when a new User is created."""
    if created:
        UserProfile.objects.create(user=instance)


@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    """Auto-save UserProfile when User is saved."""
    if hasattr(instance, 'profile'):
        instance.profile.save()


class UserNote(models.Model):
    """A short daily note posted by a user — visible to contacts and expires after 24 hours."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='note')
    content = models.CharField(max_length=280, blank=True, default='')
    emoji = models.CharField(max_length=10, blank=True, default='📝')
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def save(self, *args, **kwargs):
        if not self.expires_at or not self.pk:
            self.expires_at = timezone.now() + timedelta(hours=24)
        super().save(*args, **kwargs)

    @property
    def is_active(self):
        """Returns True if the note has not yet expired."""
        return timezone.now() < self.expires_at

    @property
    def time_left_seconds(self):
        """Seconds until the note expires (0 if already expired)."""
        remaining = (self.expires_at - timezone.now()).total_seconds()
        return max(0, int(remaining))

    def __str__(self):
        return f"{self.user.username}'s note: {self.emoji} {self.content[:30]}"
