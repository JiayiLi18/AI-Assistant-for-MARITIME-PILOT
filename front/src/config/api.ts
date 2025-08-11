// API Configuration
export const API_CONFIG = {
  // 使用环境变量获取API URL，如果没有设置则使用默认值
  BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  
  // API endpoints
  ENDPOINTS: {
    CHAT: '/chat',
  }
} as const;

// 获取完整的API URL
export const getApiUrl = (endpoint: string): string => {
  return `${API_CONFIG.BASE_URL}${endpoint}`;
};
