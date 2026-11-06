import os
import openai
from openai import OpenAI
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from dataclasses import dataclass, field

load_dotenv()

# Securely stored secret key, loaded from environment variables (or secure vault)
FERNET_SECRET_KEY = os.getenv('FERNET_SECRET_KEY')

if not FERNET_SECRET_KEY:
    raise Exception("FERNET_SECRET_KEY environment variable not set. Please set a secure key!")

fernet = Fernet(FERNET_SECRET_KEY)

# Utility function to encrypt API keys
def encrypt_key(api_key: str) -> str:
    return fernet.encrypt(api_key.encode()).decode()

# Utility function to decrypt API keys
def decrypt_key(token: str) -> str:
    return fernet.decrypt(token.encode()).decode()

@dataclass
class APIUsageTracker:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    images_generated: int = 0
    model_prices: dict = field(default_factory=lambda: {
        'gpt-4o': {'prompt': 0.0025, 'completion': 0.01}
    })

    def log_chat(self, prompt_tokens, completion_tokens):
        self.prompt_tokens += prompt_tokens
        self.completion_tokens += completion_tokens

    def log_image(self, num_images=1):
        self.images_generated += num_images

    def report(self):
        total_cost = (
            self.prompt_tokens / 1000 * self.model_prices['gpt-4o']['prompt'] +
            self.completion_tokens / 1000 * self.model_prices['gpt-4o']['completion']
        )
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "images_generated": self.images_generated,
            "chat_api_cost_usd": total_cost,
            "image_model": "gpt-image-2.5-flare" if self.images_generated else None,
            # Image cost depends on provider token usage; do not reuse DALL-E pricing.
            "total_api_cost_usd": None if self.images_generated else total_cost
        }

# Minimal prompt to test GPT-4o access
TEST_PROMPT = [{"role": "user", "content": "Test"}]

def authenticate_openai_key(api_key: str, test_model: str = "gpt-4o") -> tuple[bool, str]:
    client = OpenAI(api_key=api_key)

    try:
        client.chat.completions.create(
            model=test_model,
            messages=TEST_PROMPT,
            max_tokens=1,
        )
        return True, ""
    except openai.AuthenticationError:
        return False, "Invalid API key."
    except openai.PermissionDeniedError:
        return False, f"No access to the model: {test_model}. Please request access from OpenAI."
    except openai.RateLimitError as e:
        if hasattr(e, 'body') and 'insufficient_quota' in str(e.body):
            return False, ("Your API key has insufficient quota. "
                           "Please check your billing details and set up payment info at "
                           "https://platform.openai.com/account/billing/overview.")
        else:
            return False, f"Rate limit exceeded: {str(e)}"
    except openai.BadRequestError as e:
        return False, f"Bad request: {str(e)}"
    except openai.OpenAIError as e:
        return False, f"Unexpected OpenAI error: {str(e)}"