import React, { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import './ChatPanel.css';

function ChatPanel({ isOpen, onClose, apiBaseUrl, authHeaders }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionKey, setSessionKey] = useState(null);
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Get session info on mount
  useEffect(() => {
    if (isOpen) {
      fetchSessionInfo();
    } else {
      stopPolling();
    }
    
    return () => stopPolling();
  }, [isOpen]);
  
  // Start polling when we have a session key
  useEffect(() => {
    if (isOpen && sessionKey) {
      console.log('🔄 Starting message polling (every 3s)');
      startPolling();
    }
    return () => stopPolling();
  }, [isOpen, sessionKey]);

  const fetchSessionInfo = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/chat/session`, {
        headers: authHeaders()
      });
      const data = await response.json();
      setSessionKey(data.sessionKey);
      if (data.recentMessages) {
        setMessages(data.recentMessages);
      }
    } catch (error) {
      console.error('Failed to fetch session info:', error);
    }
  };

  const startPolling = () => {
    // Poll for new messages every 3 seconds
    pollIntervalRef.current = setInterval(() => {
      fetchNewMessages();
    }, 3000);
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const fetchNewMessages = async () => {
    if (!sessionKey) return;
    
    try {
      const response = await fetch(`${apiBaseUrl}/api/chat/messages?sessionKey=${sessionKey}`, {
        headers: authHeaders()
      });
      const data = await response.json();
      
      console.log('📥 Polled for messages:', data.messages?.length || 0, 'messages');
      
      if (data.messages && data.messages.length > 0) {
        // Always update messages to catch new ones
        setMessages(data.messages);
        console.log('✅ Messages updated');
      }
    } catch (error) {
      console.error('❌ Polling error:', error);
    }
  };

  const takeScreenshot = async () => {
    setScreenshotLoading(true);
    try {
      // Capture the entire document body, excluding the chat panel
      const chatPanel = document.querySelector('.chat-panel');
      if (chatPanel) {
        chatPanel.style.display = 'none';
      }

      const canvas = await html2canvas(document.body, {
        allowTaint: true,
        useCORS: true,
        backgroundColor: '#f5f5f5',
        scale: 1
      });

      if (chatPanel) {
        chatPanel.style.display = '';
      }

      const dataUrl = canvas.toDataURL('image/png');
      setScreenshot(dataUrl);
      setInputText('🖼️ Screenshot attached - ');
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      alert('Failed to capture screenshot. Please try again.');
    } finally {
      setScreenshotLoading(false);
    }
  };

  const clearScreenshot = () => {
    setScreenshot(null);
    if (inputText.startsWith('🖼️ Screenshot attached - ')) {
      setInputText('');
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || loading) return;

    let messageContent = inputText;
    
    // If there's a screenshot, mention it in the message
    if (screenshot) {
      messageContent = inputText + '\n\n[Screenshot attached - see image above]';
    }

    const userMessage = {
      role: 'user',
      content: messageContent,
      timestamp: new Date().toISOString(),
      screenshot: screenshot || undefined
    };

    // Optimistically add user message
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    const capturedScreenshot = screenshot;
    setScreenshot(null);
    setLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/chat/send`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: messageContent,
          screenshot: capturedScreenshot,
          sessionKey
        })
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      // Message sent successfully - responses will come via polling
      // Don't add any placeholder response
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ Sorry, I encountered an error sending your message. Please try again.',
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="chat-panel-overlay" onClick={onClose}>
      <div className="chat-panel" onClick={(e) => e.stopPropagation()}>
        <div className="chat-header">
          <div className="chat-title">
            <span className="chat-icon">💬</span>
            <h3>Chat with Phil</h3>
          </div>
          <div className="chat-header-actions">
            <button 
              className="chat-screenshot-btn" 
              onClick={takeScreenshot}
              disabled={screenshotLoading}
              title="Take screenshot for bug report or feature request"
            >
              {screenshotLoading ? '⏳' : '📸'}
            </button>
            <button className="chat-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="chat-messages">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <p>👋 Hi! I'm Phil, your AI assistant.</p>
              <p>Ask me anything about your projects!</p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`chat-message ${msg.role}`}>
                <div className="message-avatar">
                  {msg.role === 'user' ? '👤' : '🤖'}
                </div>
                <div className="message-content">
                  {msg.screenshot && (
                    <div className="message-screenshot">
                      <img src={msg.screenshot} alt="Screenshot" />
                    </div>
                  )}
                  <div className="message-text">{msg.content}</div>
                  <div className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="chat-message assistant">
              <div className="message-avatar">🤖</div>
              <div className="message-content">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="chat-input-form" onSubmit={sendMessage}>
          {screenshot && (
            <div className="screenshot-preview">
              <img src={screenshot} alt="Screenshot preview" />
              <button 
                type="button" 
                className="screenshot-remove" 
                onClick={clearScreenshot}
                title="Remove screenshot"
              >
                ✕
              </button>
              <p className="screenshot-hint">Screenshot attached - Add your message below</p>
            </div>
          )}
          <div className="input-row">
            <input
              type="text"
              placeholder={screenshot ? "Describe the issue or feature request..." : "Type your message..."}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={loading}
              autoFocus
            />
            <button type="submit" disabled={!inputText.trim() || loading}>
              ➤
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ChatPanel;
