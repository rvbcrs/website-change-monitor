import { useState, useEffect } from 'react';
import { Users as UsersIcon, Trash2, Shield } from 'lucide-react';
import { useToast } from './contexts/ToastContext';
import { useDialog } from './contexts/DialogContext';
import { useAuth } from './contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface UserData {
    id: number;
    email: string;
    role: 'admin' | 'user';
    is_verified: boolean;
    is_blocked: boolean;
    created_at: string;
}

function Users() {
    const API_BASE = '';
    const { showToast } = useToast();
    const { confirm } = useDialog();
    const { authFetch, user } = useAuth();
    const navigate = useNavigate();
    const [users, setUsers] = useState<UserData[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user && user.role === 'admin') {
            fetchUsers();
        } else if (user && user.role !== 'admin') {
             navigate('/'); // Redirect non-admins
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/api/admin/users`);
            const data = await res.json();
            if (data.message === 'success') {
                setUsers(data.data);
            }
        } catch (e) {
            console.error("Error fetching users:", e);
            showToast('Failed to load users', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteUser = async (id: number, email: string) => {
        const confirmed = await confirm({
            title: 'Delete User',
            message: `Are you sure you want to delete "${email}"? This action cannot be undone.`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            danger: true
        });
        if (!confirmed) return;
        try {
            const res = await authFetch(`${API_BASE}/api/admin/users/${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast('User deleted', 'success');
                fetchUsers();
            } else {
                showToast('Failed to delete user', 'error');
            }
        } catch {
            showToast('Error deleting user', 'error');
        }
    };

    const handleToggleBlock = async (id: number, blocked: boolean) => {
        try {
            const res = await authFetch(`${API_BASE}/api/admin/users/${id}/block`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ blocked })
            });
            if (res.ok) {
                showToast(`User ${blocked ? 'blocked' : 'unblocked'}`, 'success');
                fetchUsers();
            } else {
                showToast('Failed to update block status', 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Error updating user', 'error');
        }
    };

    if (!user || user.role !== 'admin') return null;

    return (
        <div className="flex h-full w-full bg-[#0d1117] flex-col text-white">
            <header className="bg-[#161b22] p-4 shadow-md flex items-center justify-between z-10 sticky top-0 border-b border-gray-800">
                <h1 className="text-xl font-bold text-white shadow-sm flex items-center gap-2">
                    <UsersIcon size={20} className="text-blue-400" /> User Management
                </h1>
                <div className="text-gray-400 text-sm">
                   {users.length} Users
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-8">
                <div className="max-w-5xl mx-auto">
                    <div className="bg-[#161b22] rounded-lg border border-gray-800 shadow-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm text-gray-400">
                                <thead className="bg-[#0d1117] text-gray-200 font-medium">
                                    <tr>
                                        <th className="p-4 text-left">Email</th>
                                        <th className="p-4 text-left">Role</th>
                                        <th className="p-4 text-left">Verified</th>
                                        <th className="p-4 text-left">Status</th>
                                        <th className="p-4 text-left">Registered</th>
                                        <th className="p-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800">
                                    {users.map(u => (
                                        <tr key={u.id} className="hover:bg-[#21262d] transition-colors">
                                            <td className="p-4 text-white font-medium">{u.email}</td>
                                            <td className="p-4">
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold border ${u.role === 'admin' ? 'bg-purple-900/30 text-purple-400 border-purple-900/50' : 'bg-gray-800 text-gray-300 border-gray-700'}`}>
                                                    {u.role.toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                {u.is_verified ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-400 border border-green-900/50">
                                                        Verified
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-900/30 text-yellow-400 border border-yellow-900/50">
                                                        Pending
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                {u.is_blocked ? (
                                                    <span className="inline-flex items-center gap-1 text-red-400 font-bold bg-red-900/20 px-2 py-1 rounded border border-red-900/30">
                                                        <Shield size={12} /> Blocked
                                                    </span>
                                                ) : (
                                                    <span className="text-green-400">Active</span>
                                                )}
                                            </td>
                                            <td className="p-4 text-gray-500 font-mono text-xs">
                                                {new Date(u.created_at).toLocaleDateString()} {new Date(u.created_at).toLocaleTimeString()}
                                            </td>
                                            <td className="p-4 text-right space-x-2">
                                                {u.id !== user.id && (
                                                    <>
                                                        <button 
                                                            onClick={() => handleToggleBlock(u.id, !u.is_blocked)}
                                                            className={`p-2 rounded-lg transition-colors border ${u.is_blocked ? 'bg-green-900/20 text-green-400 border-green-900/50 hover:bg-green-900/40' : 'bg-orange-900/20 text-orange-400 border-orange-900/50 hover:bg-orange-900/40'}`}
                                                            title={u.is_blocked ? "Unblock User" : "Block User"}
                                                        >
                                                            <Shield size={16} />
                                                        </button>
                                                        <button 
                                                            onClick={() => handleDeleteUser(u.id, u.email)}
                                                            className="p-2 bg-red-900/20 text-red-400 border border-red-900/50 rounded-lg hover:bg-red-900/40 transition-colors"
                                                            title="Delete User"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </>
                                                )}
                                                {u.id === user.id && (
                                                    <span className="text-gray-600 text-xs italic pr-2">You</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {users.length === 0 && !loading && (
                                        <tr>
                                            <td colSpan={6} className="p-8 text-center text-gray-500">
                                                No users found.
                                            </td>
                                        </tr>
                                    )}
                                     {loading && (
                                        <tr>
                                            <td colSpan={6} className="p-8 text-center text-gray-500">
                                                Loading users...
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Users;
