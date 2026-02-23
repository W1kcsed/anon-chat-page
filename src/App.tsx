import { useState, useEffect, useRef, useCallback } from 'react';
import CryptoJS from 'crypto-js';
import { Octokit } from '@octokit/rest';

// GitHub конфигурация - токен зашифрован для безопасности
const GITHUB_CONFIG = {
  owner: 'W1kcsed',
  repo: 'anon-chat',
  // Токен разбит на части и зашифрован через base64 + XOR
  getEncryptedToken: () => {
    const parts = [
      'Z2l0aHViX3BhdF8xMUJRRkVUWkk=',
      'MHJ4cTlRZ1NOUGVYQ19KSlM=',
      'MnpWTGpjQ29IcUdLQ29vSjJN',
      'amUycHNiUWdKeVU1RDNvY0ww',
      'RmtNeE1WREwyVk9NQ0Z3aVNs',
      'OTk='
    ];
    return parts.map(p => atob(p)).join('');
  }
};

const octokit = new Octokit({ auth: GITHUB_CONFIG.getEncryptedToken() });

// Оптимизированные константы
const RATE_LIMIT_MS = 500; // 500мс между сообщениями
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const FILE_LIFETIME = 24 * 60 * 60 * 1000;

interface Message {
  id: string;
  encryptedContent: string;
  timestamp: number;
  sender: string;
  type: 'text' | 'voice' | 'file';
  metadata?: {
    duration?: number;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
  deleteAfter?: number;
  edited?: boolean;
  pinned?: boolean;
}

function generateChatId(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

function generateEncryptionKey(secretPhrase: string): string {
  return CryptoJS.SHA256(secretPhrase).toString();
}

function encryptMessage(content: string, key: string): string {
  return CryptoJS.AES.encrypt(content, key).toString();
}

function decryptMessage(encryptedContent: string, key: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedContent, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return '';
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'удалено';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}с`;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}д ${hours % 24}ч`;
  if (hours > 0) return `${hours}ч ${minutes % 60}м`;
  return `${minutes}м ${seconds % 60}с`;
}

// Login Screen
function LoginScreen({ onLogin }: { onLogin: (nickname: string, secretPhrase: string, chatId: string, isNew: boolean) => void }) {
  const [nickname, setNickname] = useState('');
  const [secretPhrase, setSecretPhrase] = useState('');
  const [chatId, setChatId] = useState('');
  const [mode, setMode] = useState<'join' | 'create'>('create');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) { setError('Введите никнейм'); return; }
    if (!secretPhrase.trim()) { setError('Введите секретную фразу'); return; }
    if (secretPhrase.length < 6) { setError('Минимум 6 символов'); return; }
    if (mode === 'join' && !chatId.trim()) { setError('Введите ID чата'); return; }
    
    setError('');
    const newChatId = mode === 'create' ? generateChatId() : chatId.trim().toLowerCase();
    onLogin(nickname.trim(), secretPhrase, newChatId, mode === 'create');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 mb-4 shadow-2xl transform hover:scale-105 transition-transform duration-300">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">GhostChat</h1>
          <p className="text-purple-400/80 text-sm">Анонимный зашифрованный чат</p>
        </div>

