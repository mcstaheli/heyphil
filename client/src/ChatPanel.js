import React, { useState, useEffect, useRef } from 'react';
import './ChatPanel.css';

function ChatPanel({ isOpen, onClose, apiBaseUrl, authHeaders }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionKey, setSessionKey] = useState(null);
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
      startPolling();
    } else {
      stopPolling();
    }
    
    return () => stopPolling();
  }, [isOpen]);

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
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages);
      }
    } catch (error) {
      // Silent fail - don't spam console during polling
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || loading) return;

    const userMessage = {
      role: 'user',
      content: inputText,
      timestamp: new Date().toISOString()
    };

    // Optimistically add user message
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/chat/send`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: inputText,
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
          <button className="chat-close" onClick={onClose}>✕</button>
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
          <input
            type="text"
            placeholder="Type your message..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={loading}
            autoFocus
          />
          <button type="submit" disabled={!inputText.trim() || loading}>
            ➤
          </button>
        </form>
      </div>
    </div>
  );
}

export default ChatPanel;
