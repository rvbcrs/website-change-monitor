import { createContext, useState, useContext, useEffect, type ReactNode } from 'react';

interface User {
    id: number;
    email: string;
    role: 'admin' | 'user';
}

interface AuthResult {
    success: boolean;
    error?: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<AuthResult>;
    register: (email: string, password: string) => Promise<AuthResult>;
    logout: () => void;
    authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Validate token on load (optional: check expiry)
        if (token) {
            try {
                const payload = JSON.parse(atob(token.split('.')[1])) as User;
                setUser(payload);
            } catch {
                localStorage.removeItem('token');
                setToken(null);
            }
        }
        setLoading(false);
    }, [token]);

    const API_BASE = '';

    const login = async (email: string, password: string): Promise<AuthResult> => {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('token', data.token);
            setToken(data.token);
            setUser(data.user);
            return { success: true };
        } else {
            return { success: false, error: data.error };
        }
    };

    const register = async (email: string, password: string): Promise<AuthResult> => {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('token', data.token);
            setToken(data.token);
            setUser(data.user);
            return { success: true };
        } else {
            return { success: false, error: data.error };
        }
    };

    const logout = () => {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
    };

    // Helper for authenticated fetch
    const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
        const headers = new Headers(options.headers);
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        const res = await fetch(url, { ...options, headers });
        if (res.status === 401 || res.status === 403) {
            logout();
        }
        return res;
    };

    return (
        <AuthContext.Provider value={{ user, token, loading, login, register, logout, authFetch }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
