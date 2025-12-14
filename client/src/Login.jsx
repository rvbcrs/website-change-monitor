import React, { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { useToast } from './contexts/ToastContext';
import { GoogleLogin } from '@react-oauth/google';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const { login } = useAuth();

    const navigate = useNavigate();
    const { showToast } = useToast();

    const handleSubmit = async (e) => {
        e.preventDefault();
        const res = await login(email, password);
        if (res.success) {
            if (res.user && !res.user.is_verified) {
                 showToast('Login successful, but please verify your email.', 'warning');
            } else {
                showToast('Login successful', 'success');
            }
            navigate('/');
        } else {
            showToast(res.error || 'Login failed', 'error');
        }
    };
    
    const handleResend = async () => {
        if (!email) {
            showToast('Please enter your email first to resend verification.', 'info');
            return;
        }
         try {
             const res = await fetch(`/api/auth/resend-verification`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ email })
             });
             const data = await res.json();
             if (res.ok) {
                 showToast('Verification email sent!', 'success');
             } else {
                 showToast(data.error || 'Failed to send verification email.', 'error');
             }
         } catch (e) {
             showToast('Network error', 'error');
         }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-[#0d1117] text-[#c9d1d9]">
            <div className="w-full max-w-md p-8 space-y-6 bg-[#161b22] border border-[#30363d] rounded-lg">
                <div className="text-center">
                    <img src="/logo_128.png" alt="DeltaWatch" className="w-16 h-16 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-white">Sign In DeltaWatch</h2>
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
                    <button 
                        type="submit" 
                        className="w-full py-2 bg-[#238636] hover:bg-[#2ea043] text-white rounded-md font-semibold transition"
                    >
                        Sign In
                    </button>
                </form>
                <div className="text-center text-sm">
                    <span className="text-[#8b949e]">Don't have an account? </span>
                    <Link to="/register" className="text-[#58a6ff] hover:underline">Register</Link>
                </div>
                <div className="text-center text-xs text-[#8b949e]">
                    <button onClick={handleResend} className="hover:text-[#58a6ff] underline bg-transparent border-none cursor-pointer">
                        Resend Verification Email
                    </button>
                </div>

                <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-[#30363d]"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                        <span className="px-2 bg-[#161b22] text-[#8b949e]">Or continue with</span>
                    </div>
                </div>

                <div className="flex justify-center">
                    <GoogleLogin
                        onSuccess={async (credentialResponse) => {
                            try {
                                const res = await fetch(`/api/auth/google`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ token: credentialResponse.credential })
                                });
                                const data = await res.json();
                                if (res.ok) {
                                    localStorage.setItem('token', data.token);
                                    window.location.href = '/'; 
                                } else {
                                    showToast(data.error || 'Google Login Failed', 'error');
                                }
                            } catch (e) {
                                showToast('Network Error', 'error');
                            }
                        }}
                        onError={() => {
                            showToast('Google Login Failed', 'error');
                        }}
                        theme="filled_black"
                        shape="rectangular"
                    />
                </div>
            </div>
        </div>
    );
}
