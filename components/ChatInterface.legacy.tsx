import React, { useState, useRef, useEffect } from 'react';
import { Search, MoreVertical, Plus, Send, ArrowLeft, Bot } from 'lucide-react';

interface Message {
  id: string;
  sender: 'customer' | 'ai';
  text: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  phone: string;
  lastMessage: string;
  timestamp: string;
  messages: Message[];
}

const mockConversations: Conversation[] = [
  {
    id: '1',
    phone: '+1 (555) 123-4567',
    lastMessage: 'Thanks for the help!',
    timestamp: '5m ago',
    messages: [
      { id: 'm1', sender: 'customer', text: 'Hi, I need help with my order.', timestamp: '10:00 AM' },
      { id: 'm2', sender: 'ai', text: 'Hello! I can help with that. Could you please provide your order number?', timestamp: '10:01 AM' },
      { id: 'm3', sender: 'customer', text: 'It is ORDER-12345.', timestamp: '10:02 AM' },
      { id: 'm4', sender: 'ai', text: 'Thank you. I see your order is currently being processed and will ship tomorrow.', timestamp: '10:05 AM' },
      { id: 'm5', sender: 'customer', text: 'Thanks for the help!', timestamp: '10:10 AM' },
    ]
  },
  {
    id: '2',
    phone: '+1 (555) 987-6543',
    lastMessage: 'Where is my refund?',
    timestamp: '1h ago',
    messages: [
      { id: 'm1', sender: 'customer', text: 'I returned my item last week but havent got the refund.', timestamp: 'Yesterday' },
      { id: 'm2', sender: 'ai', text: 'I apologize for the delay. Returns typically take 3-5 business days to process after we receive them.', timestamp: 'Yesterday' },
      { id: 'm3', sender: 'customer', text: 'Where is my refund?', timestamp: '1h ago' },
    ]
  }
];

export default function ChatInterface() {
  const [conversations, setConversations] = useState(mockConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeConversation = conversations.find(c => c.id === activeConversationId);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeConversation?.messages]);

  const handleSendMessage = () => {
    if (!inputText.trim() || !activeConversationId) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      sender: 'ai',
      text: inputText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setConversations(prev => prev.map(conv => {
      if (conv.id === activeConversationId) {
        return {
          ...conv,
          lastMessage: inputText,
          timestamp: 'Just now',
          messages: [...conv.messages, newMessage]
        };
      }
      return conv;
    }));

    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'; // Reset height
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const selectConversation = (id: string) => {
    setActiveConversationId(id);
    setIsMobileChatOpen(true);
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden font-sans">
      {/* Conversation List (Left Sidebar) */}
      <div className={`w-full md:w-[30%] bg-white border-r border-gray-200 flex flex-col ${isMobileChatOpen ? 'hidden md:flex' : 'flex'}`}>
        {/* Header */}
        <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center h-16 shrink-0">
          <h1 className="font-semibold text-lg text-gray-800">Messages</h1>
          <MoreVertical className="w-5 h-5 text-gray-600 cursor-pointer" />
        </div>
        
        {/* Search */}
        <div className="p-3 border-b border-gray-200 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search or start new chat" 
              className="w-full bg-gray-100 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {conversations.map(conv => (
            <div 
              key={conv.id}
              onClick={() => selectConversation(conv.id)}
              className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors flex items-start gap-3
                ${activeConversationId === conv.id ? 'bg-blue-50' : ''}`}
            >
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 text-blue-600 font-semibold">
                {conv.phone.slice(-4)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <h2 className="font-semibold text-gray-900 truncate pr-2">{conv.phone}</h2>
                  <span className="text-xs text-gray-500 whitespace-nowrap">{conv.timestamp}</span>
                </div>
                <p className="text-sm text-gray-600 truncate">{conv.lastMessage}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Window (Right Side) */}
      <div className={`flex-1 flex-col bg-[#efeae2] ${!isMobileChatOpen ? 'hidden md:flex' : 'flex'} w-full md:w-[70%]`}>
        {activeConversation ? (
          <>
            {/* Chat Header */}
            <div className="h-16 bg-white border-b border-gray-200 flex items-center px-4 shadow-sm z-10 shrink-0">
              <button 
                onClick={() => setIsMobileChatOpen(false)}
                className="md:hidden mr-3 p-1 rounded-full hover:bg-gray-100"
              >
                <ArrowLeft className="w-6 h-6 text-gray-600" />
              </button>
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 text-blue-600 font-semibold mr-3">
                {activeConversation.phone.slice(-4)}
              </div>
              <div className="flex-1">
                <h2 className="font-semibold text-gray-900">{activeConversation.phone}</h2>
                <p className="text-xs text-blue-600 hidden md:block">Customer</p>
              </div>
              <MoreVertical className="w-5 h-5 text-gray-600 cursor-pointer" />
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto w-full p-4 space-y-4" style={{ backgroundImage: 'linear-gradient(rgba(239, 234, 226, 0.9), rgba(239, 234, 226, 0.9)), url("https://static.whatsapp.net/rsrc.php/v3/yl/r/rSpsOheX4tX.png")', backgroundRepeat: 'repeat', backgroundSize: '400px', backgroundBlendMode: 'overlay' }}>
              {activeConversation.messages.map(msg => (
                <div 
                  key={msg.id} 
                  className={`flex ${msg.sender === 'ai' ? 'justify-end' : 'justify-start'} w-full`}
                >
                  <div className={`max-w-[85%] md:max-w-[70%] px-4 py-2 relative shadow-sm text-sm md:text-base flex flex-col
                    ${msg.sender === 'ai' ? 'bg-purple-600 text-white rounded-2xl rounded-tr-sm' : 'bg-white text-gray-900 rounded-2xl rounded-tl-sm'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {msg.sender === 'ai' && (
                        <div className="flex items-center gap-1 opacity-80 text-xs font-medium">
                          <Bot className="w-3 h-3" />
                          <span>AI Assistant</span>
                        </div>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                    <div className={`text-[10px] mt-1 text-right block
                      ${msg.sender === 'ai' ? 'text-purple-200' : 'text-gray-400'}`}>
                      {msg.timestamp}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="bg-white p-3 border-t border-gray-200 flex items-end gap-2 shrink-0">
              <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors flex-shrink-0 mb-1">
                <Plus className="w-6 h-6" />
              </button>
              <div className="flex-1 bg-gray-100 rounded-2xl flex items-end overflow-hidden mb-1">
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onKeyDown={handleKeyDown}
                  onChange={handleInput}
                  placeholder="Type a message..."
                  className="w-full bg-transparent border-none focus:ring-0 resize-none max-h-[120px] pt-3 pb-3 px-4 text-sm md:text-base outline-none"
                  rows={1}
                />
              </div>
              <button 
                onClick={handleSendMessage}
                disabled={!inputText.trim()}
                className="p-3 bg-purple-600 text-white rounded-full hover:bg-purple-700 transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed mb-1"
              >
                <Send className="w-5 h-5 -ml-0.5 mt-0.5" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center flex-col text-gray-500 h-full">
            <h3 className="text-xl font-medium mt-4 text-gray-600">Select a conversation</h3>
            <p className="text-sm mt-2 text-gray-400 max-w-sm text-center">Choose an active conversation from the list or start a new chat to begin messaging.</p>
          </div>
        )}
      </div>
    </div>
  );
}
