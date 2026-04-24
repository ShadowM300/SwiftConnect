from django.contrib import admin
from .models import CallLog

@admin.register(CallLog)
class CallLogAdmin(admin.ModelAdmin):
    list_display = ['caller', 'receiver', 'call_type', 'status', 'started_at']
    list_filter = ['call_type', 'status']