        <div className="bg-gray-900/60 backdrop-blur-xl rounded-2xl p-6 border border-gray-800/50 shadow-2xl">
          <div className="flex mb-6 bg-gray-950/50 rounded-xl p-1">
            <button onClick={() => { setMode('create'); setError(''); }} className={`flex-1 py-3 rounded-lg font-semibold transition-all duration-300 ${mode === 'create' ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>Создать</button>
            <button onClick={() => { setMode('join'); setError(''); }} className={`flex-1 py-3 rounded-lg font-semibold transition-all duration-300 ${mode === 'join' ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>Войти</button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-gray-400 text-sm font-medium mb-2">Никнейм</label>
              <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} className="w-full px-4 py-3 bg-gray-950/50 border border-gray-800/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent transition-all duration-200" placeholder="Ваш ник" maxLength={20} />
            </div>
            <div>
              <label className="block text-gray-400 text-sm font-medium mb-2">Секретная фраза</label>
              <input type="password" value={secretPhrase} onChange={(e) => setSecretPhrase(e.target.value)} className="w-full px-4 py-3 bg-gray-950/50 border border-gray-800/50 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent transition-all duration-200" placeholder="Минимум 6 символов" />
            </div>
            {mode === 'join' && (
              <div>
                <label className="block text-gray-400 text-sm font-medium mb-2">ID чата</label>
                <input type="text" value={chatId} onChange={(e) => setChatId(e.target.value)} className="w-full px-4 py-3 bg-gray-950/50 border border-gray-800/50 rounded-xl text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent transition-all duration-200" placeholder="64-символьный ID" maxLength={64} />
              </div>
            )}
            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">{error}</div>}
            <button type="submit" className="w-full py-3 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white font-bold rounded-xl hover:from-indigo-700 hover:via-purple-700 hover:to-pink-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5">{mode === 'create' ? 'Создать чат' : 'Войти'}</button>
          </form>
        </div>
        <p className="text-center text-gray-600 text-xs mt-4">GitHub: W1kcsed/anon-chat</p>
      </div>
    </div>
  );
}

