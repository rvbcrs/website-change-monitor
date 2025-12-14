import React, { useState, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { useToast } from './contexts/ToastContext';

export default function Register() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const { register } = useAuth();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [isSetupMode, setIsSetupMode] = useState(false);
    const API_BASE = '';

    useEffect(() => {
        fetch(`${API_BASE}/api/auth/setup-status`)
            .then(res => res.json())
            .then(data => setIsSetupMode(data.needs_setup))
            .catch(() => {});
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            showToast('Passwords do not match', 'error');
            return;
        }
        if (password.length < 6) {
            showToast('Password must be at least 6 characters', 'error');
            return;
        }
        const res = await register(email, password);
        if (res.success) {
            showToast('Registration successful', 'success');
            navigate('/');
        } else {
            showToast(res.error || 'Registration failed', 'error');
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-[#0d1117] text-[#c9d1d9]">
            <div className="w-full max-w-md p-8 space-y-6 bg-[#161b22] border border-[#30363d] rounded-lg">
                <div className="text-center">
                    <img src="/logo_128.png" alt="DeltaWatch" className="w-16 h-16 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-white">
                        {isSetupMode ? 'Admin Setup' : 'Create Account'}
                    </h2>
                    {isSetupMode && (
                        <div className="mt-2 text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-900/50 rounded py-1 px-3 inline-block">
                             First user will be Administrator
                        </div>
                    )}
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Email</label>
                        <input 
                            type="email" 
                            required 
                            className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-md focus:outline-none focus:border-[#58a6ff] text-white"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Password</label>
                        <input 
                            type="password" 
                            required 
                            className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-md focus:outline-none focus:border-[#58a6ff] text-white"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Confirm Password</label>
                        <input 
                            type="password" 
                            required 
                            className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-md focus:outline-none focus:border-[#58a6ff] text-white"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                    </div>
                    <button 
                        type="submit" 
                        className="w-full py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md font-semibold transition"
                    >
                        Register
                    </button>
                </form>
                <div className="text-center text-sm">
                    <span className="text-[#8b949e]">Already have an account? </span>
                    <Link to="/login" className="text-[#58a6ff] hover:underline">Sign In</Link>
                </div>
            </div>
        </div>
    );
}
