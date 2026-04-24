from django.db import models
from django.contrib.auth.models import User


class CallLog(models.Model):
    """Log of voice/video calls between users."""
    CALL_TYPES = [
        ('voice', 'Voice'),
        ('video', 'Video'),
    ]
    STATUS_CHOICES = [
        ('ringing', 'Ringing'),
        ('answered', 'Answered'),
        ('missed', 'Missed'),
        ('ended', 'Ended'),
        ('rejected', 'Rejected'),
    ]

    caller = models.ForeignKey(User, on_delete=models.CASCADE, related_name='outgoing_calls')
    receiver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='incoming_calls')
    call_type = models.CharField(max_length=10, choices=CALL_TYPES)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ringing')
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        return f"{self.caller.username} -> {self.receiver.username} ({self.call_type})"
