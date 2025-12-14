import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';


export default function VerifyEmail() {
    const [searchParams] = useSearchParams();
    const [status, setStatus] = useState('verifying'); // verifying, success, error
    const [message, setMessage] = useState('Verifying your email...');
    const navigate = useNavigate();
    const token = searchParams.get('token');

    useEffect(() => {
        if (!token) {
            setStatus('error');
            setMessage('Invalid verification link.');
            return;
        }

        const verify = async () => {
            try {
                const apiBase = '';
                const res = await fetch(`${apiBase}/api/auth/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                const data = await res.json();
                
                if (res.ok) {
                    setStatus('success');
                    setMessage('Email verified successfully! You can now log in.');
                    setTimeout(() => navigate('/login'), 3000);
                } else {
                    setStatus('error');
                    setMessage(data.error || 'Verification failed.');
                }
            } catch (e) {
                setStatus('error');
                setMessage('Network error during verification.');
            }
        };

        verify();
    }, [token, navigate]);

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-900 text-gray-100">
            <div className="w-full max-w-md p-8 space-y-6 bg-gray-800 rounded-lg shadow-xl border border-gray-700 text-center">
                <h2 className="text-2xl font-bold text-white">Email Verification</h2>
                
                <div className={`p-4 rounded-md ${
                    status === 'verifying' ? 'bg-blue-900/50 text-blue-200' :
                    status === 'success' ? 'bg-green-900/50 text-green-200' :
                    'bg-red-900/50 text-red-200'
                }`}>
                    {status === 'verifying' && (
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                    )}
                    <p>{message}</p>
                </div>

                {status === 'success' && (
                    <Link to="/login" className="block w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors">
                        Go to Login
                    </Link>
                )}
                
                {status === 'error' && (
                    <Link to="/login" className="block text-sm text-gray-400 hover:text-white mt-4">
                        Return to Login
                    </Link>
                )}
            </div>
        </div>
    );
}
