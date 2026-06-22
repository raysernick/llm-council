"""OpenRouter and Azure OpenAI client for making LLM requests."""

import httpx
import os
from typing import List, Dict, Any, Optional
from .config import OPENROUTER_API_KEY, OPENROUTER_API_URL


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 120.0,
    api_keys: Optional[Dict[str, str]] = None,
    azure_settings: Optional[Dict[str, Any]] = None
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via OpenRouter or Azure OpenAI.

    Args:
        model: Model identifier (e.g., "openai/gpt-4o" or "azure/deployment-name")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds
        api_keys: Optional dictionary of API keys (e.g. {'openrouter': '...'})
        azure_settings: Optional dictionary of Azure settings (endpoint, api_key, api_version)

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    if model.startswith("azure/"):
        # Azure OpenAI Mode
        # Extract deployment name from model identifier (e.g. "azure/gpt-4o" -> "gpt-4o")
        deployment = model.split("/", 1)[1] if "/" in model else model

        # Get Azure credentials (passed parameters first, fallback to config/env)
        endpoint = None
        api_key = None
        api_version = "2024-06-01"

        if azure_settings:
            endpoint = azure_settings.get("endpoint")
            api_key = azure_settings.get("api_key")
            api_version = azure_settings.get("api_version") or "2024-06-01"

        if not endpoint:
            from .config import AZURE_OPENAI_ENDPOINT
            endpoint = AZURE_OPENAI_ENDPOINT
        if not api_key:
            from .config import AZURE_OPENAI_API_KEY
            api_key = AZURE_OPENAI_API_KEY
        if not api_version or api_version == "2024-06-01":
            from .config import AZURE_OPENAI_API_VERSION
            api_version = AZURE_OPENAI_API_VERSION or "2024-06-01"

        if not endpoint or not api_key:
            print(f"Error querying Azure OpenAI model {model}: endpoint or API key not configured.")
            return None

        # Construct Azure OpenAI Chat Completion URL
        base_url = endpoint.rstrip("/")
        url = f"{base_url}/openai/deployments/{deployment}/chat/completions?api-version={api_version}"

        headers = {
            "api-key": api_key,
            "Content-Type": "application/json",
        }
        payload = {
            "messages": messages,
        }
    else:
        # OpenRouter Mode
        openrouter_key = None
        if api_keys:
            openrouter_key = api_keys.get("openrouter")
        
        if not openrouter_key:
            openrouter_key = OPENROUTER_API_KEY

        headers = {
            "Authorization": f"Bearer {openrouter_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": messages,
        }
        url = OPENROUTER_API_URL

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url,
                headers=headers,
                json=payload
            )
            response.raise_for_status()

            data = response.json()
            message = data['choices'][0]['message']

            return {
                'content': message.get('content'),
                'reasoning_details': message.get('reasoning_details')
            }

    except Exception as e:
        print(f"Error querying model {model}: {e}")
        if 'response' in locals() and hasattr(response, 'text'):
            print(f"Response body: {response.text}")
        return None


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, str]],
    api_keys: Optional[Dict[str, str]] = None,
    azure_settings: Optional[Dict[str, Any]] = None
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel.

    Args:
        models: List of model identifiers
        messages: List of message dicts to send to each model
        api_keys: Optional dictionary of API keys
        azure_settings: Optional Azure OpenAI settings

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    import asyncio

    # Create tasks for all models
    tasks = [
        query_model(model, messages, api_keys=api_keys, azure_settings=azure_settings) 
        for model in models
    ]

    # Wait for all to complete
    responses = await asyncio.gather(*tasks)

    # Map models to their responses
    return {model: response for model, response in zip(models, responses)}
