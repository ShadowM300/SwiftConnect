from rest_framework import serializers
from django.contrib.auth.models import User
from .models import UserProfile, UserNote


class UserProfileSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source='user.id', read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    email = serializers.EmailField(source='user.email', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)

    class Meta:
        model = UserProfile
        fields = ['id', 'username', 'email', 'first_name', 'last_name',
                  'phone_number', 'avatar', 'about', 'chat_lock_pin', 'is_online', 'study_mode_active', 'last_seen']
        read_only_fields = ['is_online', 'last_seen']


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    password2 = serializers.CharField(write_only=True, min_length=6)
    phone_number = serializers.CharField(max_length=15, required=False)

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'password2',
                  'first_name', 'last_name', 'phone_number']

    def validate(self, data):
        if data['password'] != data['password2']:
            raise serializers.ValidationError({'password': 'Passwords do not match.'})
        if User.objects.filter(email=data.get('email', '')).exists():
            raise serializers.ValidationError({'email': 'Email already registered.'})
        return data

    def create(self, validated_data):
        phone_number = validated_data.pop('phone_number', None)
        validated_data.pop('password2')
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data.get('email', ''),
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
        )
        if phone_number:
            user.profile.phone_number = phone_number
            user.profile.save()
        return user


class UserSearchSerializer(serializers.ModelSerializer):
    """Serializer for search results — minimal user info."""
    phone_number = serializers.CharField(source='profile.phone_number', read_only=True)
    avatar = serializers.ImageField(source='profile.avatar', read_only=True)
    about = serializers.CharField(source='profile.about', read_only=True)
    is_online = serializers.BooleanField(source='profile.is_online', read_only=True)
    active_note = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name',
                  'phone_number', 'avatar', 'about', 'is_online', 'active_note']

    def get_active_note(self, obj):
        try:
            note = obj.note
            if note.is_active and note.content:
                return {
                    'content': note.content,
                    'emoji': note.emoji,
                    'time_left_seconds': note.time_left_seconds,
                    'created_at': note.created_at.isoformat(),
                }
        except UserNote.DoesNotExist:
            pass
        return None


class NoteSerializer(serializers.ModelSerializer):
    """Serializer for the current user's note."""
    is_active = serializers.BooleanField(read_only=True)
    time_left_seconds = serializers.IntegerField(read_only=True)

    class Meta:
        model = UserNote
        fields = ['id', 'content', 'emoji', 'created_at', 'expires_at', 'is_active', 'time_left_seconds']
        read_only_fields = ['id', 'created_at', 'expires_at', 'is_active', 'time_left_seconds']
