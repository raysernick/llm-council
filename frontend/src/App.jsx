import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import SettingsModal from './components/SettingsModal';
import Login from './components/Login';
import { api } from './api';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const [authToken, setAuthToken] = useState(localStorage.getItem('llm_council_auth_token') || '');
  const [userEmail, setUserEmail] = useState(localStorage.getItem('llm_council_user_email') || '');

  const [settings, setSettings] = useState({
    openrouterKey: '',
    azureEndpoint: '',
    azureKey: '',
    azureApiVersion: '2024-06-01',
    councilModels: ['openai/gpt-5.1', 'google/gemini-3-pro-preview', 'anthropic/claude-sonnet-4.5', 'x-ai/grok-4'],
    chairmanModel: 'google/gemini-3-pro-preview'
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const saved = localStorage.getItem('llm_council_settings');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved settings:', e);
      }
    }
  }, []);

  const handleSaveSettings = (newSettings) => {
    setSettings(newSettings);
    localStorage.setItem('llm_council_settings', JSON.stringify(newSettings));
  };

  const handleLoginSuccess = (token, email) => {
    setAuthToken(token);
    setUserEmail(email);
    localStorage.setItem('llm_council_auth_token', token);
    localStorage.setItem('llm_council_user_email', email);
  };

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out?')) {
      setAuthToken('');
      setUserEmail('');
      localStorage.removeItem('llm_council_auth_token');
      localStorage.removeItem('llm_council_user_email');
      setConversations([]);
      setCurrentConversationId(null);
      setCurrentConversation(null);
    }
  };

  // Load conversations when authenticated
  useEffect(() => {
    if (authToken) {
      loadConversations();
    }
  }, [authToken]);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId && authToken) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId, authToken]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = async () => {
    try {
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const handleSendMessage = async (content) => {
    if (!currentConversationId) return;

    setIsLoading(true);
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Create a partial assistant message that will be updated progressively
      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      // Send message with streaming
      await api.sendMessageStream(currentConversationId, content, settings, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            setCurrentConversation((prev) => {
              if (!prev || !prev.messages || prev.messages.length === 0) return prev;
              const messages = prev.messages.map((msg, idx) => {
                if (idx === prev.messages.length - 1) {
                  return {
                    ...msg,
                    loading: { ...msg.loading, stage1: true }
                  };
                }
                return msg;
              });
              return { ...prev, messages };
            });
            break;

          case 'stage1_complete':
            setCurrentConversation((prev) => {
              if (!prev || !prev.messages || prev.messages.length === 0) return prev;
              const messages = prev.messages.map((msg, idx) => {
                if (idx === prev.messages.length - 1) {
                  return {
                    ...msg,
                    stage1: event.data,
                    loading: { ...msg.loading, stage1: false }
                  };
                }
                return msg;
              });
              return { ...prev, messages };
            });
            break;

          case 'stage2_start':
            setCurrentConversation((prev) => {
              if (!prev || !prev.messages || prev.messages.length === 0) return prev;
              const messages = prev.messages.map((msg, idx) => {
                if (idx === prev.messages.length - 1) {
                  return {
                    ...msg,
                    loading: { ...msg.loading, stage2: true }
                  };
                }
                return msg;
              });
              return { ...prev, messages };
            });
            break;

          case 'stage2_complete':
            setCurrentConversation((prev) => {
              if (!prev || !prev.messages || prev.messages.length === 0) return prev;
              const messages = prev.messages.map((msg, idx) => {
                if (idx === prev.messages.length - 1) {
                  return {
                    ...msg,
                    stage2: event.data,
                    metadata: event.metadata,
                    loading: { ...msg.loading, stage2: false }
                  };
                }
                return msg;
              });
              return { ...prev, messages };
            });
            break;

          case 'stage3_start':
            setCurrentConversation((prev) => {
              if (!prev || !prev.messages || prev.messages.length === 0) return prev;
              const messages = prev.messages.map((msg, idx) => {
                if (idx === prev.messages.length - 1) {
                  return {
                    ...msg,
                    loading: { ...msg.loading, stage3: true }
                  };
                }
                return msg;
              });
              return { ...prev, messages };
            });
            break;

          case 'stage3_complete':
            setCurrentConversation((prev) => {
              if (!prev || !prev.messages || prev.messages.length === 0) return prev;
              const messages = prev.messages.map((msg, idx) => {
                if (idx === prev.messages.length - 1) {
                  return {
                    ...msg,
                    stage3: event.data,
                    loading: { ...msg.loading, stage3: false }
                  };
                }
                return msg;
              });
              return { ...prev, messages };
            });
            break;

          case 'title_complete':
            // Reload conversations to get updated title
            loadConversations();
            break;

          case 'complete':
            // Stream complete, reload conversations list
            loadConversations();
            setIsLoading(false);
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setIsLoading(false);
            break;

          default:
            console.log('Unknown event type:', eventType);
        }
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
    }
  };

  if (!authToken) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLogout={handleLogout}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
        currentSettings={settings}
      />
    </div>
  );
}

export default App;
