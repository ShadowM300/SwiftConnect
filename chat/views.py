from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.contrib.auth.models import User
from django.db.models import Q
from .models import Conversation, Message, MessageStatus
from .serializers import (
    ConversationSerializer, ConversationCreateSerializer,
    MessageSerializer, GroupCreateSerializer
)


class ConversationListView(generics.ListAPIView):
    """List all conversations for the current user."""
    serializer_class = ConversationSerializer

    def get_queryset(self):
        return Conversation.objects.filter(
            participants=self.request.user
        ).prefetch_related('participants', 'participants__profile', 'messages')


class ConversationCreateView(APIView):
    """Create or get a 1-on-1 conversation with another user."""
    parser_classes = [JSONParser]

    def post(self, request):
        serializer = ConversationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        other_user_id = serializer.validated_data['user_id']
        other_user = User.objects.get(id=other_user_id)

        if other_user == request.user:
            return Response({'error': 'Cannot chat with yourself'}, status=400)

        # Check if conversation already exists
        conversations = Conversation.objects.filter(
            is_group=False,
            participants=request.user
        ).filter(
            participants=other_user
        )

        # Filter to find the exact 1-on-1 (not a group that has both)
        for conv in conversations:
            if conv.participants.count() == 2:
                return Response(
                    ConversationSerializer(conv, context={'request': request}).data,
                    status=status.HTTP_200_OK
                )

        # Create new conversation
        conversation = Conversation.objects.create(
            is_group=False,
            created_by=request.user
        )
        conversation.participants.add(request.user, other_user)

        return Response(
            ConversationSerializer(conversation, context={'request': request}).data,
            status=status.HTTP_201_CREATED
        )


class GroupCreateView(APIView):
    """Create a new group conversation."""
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def post(self, request):
        serializer = GroupCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        group = Conversation.objects.create(
            is_group=True,
            group_name=serializer.validated_data['group_name'],
            created_by=request.user
        )
        group.participants.add(request.user)

        for uid in serializer.validated_data['participant_ids']:
            try:
                user = User.objects.get(id=uid)
                group.participants.add(user)
            except User.DoesNotExist:
                pass

        if 'group_icon' in request.FILES:
            group.group_icon = request.FILES['group_icon']
            group.save()

        return Response(
            ConversationSerializer(group, context={'request': request}).data,
            status=status.HTTP_201_CREATED
        )


class GroupManageView(APIView):
    """Add/remove members from a group, rename group."""

    def put(self, request, conversation_id):
        try:
            conversation = Conversation.objects.get(
                id=conversation_id, is_group=True, participants=request.user
            )
        except Conversation.DoesNotExist:
            return Response({'error': 'Group not found'}, status=404)

        action = request.data.get('action')

        if action == 'add_member':
            user_id = request.data.get('user_id')
            try:
                user = User.objects.get(id=user_id)
                conversation.participants.add(user)
                return Response({'message': f'{user.username} added to group'})
            except User.DoesNotExist:
                return Response({'error': 'User not found'}, status=404)

        elif action == 'remove_member':
            user_id = request.data.get('user_id')
            try:
                user = User.objects.get(id=user_id)
                conversation.participants.remove(user)
                return Response({'message': f'{user.username} removed from group'})
            except User.DoesNotExist:
                return Response({'error': 'User not found'}, status=404)

        elif action == 'rename':
            new_name = request.data.get('group_name')
            if new_name:
                conversation.group_name = new_name
                conversation.save()
                return Response({'message': 'Group renamed'})

        return Response({'error': 'Invalid action'}, status=400)


class MessageListView(generics.ListAPIView):
    """Get paginated messages for a conversation."""
    serializer_class = MessageSerializer

    def get_queryset(self):
        conversation_id = self.kwargs['conversation_id']
        return Message.objects.filter(
            conversation_id=conversation_id,
            conversation__participants=self.request.user
        ).select_related('sender', 'sender__profile', 'reply_to').prefetch_related('message_statuses')

    def list(self, request, *args, **kwargs):
        conversation_id = self.kwargs['conversation_id']
        
        # Check if conversation is locked
        from .models import ConversationSetting
        setting = ConversationSetting.objects.filter(user=request.user, conversation_id=conversation_id).first()
        if setting and setting.is_locked:
            pin = request.headers.get('X-Chat-Pin')
            if not pin or pin != request.user.profile.chat_lock_pin:
                return Response({'error': 'Chat is locked. Invalid PIN.'}, status=403)
                
        response = super().list(request, *args, **kwargs)
        # Mark messages as seen when fetched
        messages = Message.objects.filter(
            conversation_id=conversation_id
        ).exclude(sender=request.user)

        for msg in messages:
            MessageStatus.objects.update_or_create(
                message=msg,
                user=request.user,
                defaults={'status': 'seen'}
            )
        return response


