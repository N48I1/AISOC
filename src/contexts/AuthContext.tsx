import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User as UserType, ROLE_LEVEL } from '../types';

export interface AuthContextType {
  user: UserType | null;
  token: string | null;
  login: (token: string, user: UserType) => void;
  logout: () => void;
  refreshProfile: () => void;
  hasRole: (minRole: string) => boolean;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserType | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('soc_token'));

  const refreshProfile = useCallback(() => {
    if (!token) return;
    fetch('/api/users/me/profile', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (!data.error) setUser(data); })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (token) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      }).then(res => res.json())
        .then(data => {
          if (data.error) logout();
          else setUser(data);
        })
        .catch(() => logout());
    }
  }, [token]);

  const login = (newToken: string, newUser: UserType) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('soc_token', newToken);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('soc_token');
  };

  const hasRole = (minRole: string) => {
    const userLevel = ROLE_LEVEL[user?.role || ''] ?? -1;
    const reqLevel  = ROLE_LEVEL[minRole] ?? 99;
    return userLevel >= reqLevel;
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, refreshProfile, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
