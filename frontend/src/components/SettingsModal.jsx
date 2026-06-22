import { useState, useEffect } from 'react';
import './SettingsModal.css';

export default function SettingsModal({ isOpen, onClose, onSave, currentSettings }) {
  const [activeTab, setActiveTab] = useState('api'); // 'api' or 'models'
  
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [azureEndpoint, setAzureEndpoint] = useState('');
  const [azureKey, setAzureKey] = useState('');
  const [azureApiVersion, setAzureApiVersion] = useState('2024-06-01');
  
  const [councilModels, setCouncilModels] = useState('');
  const [chairmanModel, setChairmanModel] = useState('');

  const [showORKey, setShowORKey] = useState(false);
  const [showAzureKey, setShowAzureKey] = useState(false);

  // Load current settings when modal opens
  useEffect(() => {
    if (isOpen && currentSettings) {
      setOpenrouterKey(currentSettings.openrouterKey || '');
      setAzureEndpoint(currentSettings.azureEndpoint || '');
      setAzureKey(currentSettings.azureKey || '');
      setAzureApiVersion(currentSettings.azureApiVersion || '2024-06-01');
      
      const modelsList = currentSettings.councilModels 
        ? currentSettings.councilModels.join('\n')
        : ['openai/gpt-5.1', 'google/gemini-3-pro-preview', 'anthropic/claude-sonnet-4.5', 'x-ai/grok-4'].join('\n');
      setCouncilModels(modelsList);
      
      setChairmanModel(currentSettings.chairmanModel || 'google/gemini-3-pro-preview');
    }
  }, [isOpen, currentSettings]);

  if (!isOpen) return null;

  const handleSave = () => {
    // Parse models list from text area
    const modelsArray = councilModels
      .split('\n')
      .map(m => m.trim())
      .filter(m => m.length > 0);

    onSave({
      openrouterKey,
      azureEndpoint,
      azureKey,
      azureApiVersion,
      councilModels: modelsArray,
      chairmanModel: chairmanModel.trim()
    });
    onClose();
  };

  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset settings to default values?')) {
      setOpenrouterKey('');
      setAzureEndpoint('');
      setAzureKey('');
      setAzureApiVersion('2024-06-01');
      setCouncilModels(['openai/gpt-5.1', 'google/gemini-3-pro-preview', 'anthropic/claude-sonnet-4.5', 'x-ai/grok-4'].join('\n'));
      setChairmanModel('google/gemini-3-pro-preview');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Council Configurations</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-tabs">
          <button 
            className={`modal-tab-btn ${activeTab === 'api' ? 'active' : ''}`}
            onClick={() => setActiveTab('api')}
          >
            API Credentials
          </button>
          <button 
            className={`modal-tab-btn ${activeTab === 'models' ? 'active' : ''}`}
            onClick={() => setActiveTab('models')}
          >
            Council Models
          </button>
        </div>

        <div className="modal-body">
          {activeTab === 'api' && (
            <div className="settings-section animate-fade">
              <h3>OpenRouter Credentials</h3>
              <p className="section-desc">Used for default LLM models queried through the OpenRouter service.</p>
              <div className="form-group">
                <label htmlFor="or-key">OpenRouter API Key</label>
                <div className="password-input-wrapper">
                  <input
                    id="or-key"
                    type={showORKey ? 'text' : 'password'}
                    placeholder="sk-or-v1-..."
                    value={openrouterKey}
                    onChange={(e) => setOpenrouterKey(e.target.value)}
                  />
                  <button 
                    type="button" 
                    className="toggle-visibility-btn" 
                    onClick={() => setShowORKey(!showORKey)}
                  >
                    {showORKey ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div className="divider" />

              <h3>Azure OpenAI Credentials</h3>
              <p className="section-desc">Required to run your local Azure OpenAI deployments in the council.</p>
              
              <div className="form-group">
                <label htmlFor="azure-endpoint">Azure Endpoint URL</label>
                <input
                  id="azure-endpoint"
                  type="text"
                  placeholder="https://your-resource.openai.azure.com/"
                  value={azureEndpoint}
                  onChange={(e) => setAzureEndpoint(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="azure-key">Azure API Key</label>
                <div className="password-input-wrapper">
                  <input
                    id="azure-key"
                    type={showAzureKey ? 'text' : 'password'}
                    placeholder="Enter Azure OpenAI key"
                    value={azureKey}
                    onChange={(e) => setAzureKey(e.target.value)}
                  />
                  <button 
                    type="button" 
                    className="toggle-visibility-btn" 
                    onClick={() => setShowAzureKey(!showAzureKey)}
                  >
                    {showAzureKey ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="azure-version">API Version</label>
                <input
                  id="azure-version"
                  type="text"
                  placeholder="2024-06-01"
                  value={azureApiVersion}
                  onChange={(e) => setAzureApiVersion(e.target.value)}
                />
              </div>
            </div>
          )}

          {activeTab === 'models' && (
            <div className="settings-section animate-fade">
              <h3>Council Members</h3>
              <p className="section-desc">
                Define the model identifiers (one per line) that participate in Stage 1 and Stage 2.
                <br />
                <strong>Azure tip:</strong> Prefix Azure deployment models with <code>azure/</code> (e.g. <code>azure/my-gpt-4o</code>).
              </p>
              <div className="form-group">
                <label htmlFor="council-models">Models List</label>
                <textarea
                  id="council-models"
                  rows={6}
                  placeholder="e.g.&#10;openai/gpt-4o&#10;azure/gpt-4o-deployment"
                  value={councilModels}
                  onChange={(e) => setCouncilModels(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="chairman-model">Chairman Model</label>
                <p className="section-desc">Model used to synthesize the final result in Stage 3.</p>
                <input
                  id="chairman-model"
                  type="text"
                  placeholder="e.g. google/gemini-3-pro-preview or azure/gpt-4o"
                  value={chairmanModel}
                  onChange={(e) => setChairmanModel(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary btn-reset" onClick={handleReset}>
            Reset Defaults
          </button>
          <div className="footer-actions">
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave}>
              Save Configurations
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