class FileUploadView(APIView):
    """Upload files (images, videos, documents) up to 100MB."""
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, conversation_id):
        try:
            conversation = Conversation.objects.get(
                id=conversation_id, participants=request.user
            )
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=404)

        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'No file provided'}, status=400)

        # Determine message type from content type
        content_type = file.content_type or ''
        if content_type.startswith('image/'):
            msg_type = 'image'
        elif content_type.startswith('video/'):
            msg_type = 'video'
        elif content_type.startswith('audio/'):
            msg_type = 'audio'
        else:
            msg_type = 'file'

        message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            content=request.data.get('caption', ''),
            message_type=msg_type,
            file=file,
            file_name=file.name,
            file_size=file.size,
        )

        # Update conversation timestamp
        conversation.save()

        # Create sent status for all other participants
        for participant in conversation.participants.exclude(id=request.user.id):
            MessageStatus.objects.create(
                message=message,
                user=participant,
                status='sent'
            )

        serializer = MessageSerializer(message, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ConversationSettingView(APIView):
    """Toggle settings (mute, block, archive, lock) for a conversation."""
    def put(self, request, conversation_id):
        try:
            conversation = Conversation.objects.get(
                id=conversation_id, participants=request.user
            )
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=404)

        from .models import ConversationSetting
        setting, created = ConversationSetting.objects.get_or_create(
            user=request.user, conversation=conversation
        )

        if 'is_muted' in request.data:
            setting.is_muted = request.data['is_muted']
        if 'is_archived' in request.data:
            setting.is_archived = request.data['is_archived']
        if 'is_locked' in request.data:
            setting.is_locked = request.data['is_locked']
        if 'is_blocked' in request.data:
            setting.is_blocked = request.data['is_blocked']
            
        setting.save()
        return Response({'message': 'Settings updated'})


class ConversationDetailView(APIView):
    """Get a single conversation's details."""

    def get(self, request, conversation_id):
        try:
            conversation = Conversation.objects.get(
                id=conversation_id, participants=request.user
            )
            serializer = ConversationSerializer(conversation, context={'request': request})
            return Response(serializer.data)
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=404)


class StatusListView(generics.ListAPIView):
    """Get active statuses from all users you've chatted with or yourself."""
    def get(self, request):
        from .models import Status
        from .serializers import StatusSerializer
        from django.utils import timezone
        import datetime
        
        # 24 hours ago
        time_threshold = timezone.now() - datetime.timedelta(hours=24)
        
        # Users we have conversations with
        contact_ids = User.objects.filter(conversations__participants=request.user).values_list('id', flat=True)
        
        statuses = Status.objects.filter(
            timestamp__gte=time_threshold
        ).filter(
            Q(user=request.user) | Q(user_id__in=contact_ids)
        ).select_related('user', 'user__profile').prefetch_related('likes')

        serializer = StatusSerializer(statuses, many=True, context={'request': request})
        return Response(serializer.data)


class StatusCreateView(APIView):
    """Create a new status."""
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        from .models import Status
        from .serializers import StatusSerializer
        
        file = request.FILES.get('file')
        content = request.data.get('content', '')
        
        if not file and not content:
            return Response({'error': 'Must provide text or file'}, status=400)
            
        status_type = 'text'
        if file:
            content_type = file.content_type or ''
            if content_type.startswith('image/'):
                status_type = 'image'
            elif content_type.startswith('video/'):
                status_type = 'video'
                
        status_obj = Status.objects.create(
            user=request.user,
            content=content,
            file=file,
            status_type=status_type
        )
        
        serializer = StatusSerializer(status_obj, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class StatusLikeView(APIView):
    """Like or unlike a status."""
    def post(self, request, status_id):
        from .models import Status, StatusLike, Notification
        
        try:
            status_obj = Status.objects.get(id=status_id)
        except Status.DoesNotExist:
            return Response({'error': 'Status not found'}, status=404)
            
        like, created = StatusLike.objects.get_or_create(
            status=status_obj,
            user=request.user
        )
        
        if created:
            # Create notification
            if status_obj.user != request.user:
                Notification.objects.create(
                    user=status_obj.user,
                    sender=request.user,
                    notification_type='status_like',
                    status=status_obj
                )
            return Response({'message': 'Liked'})
        else:
            like.delete()
            return Response({'message': 'Unliked'})


class NotificationListView(generics.ListAPIView):
    """Get user's notifications and mark as read."""
    def get(self, request):
        from .models import Notification
        from .serializers import NotificationSerializer
        
        notifications = Notification.objects.filter(user=request.user).order_by('-timestamp')
        serializer = NotificationSerializer(notifications, many=True)
        
        # Mark all as read
        notifications.filter(is_read=False).update(is_read=True)
        
        return Response(serializer.data)


class ContactProfileView(APIView):
    """Get public profile of a user for the Contact Info panel."""
    def get(self, request, user_id):
        try:
            user = User.objects.get(id=user_id)
            profile = getattr(user, 'profile', None)
            
            avatar_url = None
            if profile and profile.avatar:
                avatar_url = request.build_absolute_uri(profile.avatar.url)
                
            return Response({
                'id': user.id,
                'username': user.username,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'about': profile.about if profile else 'Hey there! I am using SwiftConnect',
                'phone_number': profile.phone_number if profile else None,
                'avatar': avatar_url,
                'is_online': profile.is_online if profile else False,
            })
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=404)
