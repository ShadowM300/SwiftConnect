from rest_framework import serializers
from django.contrib.auth.models import User
from .models import Conversation, Message, MessageStatus


class MessageStatusSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = MessageStatus
        fields = ['user', 'username', 'status', 'timestamp']


class ReplyMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source='sender.username', read_only=True)

    class Meta:
        model = Message
        fields = ['id', 'sender', 'sender_name', 'content', 'message_type']


class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source='sender.username', read_only=True)
    sender_avatar = serializers.SerializerMethodField()
    statuses = MessageStatusSerializer(source='message_statuses', many=True, read_only=True)
    reply_to_message = ReplyMessageSerializer(source='reply_to', read_only=True)
    file_url = serializers.SerializerMethodField()
    overall_status = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ['id', 'conversation', 'sender', 'sender_name', 'sender_avatar',
                  'content', 'message_type', 'file', 'file_url', 'file_name',
                  'file_size', 'timestamp', 'reply_to', 'reply_to_message',
                  'is_deleted', 'statuses', 'overall_status']
        read_only_fields = ['sender', 'timestamp']

    def get_file_url(self, obj):
        if obj.file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None

    def get_sender_avatar(self, obj):
        if hasattr(obj.sender, 'profile') and obj.sender.profile.avatar:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.sender.profile.avatar.url)
            return obj.sender.profile.avatar.url
        return None

    def get_overall_status(self, obj):
        """Get the lowest status among all recipients (worst case)."""
        statuses = obj.message_statuses.all()
        if not statuses:
            return 'sent'
        status_order = {'sent': 0, 'delivered': 1, 'seen': 2}
        min_status = min(statuses, key=lambda s: status_order.get(s.status, 0))
        return min_status.status


class ParticipantSerializer(serializers.ModelSerializer):
    avatar = serializers.SerializerMethodField()
    is_online = serializers.BooleanField(source='profile.is_online', read_only=True)
    about = serializers.CharField(source='profile.about', read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'avatar', 'is_online', 'about']

    def get_avatar(self, obj):
        if hasattr(obj, 'profile') and obj.profile.avatar:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.profile.avatar.url)
            return obj.profile.avatar.url
        return None


class ConversationSettingSerializer(serializers.ModelSerializer):
    class Meta:
        from .models import ConversationSetting
        model = ConversationSetting
        fields = ['is_muted', 'is_archived', 'is_locked', 'is_blocked', 'is_favourite', 'is_reported', 'advanced_privacy', 'is_study_allowed']

class ConversationSerializer(serializers.ModelSerializer):
    participants = ParticipantSerializer(many=True, read_only=True)
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    display_avatar = serializers.SerializerMethodField()
    settings = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = ['id', 'is_group', 'group_name', 'group_icon', 'participants',
                  'created_by', 'hidden_participants', 'created_at', 'updated_at', 'last_message',
                  'unread_count', 'display_name', 'display_avatar', 'settings']

    def get_last_message(self, obj):
        request = self.context.get('request')
        qs = obj.messages.all()
        if request and request.user:
            setting = obj.settings.filter(user=request.user).first()
            if setting and setting.cleared_at:
                qs = qs.filter(timestamp__gte=setting.cleared_at)
                
        msg = qs.order_by('-timestamp').first()
        if msg:
            return {
                'content': msg.content if not msg.is_deleted else 'This message was deleted',
                'sender': msg.sender.username,
                'sender_id': msg.sender.id,
                'timestamp': msg.timestamp.isoformat(),
                'message_type': msg.message_type,
            }
        return None

    def get_unread_count(self, obj):
        request = self.context.get('request')
        if request and request.user:
            qs = obj.messages.exclude(sender=request.user)
            setting = obj.settings.filter(user=request.user).first()
            if setting and setting.cleared_at:
                qs = qs.filter(timestamp__gte=setting.cleared_at)
                
            return qs.exclude(
                message_statuses__user=request.user,
                message_statuses__status='seen'
            ).count()
        return 0

    def get_display_name(self, obj):
        if obj.is_group:
            return obj.group_name
        request = self.context.get('request')
        if request:
            other = obj.participants.exclude(id=request.user.id).first()
            if other:
                name = f"{other.first_name} {other.last_name}".strip()
                return name if name else other.username
        return 'Unknown'

    def get_display_avatar(self, obj):
        if obj.is_group and obj.group_icon:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.group_icon.url)
            return obj.group_icon.url
        if not obj.is_group:
            request = self.context.get('request')
            if request:
                other = obj.participants.exclude(id=request.user.id).first()
                if other and hasattr(other, 'profile') and other.profile.avatar:
                    return request.build_absolute_uri(other.profile.avatar.url)
        return None

    def get_settings(self, obj):
        request = self.context.get('request')
        if request and request.user:
            setting = obj.settings.filter(user=request.user).first()
            if setting:
                return ConversationSettingSerializer(setting).data
        return {
            'is_muted': False,
            'is_archived': False,
            'is_locked': False,
            'is_blocked': False,
            'is_favourite': False,
            'is_reported': False,
            'advanced_privacy': False,
            'is_study_allowed': False,
        }


class ConversationCreateSerializer(serializers.Serializer):
    """Create a new 1-on-1 conversation."""
    user_id = serializers.IntegerField()

    def validate_user_id(self, value):
        if not User.objects.filter(id=value).exists():
            raise serializers.ValidationError('User not found.')
        return value


class GroupCreateSerializer(serializers.Serializer):
    """Create a new group conversation."""
    group_name = serializers.CharField(max_length=100)
    participant_ids = serializers.ListField(child=serializers.IntegerField(), min_length=1)

class StatusLikeSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    
    class Meta:
        from .models import StatusLike
        model = StatusLike
        fields = ['id', 'user', 'username', 'first_name', 'timestamp']


class StatusSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    avatar = serializers.SerializerMethodField()
    likes = StatusLikeSerializer(many=True, read_only=True)
    likes_count = serializers.SerializerMethodField()

    class Meta:
        from .models import Status
        model = Status
        fields = ['id', 'user', 'username', 'avatar', 'content', 'file', 'status_type', 'timestamp', 'likes', 'likes_count']

    def get_avatar(self, obj):
        request = self.context.get('request')
        if hasattr(obj.user, 'profile') and obj.user.profile.avatar:
            if request:
                return request.build_absolute_uri(obj.user.profile.avatar.url)
            return obj.user.profile.avatar.url
        return None

    def get_likes_count(self, obj):
        return obj.likes.count()


class NotificationSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source='sender.username', read_only=True)
    status_preview = serializers.SerializerMethodField()

    class Meta:
        from .models import Notification
        model = Notification
        fields = ['id', 'sender_name', 'notification_type', 'status', 'status_preview', 'is_read', 'timestamp']

    def get_status_preview(self, obj):
        if obj.status:
            return obj.status.content[:30] if obj.status.content else obj.status.status_type
        return ""
