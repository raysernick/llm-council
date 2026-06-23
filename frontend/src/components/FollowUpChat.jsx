import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './FollowUpChat.css';

export default function FollowUpChat({
  messageIndex,
  availableModels,
  followups,
  onSendFollowup,
  isLoading,
}) {
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(availableModels[0] || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && selectedModel && !isLoading) {
      onSendFollowup(messageIndex, input, selectedModel);
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="followup-chat">
      <h4 className="followup-title">Continue Discussion</h4>
      <p className="followup-desc">
        Continue the conversation with a specific council member.
      </p>

      {followups.length > 0 && (
        <div className="followup-messages">
          {followups.map((msg, idx) => (
            <div
              key={idx}
              className={`followup-bubble ${msg.role === 'user' ? 'user-followup' : 'assistant-followup'}`}
            >
              <div className="followup-bubble-label">
                {msg.role === 'user' ? (
                  <>You → {msg.model ? msg.model.split('/')[1] || msg.model : selectedModel}</>
                ) : (
                  <>{msg.model ? msg.model.split('/')[1] || msg.model : 'Assistant'}</>
                )}
              </div>
              <div className="followup-bubble-content markdown-content">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}

      <form className="followup-form" onSubmit={handleSubmit}>
        <div className="followup-model-select">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isLoading}
          >
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {model.split('/')[1] || model}
              </option>
            ))}
          </select>
        </div>
        <div className="followup-input-row">
          <textarea
            className="followup-input"
            placeholder="Ask a follow-up question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={2}
          />
          <button
            type="submit"
            className="followup-send-btn"
            disabled={!input.trim() || !selectedModel || isLoading}
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
