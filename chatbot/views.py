import json
import requests
import logging
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from .models import BotConversation, BotMessage, BotSettings

logger = logging.getLogger(__name__)

# Persistent HTTP session with connection pooling for faster API calls
_hf_session = requests.Session()
_adapter = HTTPAdapter(
    pool_connections=5,
    pool_maxsize=10,
    max_retries=Retry(total=1, backoff_factor=0.2)
)
_hf_session.mount('https://', _adapter)


class BotChatView(APIView):
    """Send a message to the AI bot and get a response."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user_message = request.data.get('message', '').strip()
        if not user_message:
            return Response({'error': 'Message cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)

        # Get bot settings
        settings = BotSettings.get_settings()
        if not settings.huggingface_api_key:
            return Response(
                {'error': 'AI bot is not configured. Please ask the admin to set the Hugging Face API key.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        # Get or create bot conversation for this user
        conversation, _ = BotConversation.objects.get_or_create(user=request.user)

        # Save user message
        BotMessage.objects.create(
            conversation=conversation,
            role='user',
            content=user_message
        )

        # Build conversation history — limit to last 6 messages for speed
        context_limit = min(settings.max_history_messages, 6)
        recent_messages = conversation.messages.order_by('-timestamp')[:context_limit]
        recent_messages = list(reversed(recent_messages))

        # Build the prompt for the model
        try:
            bot_reply = self._call_huggingface(settings, recent_messages)
        except Exception as e:
            logger.error(f"Hugging Face API error: {e}")
            bot_reply = "I'm sorry, I'm having trouble connecting right now. Please try again in a moment. 🔄"

        # Save bot response
        BotMessage.objects.create(
            conversation=conversation,
            role='assistant',
            content=bot_reply
        )

        # Update conversation timestamp
        conversation.save()

        return Response({
            'reply': bot_reply,
            'timestamp': conversation.updated_at.isoformat(),
        })

    def _call_huggingface(self, settings, messages):
        """Call the Hugging Face Inference API."""
        headers = {
            "Authorization": f"Bearer {settings.huggingface_api_key}",
            "Content-Type": "application/json",
        }

        # Build chat messages with system prompt
        chat_messages = [{"role": "system", "content": settings.system_prompt}]
        for msg in messages:
            chat_messages.append({
                "role": msg.role,
                "content": msg.content
            })

        # Use the official HF router chat completions endpoint
        chat_url = "https://router.huggingface.co/v1/chat/completions"
        payload = {
            "model": settings.model_name,
            "messages": chat_messages,
            "max_tokens": 512,
            "temperature": 0.7,
            "stream": False,
        }

        try:
            response = _hf_session.post(chat_url, headers=headers, json=payload, timeout=30)
            logger.info(f"HF API response status: {response.status_code}")

            if response.status_code == 200:
                data = response.json()
                if 'choices' in data and len(data['choices']) > 0:
                    return data['choices'][0]['message']['content'].strip()

            elif response.status_code == 503:
                return "The AI model is currently loading. Please try again in a few seconds. ⏳"

            elif response.status_code == 422:
                # Model may not support chat — fall back to text generation
                logger.warning(f"Chat format not supported, falling back to text generation")
                return self._call_text_generation(settings, headers, messages)

            # Log error for debugging
            error_detail = response.text[:300] if hasattr(response, 'text') else 'Unknown error'
            logger.error(f"HuggingFace API returned {response.status_code}: {error_detail}")

        except requests.exceptions.Timeout:
            return "The request timed out. The model might be loading — please try again. ⏳"
        except Exception as e:
            logger.error(f"HuggingFace API error: {e}")

        # Fallback to text generation endpoint
        try:
            return self._call_text_generation(settings, headers, messages)
        except Exception as e:
            logger.error(f"Text generation fallback also failed: {e}")

        return "I couldn't process that request right now. Please try again. 🔄"

    def _call_text_generation(self, settings, headers, messages):
        """Fallback: use the HF Inference API text generation endpoint."""
        api_url = f"https://api-inference.huggingface.co/models/{settings.model_name}"
        prompt = self._build_text_prompt(settings.system_prompt, messages)

        payload = {
            "inputs": prompt,
            "parameters": {
                "max_new_tokens": 512,
                "temperature": 0.7,
                "return_full_text": False,
                "do_sample": True,
            },
            "options": {
                "wait_for_model": True,
            }
        }

        response = _hf_session.post(api_url, headers=headers, json=payload, timeout=30)

        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list) and len(data) > 0:
                generated = data[0].get('generated_text', '').strip()
                if generated:
                    return generated
            elif isinstance(data, dict):
                generated = data.get('generated_text', '').strip()
                if generated:
                    return generated

        error_detail = response.text[:200] if hasattr(response, 'text') else 'Unknown error'
        logger.error(f"Text generation fallback returned {response.status_code}: {error_detail}")
        return "I couldn't process that request right now. Please try again. 🔄"

    def _build_text_prompt(self, system_prompt, messages):
        """Build a text prompt for models that don't support chat format."""
        prompt = f"<s>[INST] <<SYS>>\n{system_prompt}\n<</SYS>>\n\n"
        for msg in messages:
            if msg.role == 'user':
                prompt += f"[INST] {msg.content} [/INST]\n"
            else:
                prompt += f"{msg.content}\n"
        return prompt


class BotHistoryView(APIView):
    """Get the chat history with the AI bot."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            conversation = BotConversation.objects.get(user=request.user)
            messages = conversation.messages.order_by('timestamp')

            return Response({
                'messages': [
                    {
                        'role': msg.role,
                        'content': msg.content,
                        'timestamp': msg.timestamp.isoformat(),
                    }
                    for msg in messages
                ]
            })
        except BotConversation.DoesNotExist:
            return Response({'messages': []})


class BotClearView(APIView):
    """Clear the bot conversation history."""
    permission_classes = [IsAuthenticated]

    def delete(self, request):
        try:
            conversation = BotConversation.objects.get(user=request.user)
            conversation.messages.all().delete()
            return Response({'message': 'Conversation cleared'})
        except BotConversation.DoesNotExist:
            return Response({'message': 'No conversation to clear'})
