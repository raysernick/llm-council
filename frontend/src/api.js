/**
 * API client for the LLM Council backend with secure authorization headers.
 */

const API_BASE = `http://${window.location.hostname}:8001`;

const getHeaders = (extraHeaders = {}) => {
  const token = localStorage.getItem('llm_council_auth_token');
  return {
    ...extraHeaders,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

export const api = {
  /**
   * Log in user and receive session token.
   */
  async login(email, password) {
    const response = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Invalid email or password' }));
      throw new Error(err.detail || 'Login failed');
    }
    return response.json();
  },

  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      headers: getHeaders()
    });
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('llm_council_auth_token');
        window.location.reload();
      }
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: getHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      {
        headers: getHeaders()
      }
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content, settings = {}) {
    const {
      openrouterKey = '',
      azureEndpoint = '',
      azureKey = '',
      azureApiVersion = '',
      councilModels = null,
      chairmanModel = null
    } = settings || {};

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: getHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          content,
          api_keys: openrouterKey ? { openrouter: openrouterKey } : null,
          azure_settings: (azureKey || azureEndpoint) ? {
            api_key: azureKey,
            endpoint: azureEndpoint,
            api_version: azureApiVersion
          } : null,
          council_models: councilModels,
          chairman_model: chairmanModel
        }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   */
  async sendMessageStream(conversationId, content, settings, onEvent) {
    let actualSettings = settings;
    let actualOnEvent = onEvent;
    if (typeof settings === 'function') {
      actualOnEvent = settings;
      actualSettings = {};
    }

    const {
      openrouterKey = '',
      azureEndpoint = '',
      azureKey = '',
      azureApiVersion = '',
      councilModels = null,
      chairmanModel = null
    } = actualSettings || {};

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: getHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          content,
          api_keys: openrouterKey ? { openrouter: openrouterKey } : null,
          azure_settings: (azureKey || azureEndpoint) ? {
            api_key: azureKey,
            endpoint: azureEndpoint,
            api_version: azureApiVersion
          } : null,
          council_models: councilModels,
          chairman_model: chairmanModel
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('llm_council_auth_token');
        window.location.reload();
      }
      throw new Error('Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            actualOnEvent(event.type, event);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }
    }
  },
};