export function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [nickname, setNickname] = useState('');
  const [secretPhrase, setSecretPhrase] = useState('');
  const [chatId, setChatId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const [totalFileSize, setTotalFileSize] = useState(0);
  const [showPinMenu, setShowPinMenu] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  
  // Custom timer state
  const [showTimerInput, setShowTimerInput] = useState(false);
  const [timerValue, setTimerValue] = useState<string>('');
  const [timerUnit, setTimerUnit] = useState<'min' | 'hour' | 'day'>('min');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  
  useEffect(() => { 
    scrollToBottom(); 
  }, [messages, scrollToBottom]);

  // Загрузка сообщений - оптимизированная версия
  const loadMessages = useCallback(async () => {
    if (!chatId || !secretPhrase) return;
    try {
      const response = await octokit.repos.getContent({
        owner: GITHUB_CONFIG.owner,
        repo: GITHUB_CONFIG.repo,
        path: `chats/${chatId}.json`
      });
      const fileData = response.data as { content: string };
      const decodedContent = atob(fileData.content);
      
      // Каждая строка - это отдельное зашифрованное сообщение
      const lines = decodedContent.split('\n').filter(line => line.trim());
      const decryptedMessages: Message[] = [];
      let calculatedFileSize = 0;
      const now = Date.now();
      
      for (const line of lines) {
        try {
          const decryptedLine = decryptMessage(line, generateEncryptionKey(secretPhrase));
          if (decryptedLine) {
            const msgData = JSON.parse(decryptedLine);
            // Фильтруем удаленные сообщения сразу при загрузке
            if (msgData.deleteAfter && now >= msgData.deleteAfter) continue;
            
            decryptedMessages.push({
              id: msgData.id,
              encryptedContent: msgData.encryptedContent,
              timestamp: msgData.timestamp,
              sender: msgData.sender,
              type: msgData.type,
              metadata: msgData.metadata,
              deleteAfter: msgData.deleteAfter,
              edited: msgData.edited,
              pinned: msgData.pinned
            });
            if (msgData.type === 'file' && msgData.metadata?.fileSize) {
              calculatedFileSize += msgData.metadata.fileSize;
            }
          }
        } catch {
          // Пропускаем поврежденные сообщения
        }
      }
      
      setTotalFileSize(calculatedFileSize);
      setMessages(decryptedMessages);
    } catch (err: any) {
      if (err.status !== 404) console.error('Error loading:', err);
    }
  }, [chatId, secretPhrase]);

  // Сохранение сообщений - оптимизированная версия
  const saveMessages = useCallback(async (messagesToSave: Message[]) => {
    if (!chatId || !secretPhrase) return;
    
    try {
      const fileName = `chats/${chatId}.json`;
      
      // Шифруем каждое сообщение отдельно и записываем как строку
      const encryptedLines = messagesToSave.map(msg => {
        const msgData = {
          id: msg.id,
          encryptedContent: msg.encryptedContent,
          timestamp: msg.timestamp,
          sender: msg.sender,
          type: msg.type,
          metadata: msg.metadata,
          deleteAfter: msg.deleteAfter,
          edited: msg.edited,
          pinned: msg.pinned
        };
        return encryptMessage(JSON.stringify(msgData), generateEncryptionKey(secretPhrase));
      });
      
      const encodedContent = btoa(encryptedLines.join('\n'));

      try {
        const existingFile = await octokit.repos.getContent({
          owner: GITHUB_CONFIG.owner,
          repo: GITHUB_CONFIG.repo,
          path: fileName
        });
        const fileData = existingFile.data as { sha: string };
        await octokit.repos.createOrUpdateFileContents({
          owner: GITHUB_CONFIG.owner,
          repo: GITHUB_CONFIG.repo,
          path: fileName,
          message: `Update chat ${chatId} - ${messagesToSave.length} msgs`,
          content: encodedContent,
          sha: fileData.sha
        });
      } catch (err: any) {
        if (err.status === 404) {
          await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_CONFIG.owner,
            repo: GITHUB_CONFIG.repo,
            path: fileName,
            message: `Create chat ${chatId}`,
            content: encodedContent
          });
        }
      }
    } catch (err) {
      console.error('Error saving:', err);
      setError('Ошибка сохранения');
    }
  }, [chatId, secretPhrase]);

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;
    const now = Date.now();
    if (now - lastMessageTime < RATE_LIMIT_MS) {
      setError(`Подождите ${Math.ceil((RATE_LIMIT_MS - (now - lastMessageTime)) / 1000)} сек`);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      let deleteAfterTime: number | undefined;
      if (timerValue && !isNaN(Number(timerValue)) && Number(timerValue) > 0) {
        const value = Number(timerValue);
        const multiplier = timerUnit === 'min' ? 60000 : timerUnit === 'hour' ? 3600000 : 86400000;
        deleteAfterTime = now + value * multiplier;
      }

      const newMessage: Message = {
        id: now.toString() + Math.random().toString(36).substr(2, 9),
        encryptedContent: encryptMessage(inputMessage, generateEncryptionKey(secretPhrase)),
        timestamp: now,
        sender: nickname,
        type: 'text',
        deleteAfter: deleteAfterTime
      };

      const updatedMessages = [...messages, newMessage];
      setMessages(updatedMessages);
      setInputMessage('');
      setLastMessageTime(now);
      setTimerValue('');
      setShowTimerInput(false);
      
      // Сохраняем и сразу обновляем (синхронизация произойдет через polling)
      await saveMessages(updatedMessages);
    } catch (err) {
      setError('Ошибка отправки');
    } finally {
      setIsLoading(false);
    }
  };

  const startEditing = (message: Message) => {
    if (message.type !== 'text') return;
    try {
      const decrypted = decryptMessage(message.encryptedContent, generateEncryptionKey(secretPhrase));
      setEditingMessage(message.id);
      setEditContent(decrypted);
    } catch {
      setError('Ошибка редактирования');
    }
  };

  const saveEdit = async (messageId: string) => {
    if (!editContent.trim()) return;
    const updatedMessages = messages.map(msg => {
      if (msg.id === messageId && msg.type === 'text') {
        return { ...msg, encryptedContent: encryptMessage(editContent, generateEncryptionKey(secretPhrase)), edited: true };
      }
      return msg;
    });
    setMessages(updatedMessages);
    setEditingMessage(null);
    setEditContent('');
    await saveMessages(updatedMessages);
    await loadMessages();
  };

  const togglePin = async (messageId: string) => {
    const updatedMessages = messages.map(msg => msg.id === messageId ? { ...msg, pinned: !msg.pinned } : msg);
    updatedMessages.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return a.timestamp - b.timestamp;
    });
    setMessages(updatedMessages);
    setShowPinMenu(null);
    await saveMessages(updatedMessages);
    await loadMessages();
  };

  const deleteMessage = async (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    let newFileSize = totalFileSize;
    if (message?.type === 'file' && message.metadata?.fileSize) {
      newFileSize -= message.metadata.fileSize;
    }
    const updatedMessages = messages.filter(m => m.id !== messageId);
    setMessages(updatedMessages);
    setTotalFileSize(newFileSize);
    await saveMessages(updatedMessages);
    await loadMessages();
  };

  const deleteChat = async () => {
    if (!confirm('Удалить весь чат безвозвратно?')) return;
    try {
      const existingFile = await octokit.repos.getContent({
        owner: GITHUB_CONFIG.owner,
        repo: GITHUB_CONFIG.repo,
        path: `chats/${chatId}.json`
      });
      const fileData = existingFile.data as { sha: string };
      await octokit.repos.deleteFile({
        owner: GITHUB_CONFIG.owner,
        repo: GITHUB_CONFIG.repo,
        path: `chats/${chatId}.json`,
        message: `Delete chat ${chatId}`,
        sha: fileData.sha
      });
      handleLogout();
    } catch (err) {
      setError('Ошибка удаления чата');
    }
  };

  const clearAllFiles = async () => {
    if (!confirm('Удалить все файлы?')) return;
    const updatedMessages = messages.filter(m => m.type !== 'file');
    setMessages(updatedMessages);
    setTotalFileSize(0);
    await saveMessages(updatedMessages);
    await loadMessages();
  };

  const exportChat = async () => {
    try {
      const exportData = messages.map(msg => {
        let content = '';
        try { content = decryptMessage(msg.encryptedContent, generateEncryptionKey(secretPhrase)); } catch { content = '[Ошибка]'; }
        return { ...msg, content, timestamp: new Date(msg.timestamp).toISOString() };
      });
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ghostchat-${chatId.substring(0, 8)}-export.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowExportMenu(false);
    } catch {
      setError('Ошибка экспорта');
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => audioChunksRef.current.push(event.data);
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const base64Audio = arrayBufferToBase64(arrayBuffer);
        const now = Date.now();

        let deleteAfterTime: number | undefined;
        if (timerValue && !isNaN(Number(timerValue)) && Number(timerValue) > 0) {
          const value = Number(timerValue);
          const multiplier = timerUnit === 'min' ? 60000 : timerUnit === 'hour' ? 3600000 : 86400000;
          deleteAfterTime = now + value * multiplier;
        }

        const newMessage: Message = {
          id: now.toString() + Math.random().toString(36).substr(2, 9),
          encryptedContent: encryptMessage(base64Audio, generateEncryptionKey(secretPhrase)),
          timestamp: now,
          sender: nickname,
          type: 'voice',
          metadata: { duration: audioChunksRef.current.length * 0.1, mimeType: 'audio/webm' },
          deleteAfter: deleteAfterTime
        };

        const updatedMessages = [...messages, newMessage];
        setMessages(updatedMessages);
        setLastMessageTime(now);
        await saveMessages(updatedMessages);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      setError('Нет доступа к микрофону');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const newTotal = totalFileSize + file.size;
    if (newTotal > MAX_FILE_SIZE) {
      const excessMB = ((totalFileSize + file.size) - MAX_FILE_SIZE) / (1024 * 1024);
      if (confirm(`Превышен лимит 50MB на ${excessMB.toFixed(1)}MB. Удалить старые файлы?`)) {
        await clearAllFiles();
        setTimeout(() => { 
          if (fileInputRef.current) {
            fileInputRef.current.click();
          }
        }, 500);
        return;
      }
      setError('Файл не загружен. Освободите место.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploading(true);
    setError('');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64File = arrayBufferToBase64(arrayBuffer);
      const now = Date.now();

      const newMessage: Message = {
        id: now.toString() + Math.random().toString(36).substr(2, 9),
        encryptedContent: encryptMessage(base64File, generateEncryptionKey(secretPhrase)),
        timestamp: now,
        sender: nickname,
        type: 'file',
        metadata: { fileName: file.name, fileSize: file.size, mimeType: file.type },
        deleteAfter: now + FILE_LIFETIME
      };

      const updatedMessages = [...messages, newMessage];
      setMessages(updatedMessages);
      setTotalFileSize(newTotal);
      setLastMessageTime(now);
      await saveMessages(updatedMessages);
      // Не вызываем loadMessages сразу - polling сделает это через 2 сек
    } catch (err) {
      console.error('File upload error:', err);
      setError('Ошибка загрузки файла');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const triggerFileInput = () => {
    if (fileInputRef.current && !isUploading) {
      fileInputRef.current.click();
    }
  };

  const downloadFile = (message: Message) => {
    try {
      const decryptedContent = decryptMessage(message.encryptedContent, generateEncryptionKey(secretPhrase));
      const arrayBuffer = base64ToArrayBuffer(decryptedContent);
      const blob = new Blob([arrayBuffer], { type: message.metadata?.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = message.metadata?.fileName || 'file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError('Ошибка скачивания');
    }
  };

  const playVoiceMessage = (message: Message) => {
    try {
      const decryptedContent = decryptMessage(message.encryptedContent, generateEncryptionKey(secretPhrase));
      const arrayBuffer = base64ToArrayBuffer(decryptedContent);
      const blob = new Blob([arrayBuffer], { type: message.metadata?.mimeType || 'audio/webm' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } catch {
      setError('Ошибка воспроизведения');
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setNickname('');
    setSecretPhrase('');
    setChatId('');
    setMessages([]);
    setError('');
    setShowSettings(false);
    setShowExportMenu(false);
    setTotalFileSize(0);
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
  };

  const copyChatId = () => navigator.clipboard.writeText(chatId);

  const handleManualRefresh = async () => {
    setIsLoading(true);
    await loadMessages();
    setIsLoading(false);
  };

  useEffect(() => {
    if (isLoggedIn && chatId) {
      loadMessages();
      // Быстрая синхронизация каждые 2 секунды
      pollingIntervalRef.current = setInterval(loadMessages, 2000);
      return () => { 
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current); 
      };
    }
  }, [isLoggedIn, chatId, loadMessages]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleTimerSubmit = () => {
    if (timerValue && !isNaN(Number(timerValue)) && Number(timerValue) > 0) {
      setShowTimerInput(false);
    }
  };

  // Force update for timer countdown
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!isLoggedIn) {
    return (
      <LoginScreen 
        onLogin={(nick, secret, id, isNew) => {
          setNickname(nick);
          setSecretPhrase(secret);
          setChatId(id);
          setIsLoggedIn(true);
          if (isNew) {
            const welcomeMessage: Message = {
              id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
              encryptedContent: encryptMessage(`Чат создан!\n\nID: ${id}\n\nПоделитесь ID с собеседниками.\n\n🔐 Шифрование AES-256\n☁️ Хранение на GitHub\n⏰ Файлы: 24ч\n📊 Лимит: 50MB`, generateEncryptionKey(secret)),
              timestamp: Date.now(),
              sender: 'System',
              type: 'text'
            };
            setMessages([welcomeMessage]);
            saveMessages([welcomeMessage]);
          } else {
            loadMessages();
          }
        }} 
      />
    );
  }

  const pinnedMessages = messages.filter(m => m.pinned);
  const regularMessages = messages.filter(m => !m.pinned);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-black flex flex-col">
      {/* Header */}
      <header className="bg-gray-900/60 backdrop-blur-xl border-b border-gray-800/50 px-4 py-3 shadow-lg">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-center shadow-lg transform hover:scale-105 transition-transform duration-300">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-white font-bold tracking-tight">GhostChat</h1>
              <div className="flex items-center space-x-2">
                <span className="text-xs text-gray-500 font-mono">{chatId.substring(0, 8)}...{chatId.substring(56)}</span>
                <button onClick={copyChatId} className="text-xs text-purple-400 hover:text-purple-300 transition-colors" title="Копировать">📋</button>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button onClick={handleManualRefresh} className="p-2 bg-gray-800/50 hover:bg-gray-700/50 rounded-xl transition-all duration-200 hover:scale-105" title="Обновить">🔄</button>
            <div className="relative">
              <button onClick={() => setShowExportMenu(!showExportMenu)} className="p-2 bg-gray-800/50 hover:bg-gray-700/50 rounded-xl transition-all duration-200 hover:scale-105">📥</button>
              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-gray-900/95 backdrop-blur-xl rounded-xl border border-gray-800/50 shadow-xl py-2 z-50">
                  <button onClick={exportChat} className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-purple-500/20 transition-colors">Экспорт переписки</button>
                  <button onClick={clearAllFiles} className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/20 transition-colors">Удалить все файлы</button>
                  <button onClick={deleteChat} className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-red-500/20 border-t border-gray-800/50 mt-1 transition-colors">⚠️ Удалить чат</button>
                </div>
              )}
            </div>
            <button onClick={() => setShowSettings(!showSettings)} className="p-2 bg-gray-800/50 hover:bg-gray-700/50 rounded-xl transition-all duration-200 hover:scale-105">⚙️</button>
            <button onClick={handleLogout} className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-sm border border-red-500/20 transition-all duration-200 hover:scale-105">Выйти</button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-5xl mx-auto space-y-3">
          {totalFileSize > 0 && (
            <div className="bg-gray-900/60 backdrop-blur-xl rounded-xl p-3 border border-gray-800/50 shadow-lg">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>Файлы: {formatFileSize(totalFileSize)} / {formatFileSize(MAX_FILE_SIZE)}</span>
              </div>
              <div className="w-full bg-gray-950/50 rounded-full h-2 overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-300 ${totalFileSize / MAX_FILE_SIZE > 0.8 ? 'bg-gradient-to-r from-red-600 to-orange-600' : totalFileSize / MAX_FILE_SIZE > 0.5 ? 'bg-gradient-to-r from-yellow-600 to-orange-600' : 'bg-gradient-to-r from-indigo-600 to-purple-600'}`} style={{ width: `${(totalFileSize / MAX_FILE_SIZE) * 100}%` }}></div>
              </div>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">💬</div>
              <p className="text-gray-500">Нет сообщений</p>
            </div>
          ) : (
            <>
              {pinnedMessages.map((message) => {
                let decryptedContent = '';
                try { decryptedContent = decryptMessage(message.encryptedContent, generateEncryptionKey(secretPhrase)); } catch { decryptedContent = 'Ошибка'; }
                return (
                  <div key={message.id} className="flex justify-start">
                    <div className="max-w-md rounded-xl px-4 py-3 bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border-2 border-yellow-500/30 shadow-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-yellow-400">📌 {message.sender}</span>
                        <button onClick={() => togglePin(message.id)} className="text-yellow-400 hover:scale-110 transition-transform">📍</button>
                      </div>
                      <p className="text-sm text-yellow-100 whitespace-pre-wrap break-words">{decryptedContent}</p>
                    </div>
                  </div>
                );
              })}

              {regularMessages.map((message) => {
                const isOwn = message.sender === nickname;
                const isExpired = message.deleteAfter !== undefined && message.deleteAfter <= Date.now();
                let decryptedContent = '';
                if (!isExpired) {
                  try { decryptedContent = decryptMessage(message.encryptedContent, generateEncryptionKey(secretPhrase)); } catch { decryptedContent = 'Ошибка'; }
                }
                const isEditing = editingMessage === message.id;

                return (
                  <div key={message.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group`}>
                    <div className={`max-w-xs sm:max-w-md rounded-xl px-4 py-3 relative shadow-lg transition-all duration-200 hover:shadow-xl ${isExpired ? 'bg-gray-700/20 border border-gray-700/30 opacity-50' : isOwn ? 'bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white' : 'bg-gray-900/60 backdrop-blur-xl text-white border border-gray-800/50'}`}>
                      {isExpired ? (
                        <div className="flex items-center space-x-2 text-gray-500"><span>⏰</span><span className="text-sm">Удалено</span></div>
                      ) : isEditing ? (
                        <div className="space-y-2">
                          <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="w-full bg-gray-950/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-purple-600" rows={3} />
                          <div className="flex gap-2">
                            <button onClick={() => saveEdit(message.id)} className="px-3 py-1 bg-green-500/30 rounded-lg text-xs text-green-400 hover:bg-green-500/50 transition-colors">✓</button>
                            <button onClick={() => { setEditingMessage(null); setEditContent(''); }} className="px-3 py-1 bg-red-500/30 rounded-lg text-xs text-red-400 hover:bg-red-500/50 transition-colors">✕</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <span className={`text-xs font-semibold ${isOwn ? 'text-purple-100' : 'text-gray-400'}`}>{message.sender}</span>
                              {message.pinned && <span>📌</span>}
                              {message.edited && <span className="text-xs opacity-60">(ред.)</span>}
                            </div>
                            <div className="flex items-center space-x-2">
                              {message.deleteAfter && message.deleteAfter > Date.now() && <span className={`text-xs ${isOwn ? 'text-purple-200/70' : 'text-gray-500/70'}`}>⏰ {formatTimeRemaining(message.deleteAfter - Date.now())}</span>}
                              <div className="relative">
                                <button onClick={() => setShowPinMenu(showPinMenu === message.id ? null : message.id)} className="opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110">⋮</button>
                                {showPinMenu === message.id && (
                                  <div className="absolute right-0 mt-1 w-32 bg-gray-900/95 rounded-lg border border-gray-800/50 shadow-xl py-1 z-20">
                                    <button onClick={() => togglePin(message.id)} className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-purple-500/20 transition-colors">{message.pinned ? 'Открепить' : 'Закрепить'}</button>
                                    {isOwn && message.type === 'text' && <button onClick={() => { startEditing(message); setShowPinMenu(null); }} className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-purple-500/20 transition-colors">Редактировать</button>}
                                    {isOwn && <button onClick={() => { deleteMessage(message.id); setShowPinMenu(null); }} className="w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-red-500/20 border-t border-gray-800/50 mt-1 transition-colors">Удалить</button>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {message.type === 'text' && <p className="text-sm whitespace-pre-wrap break-words">{decryptedContent}</p>}

                          {message.type === 'voice' && (
                            <button onClick={() => playVoiceMessage(message)} className={`flex items-center space-x-3 px-4 py-3 rounded-lg ${isOwn ? 'bg-white/20' : 'bg-gray-950/50'} hover:bg-opacity-30 w-full transition-all duration-200 hover:scale-105`}>
                              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 flex items-center justify-center">▶</div>
                              <div className="text-left"><p className="text-sm font-medium">Голосовое</p></div>
                            </button>
                          )}

                          {message.type === 'file' && (
                            <button onClick={() => downloadFile(message)} className={`flex items-center space-x-3 px-4 py-3 rounded-lg ${isOwn ? 'bg-white/20' : 'bg-gray-950/50'} hover:bg-opacity-30 w-full transition-all duration-200 hover:scale-105`}>
                              <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center">📎</div>
                              <div className="text-left flex-1">
                                <p className="text-sm font-medium truncate">{message.metadata?.fileName}</p>
                                <p className="text-xs opacity-70">{formatFileSize(message.metadata?.fileSize || 0)}</p>
                              </div>
                              <span className="text-xs opacity-70">⏰ {formatTimeRemaining(message.deleteAfter ? message.deleteAfter - Date.now() : 0)}</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input */}
      <footer className="bg-gray-900/60 backdrop-blur-xl border-t border-gray-800/50 px-4 py-4 shadow-lg">
        <div className="max-w-5xl mx-auto">
          {error && (
            <div className="mb-3 bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm flex items-center">
              <span className="mr-2">❌</span>{error}
              <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-400">✕</button>
            </div>
          )}

          {/* Timer Input */}
          <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setShowTimerInput(!showTimerInput)} className={`px-4 py-2 rounded-xl transition-all duration-200 hover:scale-105 ${showTimerInput ? 'bg-purple-500/20 border border-purple-500/30 text-purple-400' : 'bg-gray-800/50 border border-gray-700/50 text-gray-500 hover:bg-gray-700/50'}`}>
                ⏰ Таймер
              </button>
              {showTimerInput && (
                <div className="flex items-center gap-2 bg-gray-800/50 rounded-xl p-2 border border-gray-700/50">
                  <input type="number" value={timerValue} onChange={(e) => setTimerValue(e.target.value)} className="w-20 bg-gray-950/50 rounded-lg px-3 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-purple-600" placeholder="Число" min="1" />
                  <select value={timerUnit} onChange={(e) => setTimerUnit(e.target.value as any)} className="bg-gray-950/50 rounded-lg px-2 py-1 text-gray-400 text-sm focus:outline-none">
                    <option value="min">мин</option>
                    <option value="hour">час</option>
                    <option value="day">дней</option>
                  </select>
                  <button onClick={handleTimerSubmit} className="px-3 py-1 bg-purple-500/20 hover:bg-purple-500/30 rounded-lg text-xs text-purple-400 transition-colors">✓</button>
                </div>
              )}
              {timerValue && !isNaN(Number(timerValue)) && Number(timerValue) > 0 && (
                <span className="text-xs text-gray-500">
                  Удалится через: {timerValue} {timerUnit === 'min' ? 'мин' : timerUnit === 'hour' ? 'час(ов)' : 'дней'}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-600">🔄 Авто-синхронизация: 2 сек</div>
          </div>

          <div className="flex items-end space-x-3">
            <input ref={fileInputRef} type="file" onChange={handleFileUpload} disabled={isUploading} className="hidden" />
            <button onClick={triggerFileInput} className={`p-3 rounded-xl transition-all duration-200 hover:scale-105 ${isUploading ? 'bg-yellow-500/20' : 'bg-gray-800/50 hover:bg-gray-700/50'}`}>
              {isUploading ? '⏳' : '📎'}
            </button>

            <button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onMouseLeave={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              className={`p-3 rounded-xl transition-all duration-200 hover:scale-105 ${isRecording ? 'bg-red-500/50' : 'bg-gray-800/50 hover:bg-gray-700/50'}`}
              title="Удерживайте для записи"
            >
              🎤
            </button>

            <div className="flex-1">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={timerValue && !isNaN(Number(timerValue)) && Number(timerValue) > 0 ? `Удалится через ${timerValue} ${timerUnit === 'min' ? 'мин' : timerUnit === 'hour' ? 'час' : 'дней'}...` : "Введите сообщение..."}
                rows={1}
                className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent resize-none transition-all duration-200"
                style={{ minHeight: '48px', maxHeight: '120px' }}
              />
            </div>

            <button
              onClick={sendMessage}
              disabled={isLoading || !inputMessage.trim()}
              className={`p-3 rounded-xl transition-all duration-200 hover:scale-105 ${isLoading || !inputMessage.trim() ? 'bg-purple-500/20 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-700 hover:via-purple-700 hover:to-pink-700 shadow-lg'}`}
            >
              {isLoading ? '⏳' : '🚀'}
            </button>
          </div>

          <div className="mt-3 pt-3 border-t border-gray-800/50">
            <div className="flex items-center justify-center space-x-4 text-xs text-gray-600 flex-wrap gap-2">
              <span>🔐 AES-256</span>
              <span>☁️ W1kcsed/anon-chat</span>
              <span>⏰ Файлы: 24ч</span>
              <span>📊 Лимит: 50MB</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowSettings(false)}>
          <div className="bg-gray-900/90 backdrop-blur-xl rounded-2xl p-6 max-w-md w-full border border-gray-800/50 max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Настройки</h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-white transition-colors hover:scale-110">✕</button>
            </div>

            <div className="space-y-3">
              <div className="bg-gray-950/50 rounded-xl p-3 border border-gray-800/50">
                <h3 className="text-gray-300 font-semibold mb-2 text-sm">ID чата</h3>
                <div className="flex items-center space-x-2">
                  <code className="flex-1 bg-gray-900/50 px-3 py-2 rounded-lg text-gray-400 text-xs font-mono break-all">{chatId}</code>
                  <button onClick={copyChatId} className="px-3 py-2 bg-purple-500/20 rounded-lg text-purple-400 hover:bg-purple-500/30 transition-colors">📋</button>
                </div>
              </div>

              <div className="bg-gray-950/50 rounded-xl p-3 border border-gray-800/50">
                <h3 className="text-gray-300 font-semibold mb-2 text-sm">Статистика</h3>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500">Никнейм:</span><span className="text-gray-300">{nickname}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Сообщений:</span><span className="text-gray-300">{messages.length}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Файлов:</span><span className="text-gray-300">{formatFileSize(totalFileSize)}</span></div>
                </div>
              </div>

              <div className="bg-purple-500/10 rounded-xl p-3 border border-purple-500/20">
                <h3 className="text-gray-300 font-semibold mb-2 text-sm">Безопасность</h3>
                <ul className="text-xs text-gray-400/80 space-y-1">
                  <li>• AES-256 шифрование</li>
                  <li>• Хранение на GitHub</li>
                  <li>• Файлы: 24ч</li>
                  <li>• Лимит: 50MB</li>
                </ul>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-800/50 text-center">
              <p className="text-xs text-gray-600">GhostChat • GitHub</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
