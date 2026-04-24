from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from django.contrib.auth.models import User
from django.db.models import Q
from .serializers import RegisterSerializer, UserProfileSerializer, UserSearchSerializer
from .models import UserProfile


class RegisterView(generics.CreateAPIView):
    """Register a new user account."""
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response({
            'message': 'Account created successfully!',
            'user': {
                'id': user.id,
                'username': user.username,
                'email': user.email,
            }
        }, status=status.HTTP_201_CREATED)


class ProfileView(APIView):
    """Get or update the current user's profile."""
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        serializer = UserProfileSerializer(request.user.profile)
        return Response(serializer.data)

    def put(self, request):
        profile = request.user.profile
        # Handle avatar deletion explicitly
        if request.data.get('remove_avatar') == 'true':
            profile.avatar = None
            
        # Update profile fields
        if 'about' in request.data:
            profile.about = request.data['about']
        if 'chat_lock_pin' in request.data:
            profile.chat_lock_pin = request.data['chat_lock_pin']
        if 'avatar' in request.FILES:
            profile.avatar = request.FILES['avatar']
        profile.save()

        # Update user fields
        user = request.user
        if 'username' in request.data:
            user.username = request.data['username']
        if 'first_name' in request.data:
            user.first_name = request.data['first_name']
        if 'last_name' in request.data:
            user.last_name = request.data['last_name']
        user.save()

        serializer = UserProfileSerializer(profile)
        return Response(serializer.data)


class UserSearchView(APIView):
    """Search for users by username or phone number."""

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        if not query or len(query) < 2:
            return Response({'results': []})

        users = User.objects.filter(
            Q(username__icontains=query) |
            Q(first_name__icontains=query) |
            Q(last_name__icontains=query) |
            Q(profile__phone_number__icontains=query)
        ).exclude(id=request.user.id)[:20]

        serializer = UserSearchSerializer(users, many=True)
        return Response({'results': serializer.data})


class UserDetailView(APIView):
    """Get details of a specific user."""

    def get(self, request, user_id):
        try:
            user = User.objects.get(id=user_id)
            serializer = UserSearchSerializer(user)
            return Response(serializer.data)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=404)
